import { timingSafeEqual } from 'node:crypto';

const host = 'indago.greatstoneint.com';

function allowed(request, env) {
  const url = new URL(request.url);
  const supplied = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  const expected = env.INDAGO_QA_INVITE_TOKEN;
  if (request.method !== 'POST' || url.protocol !== 'https:' || url.hostname !== host ||
      env.INDAGO_QA_INVITE_ENABLED !== '1' || !supplied || !expected || expected.length < 32) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function invitees(env) {
  const editor = env.INDAGO_QA_EDITOR_EMAIL?.trim().toLowerCase();
  const viewer = env.INDAGO_QA_VIEWER_EMAIL?.trim().toLowerCase();
  const uninvited = env.INDAGO_QA_UNINVITED_EMAIL?.trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (![editor, viewer, uninvited].every(value => email.test(value || '')) ||
      new Set([editor, viewer, uninvited]).size !== 3) return null;
  return [{ email: editor, role: 'editor' }, { email: viewer, role: 'viewer' },
    { email: uninvited, role: 'viewer' }];
}

export async function handleQaInvite(request, env = process.env, load = async () => {
  const { db } = await import('./lib/db.mjs');
  return db;
}) {
  if (!allowed(request, env)) return new Response(null, { status: 404 });
  const users = invitees(env);
  if (!users) return Response.json({ error: 'Invite configuration is incomplete.' }, { status: 503 });
  let action;
  try {
    const raw = await request.text();
    if (raw.length > 64) throw new Error('size');
    action = JSON.parse(raw).action;
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!['invite', 'revoke-uninvited'].includes(action)) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const db = await load();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT email, role FROM indago.members WHERE email = ANY($1::text[]) FOR UPDATE',
      [users.map(user => user.email)],
    );
    if (action === 'invite' && existing.rows.length) {
      await client.query('ROLLBACK');
      return Response.json({ error: 'Test invite already exists.' }, { status: 409 });
    }
    if (action === 'revoke-uninvited') {
      const row = existing.rows.find(item => item.email === users[2].email);
      if (!row || row.role !== 'viewer') {
        await client.query('ROLLBACK');
        return Response.json({ error: 'Test account is not ready.' }, { status: 409 });
      }
      await client.query('DELETE FROM indago.members WHERE email = $1 AND role = $2',
        [users[2].email, 'viewer']);
    } else {
      for (const user of users) {
        await client.query('INSERT INTO indago.members(email, role) VALUES ($1, $2)',
          [user.email, user.role]);
      }
    }
    await client.query('COMMIT');
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await client.query('ROLLBACK');
    return Response.json({ error: 'Invitation failed.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export default function handler(request) {
  return handleQaInvite(request);
}

export const config = { path: '/api/indago-qa-invite' };
