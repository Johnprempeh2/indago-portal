import { timingSafeEqual } from 'node:crypto';

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
  if (!['invite', 'revoke-uninvited', 'seed-risk', 'remove-risk'].includes(action)) {
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
    } else {
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
