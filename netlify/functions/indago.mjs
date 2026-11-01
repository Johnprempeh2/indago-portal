import { db } from './lib/db.mjs';
import { auth } from './lib/auth.mjs';
import { handlePortalRequest } from './indago/portal-api.mjs';
import { handleDeliverables } from './indago/deliverables.mjs';
import { getStore } from '@netlify/blobs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export async function withMember(session, work, openAccess = false, pool = db.pool) {
  if (!openAccess && (!session?.user?.id || !session.user.email)) return json({ error: 'Sign in required.' }, 401);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!openAccess) {
      // Bind this verified Better Auth identity to an existing invitation only.
      await client.query(`UPDATE indago.members SET user_id = $1
        WHERE email = lower($2) AND user_id IS NULL`,
      [session.user.id, session.user.email]);
    }
    await client.query('SET LOCAL ROLE indago_app');
    await client.query("SELECT set_config('indago.user_id', $1, true)", [openAccess ? 'open-access' : session.user.id]);
    if (openAccess) await client.query("SELECT set_config('indago.open_access', 'on', true)");
    const member = openAccess ? { role: 'editor', facilitator: false } :
      (await client.query('SELECT role, facilitator FROM indago.members WHERE user_id = $1', [session.user.id])).rows[0];
    const role = member?.role;
    if (!role) { await client.query('ROLLBACK'); return json({ error: 'No Indago invitation.' }, 403); }
    const response = await work(client, role, member.facilitator === true);
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
  const openAccess = process.env.INDAGO_OPEN_ACCESS === 'true';
  const session = openAccess ? null : await auth.api.getSession({ headers: request.headers });
  return withMember(session, (client, role, facilitator) => route.startsWith('deliverables')
    ? handleDeliverables(request, client, role, route, getStore({ name: 'indago-deliverables', consistency: 'strong' }), openAccess)
    : handlePortalRequest(request, client, role, route, openAccess, facilitator, session?.user?.id), openAccess);
}

export const config = { path: '/api/indago/*' };
