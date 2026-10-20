import { timingSafeEqual } from 'node:crypto';
import { previewUsers } from './lib/preview-login.mjs';

const host = 'greatstone-indago-portal.netlify.app';

function validSecret(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function handleSeedRequest(request, env = process.env, load = async () => {
  const [{ db }, { auth }] = await Promise.all([
    import('./lib/db.mjs'), import('./lib/auth.mjs'),
  ]);
  return { db, auth };
}) {
  const url = new URL(request.url);
  const secret = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (request.method !== 'POST' || url.protocol !== 'https:' || url.hostname !== host ||
      env.INDAGO_SEED_MODE !== '1' || !validSecret(secret, env.INDAGO_SEED_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  const passwords = {
    editor: env.INDAGO_TEST_EDITOR_PASSWORD,
    viewer: env.INDAGO_TEST_VIEWER_PASSWORD,
  };
  if (Object.values(passwords).some(value => !value || value.length < 16) ||
      passwords.editor === passwords.viewer) {
    return Response.json({ error: 'Seed configuration is incomplete.' }, { status: 503 });
  }

  const { db, auth } = await load();
  for (const role of ['editor', 'viewer']) {
    const email = previewUsers[role];
    await db.pool.query(`INSERT INTO indago.members(email, role) VALUES($1, $2)
      ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role`, [email, role]);
    const existing = await db.pool.query('SELECT 1 FROM "user" WHERE email = $1', [email]);
    if (!existing.rows.length) {
      await auth.api.signUpEmail({ body: {
        name: `Preview ${role}`,
        email,
        password: passwords[role],
      } });
    }
  }
  return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export default async function handler(request) {
  return handleSeedRequest(request);
}

export const config = { path: '/api/seed-preview-users' };
