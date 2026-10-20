import { db } from './lib/db.mjs';
import { auth } from './lib/auth.mjs';
import { handlePortalRequest } from './indago/portal-api.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export async function withMember(session, work) {
  if (!session?.user?.id || !session.user.email) return json({ error: 'Sign in required.' }, 401);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Bind this verified Better Auth identity to an existing invitation only.
    await client.query(`UPDATE indago.members SET user_id = $1
      WHERE email = lower($2) AND user_id IS NULL`,
    [session.user.id, session.user.email]);
    await client.query('SET LOCAL ROLE indago_app');
    await client.query("SELECT set_config('indago.user_id', $1, true)", [session.user.id]);
    const { rows } = await client.query('SELECT role FROM indago.members WHERE user_id = $1', [session.user.id]);
    const role = rows[0]?.role;
    if (!role) { await client.query('ROLLBACK'); return json({ error: 'No Indago invitation.' }, 403); }
    const response = await work(client, role);
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' || error.code === '23514' || error.code === '42501') {
      return json({ error: 'This change is not allowed. Reload and try again.' }, 409);
    }
    console.error('Indago request failed', error.code || error.name);
    return json({ error: 'The portal could not complete this request. Try again.' }, 500);
  } finally {
    client.release();
  }
}

export default async function handler(request) {
  const route = new URL(request.url).pathname.replace(/^\/api\/indago\/?/, '');
  const session = await auth.api.getSession({ headers: request.headers });
  return withMember(session, (client, role) => handlePortalRequest(request, client, role, route));
}

export const config = { path: '/api/indago/*' };
