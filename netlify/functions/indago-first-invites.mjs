import { timingSafeEqual } from 'node:crypto';

const host = 'indago.greatstoneint.com';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowed(request, env) {
  const url = new URL(request.url);
  const supplied = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  const expected = env.INDAGO_FIRST_INVITES_TOKEN;
  if (request.method !== 'POST' || url.protocol !== 'https:' || url.hostname !== host ||
      env.INDAGO_FIRST_INVITES_ENABLED !== '1' || !supplied || !expected || expected.length < 32) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function handleFirstInvites(request, env = process.env, load = async () => {
  const { db } = await import('./lib/db.mjs');
  return db;
}) {
  if (!allowed(request, env)) return new Response(null, { status: 404 });
  const editor = env.INDAGO_FIRST_EDITOR_EMAIL?.trim().toLowerCase();
  const viewer = env.INDAGO_FIRST_VIEWER_EMAIL?.trim().toLowerCase();
  if (!emailPattern.test(editor || '') || !emailPattern.test(viewer || '') || editor === viewer) {
    return Response.json({ error: 'Invite configuration is incomplete.' }, { status: 503 });
  }

  const db = await load();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // The table must still be empty. A changed membership list needs a fresh review.
    const existing = await client.query('SELECT count(*)::int AS total FROM indago.members');
    if (existing.rows[0].total !== 0) {
      await client.query('ROLLBACK');
      return Response.json({ error: 'Membership list changed.' }, { status: 409 });
    }
    await client.query('INSERT INTO indago.members(email, role) VALUES ($1, $2), ($3, $4)',
      [editor, 'editor', viewer, 'viewer']);
    await client.query('COMMIT');
    return Response.json({ ok: true, memberships: 2 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await client.query('ROLLBACK');
    return Response.json({ error: 'Invitation failed.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export default function handler(request) {
  return handleFirstInvites(request);
}

export const config = { path: '/api/indago-first-invites' };
