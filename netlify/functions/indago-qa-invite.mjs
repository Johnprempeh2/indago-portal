import { randomUUID, timingSafeEqual } from 'node:crypto';
import { captureQaLinks } from './lib/qa-links.mjs';

const host = 'indago.greatstoneint.com';
const qaRiskId = 'qa:cross-user-risk';
const qaRiskLabel = 'Synthetic QA row; safe to edit';

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

const users = Object.freeze([
  { email: 'editor@indago-test.invalid', role: 'editor' },
  { email: 'viewer@indago-test.invalid', role: 'viewer' },
  { email: 'uninvited@indago-test.invalid', role: null },
]);

async function issueLinks(env) {
  const { auth } = await import('./lib/auth.mjs');
  const base = env.BETTER_AUTH_URL;
  if (!base?.startsWith('https://')) throw new Error('Auth URL is missing');
  const { links } = await captureQaLinks(async () => {
    for (const user of users) {
      const response = await auth.handler(new Request(new URL('/api/auth/sign-in/magic-link', base), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ email: user.email, callbackURL: '/portal/indago' }),
      }));
      if (!response.ok) throw new Error('QA link creation failed');
    }
  });
  if (links.size !== users.length) throw new Error('QA links are incomplete');
  return Object.fromEntries(links);
}

export async function handleQaInvite(request, env = process.env, load = async () => {
  const { db } = await import('./lib/db.mjs');
  return db;
}, links = issueLinks) {
  if (!allowed(request, env)) return new Response(null, { status: 404 });
  let action;
  try {
    const raw = await request.text();
    if (raw.length > 64) throw new Error('size');
    action = JSON.parse(raw).action;
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!['invite', 'links', 'remove-users', 'seed-risk', 'remove-risk'].includes(action)) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const db = await load();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (action === 'seed-risk') {
      const sheet = await client.query(
        'SELECT id, columns FROM indago.sheets WHERE id = $1 FOR SHARE', ['plan:Risks & Issues']);
      const existingRisk = await client.query('SELECT id FROM indago.records WHERE id = $1', [qaRiskId]);
      if (sheet.rows.length !== 1 || !Array.isArray(sheet.rows[0].columns) ||
          sheet.rows[0].columns.length < 2 || existingRisk.rows.length) {
        await client.query('ROLLBACK');
        return Response.json({ error: 'Test row is not ready.' }, { status: 409 });
      }
      const position = await client.query(
        'SELECT coalesce(max(position), 0) + 1 AS next FROM indago.records WHERE sheet_id = $1',
        ['plan:Risks & Issues']);
      const values = Array(sheet.rows[0].columns.length).fill('');
      values[0] = 'QA-ONLY';
      values[1] = qaRiskLabel;
      await client.query('INSERT INTO indago.records(id, sheet_id, position, source_values) VALUES ($1, $2, $3, $4)',
        [qaRiskId, 'plan:Risks & Issues', position.rows[0].next, JSON.stringify(values)]);
    } else if (action === 'remove-risk') {
      const row = await client.query('SELECT sheet_id, source_values FROM indago.records WHERE id = $1 FOR UPDATE',
        [qaRiskId]);
      if (row.rows.length !== 1 || row.rows[0].sheet_id !== 'plan:Risks & Issues' ||
          row.rows[0].source_values?.[0] !== 'QA-ONLY' ||
          row.rows[0].source_values?.[1] !== qaRiskLabel) {
        await client.query('ROLLBACK');
        return Response.json({ error: 'Test row does not match.' }, { status: 409 });
      }
      await client.query('DELETE FROM indago.history WHERE record_id = $1', [qaRiskId]);
      await client.query('DELETE FROM indago.records WHERE id = $1', [qaRiskId]);
    } else if (action === 'invite' || action === 'remove-users') {
      const members = await client.query(
        'SELECT email, role, user_id FROM indago.members WHERE email = ANY($1::text[]) FOR UPDATE',
        [users.map(user => user.email)],
      );
      const accounts = await client.query(
        'SELECT id, email FROM "user" WHERE email = ANY($1::text[]) FOR UPDATE',
        [users.map(user => user.email)],
      );
      if (action === 'invite' && (members.rows.length || accounts.rows.length)) {
        await client.query('ROLLBACK');
        return Response.json({ error: 'Test identity already exists.' }, { status: 409 });
      }
      if (action === 'remove-users') {
        if (members.rows.length !== 2 || accounts.rows.length !== 3 ||
            members.rows.some(row => !users.slice(0, 2).some(user =>
              user.email === row.email && user.role === row.role && row.user_id ===
              accounts.rows.find(account => account.email === row.email)?.id))) {
          await client.query('ROLLBACK');
          return Response.json({ error: 'Test identities do not match.' }, { status: 409 });
        }
        await client.query('DELETE FROM indago.members WHERE email = ANY($1::text[])',
          [users.slice(0, 2).map(user => user.email)]);
        await client.query('DELETE FROM "user" WHERE email = ANY($1::text[])',
          [users.map(user => user.email)]);
      } else {
        for (const user of users) {
          const id = randomUUID();
          await client.query('INSERT INTO "user"(id, name, email, "emailVerified") VALUES ($1, $2, $3, true)',
            [id, `QA ${user.role || 'uninvited'}`, user.email]);
          if (user.role) await client.query('INSERT INTO indago.members(email, role, user_id) VALUES ($1, $2, $3)',
            [user.email, user.role, id]);
        }
      }
    } else if (action === 'links') {
      const accounts = await client.query('SELECT email FROM "user" WHERE email = ANY($1::text[])',
        [users.map(user => user.email)]);
      const members = await client.query('SELECT email, role FROM indago.members WHERE email = ANY($1::text[])',
        [users.map(user => user.email)]);
      if (accounts.rows.length !== 3 || members.rows.length !== 2 ||
          members.rows.some(row => !users.slice(0, 2).some(user =>
            user.email === row.email && user.role === row.role))) {
        await client.query('ROLLBACK');
        return Response.json({ error: 'Test identities are not ready.' }, { status: 409 });
      }
    }
    await client.query('COMMIT');
    if (action === 'links') {
      const result = await links(env);
      return Response.json({ links: result }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* Transaction already closed. */ }
    return Response.json({ error: 'Invitation failed.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export default function handler(request) {
  return handleQaInvite(request);
}

export const config = { path: '/api/indago-qa-invite' };
