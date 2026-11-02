import { createHash, timingSafeEqual } from 'node:crypto';

const syntheticMember = { email: 'participant@indago.test', role: 'viewer', facilitator: false };
const json = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function authorised(request, token) {
  const supplied = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!supplied || !token || token.length < 32) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(token));
}

function staffMembers(raw) {
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length !== 3) throw new Error('Invalid member seed');
  const valid = rows.every(row => row && typeof row.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) && row.email === row.email.toLowerCase() &&
    ['editor', 'viewer'].includes(row.role) && typeof row.facilitator === 'boolean');
  const shape = rows.filter(row => row.role === 'editor' && row.facilitator).length === 1 &&
    rows.filter(row => row.role === 'editor' && !row.facilitator).length === 1 &&
    rows.filter(row => row.role === 'viewer' && !row.facilitator).length === 1;
  if (!valid || !shape || new Set(rows.map(row => row.email)).size !== 3 ||
    rows.some(row => row.email === syntheticMember.email)) throw new Error('Invalid member seed');
  return [...rows, syntheticMember];
}

export async function handleMemberSeed(request, { token, raw, pool }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!authorised(request, token)) return json({ error: 'Not found.' }, 404);
  let members;
  try { members = staffMembers(raw); }
  catch { return json({ error: 'Member seed is not configured.' }, 503); }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    for (const member of members) {
      await client.query(`INSERT INTO indago.members (email, role, facilitator)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET
          role = EXCLUDED.role, facilitator = EXCLUDED.facilitator`,
      [member.email, member.role, member.facilitator]);
    }
    await client.query('COMMIT');
    return json({ seeded: members.length }, 200);
  } catch {
    if (client) await client.query('ROLLBACK');
    return json({ error: 'Member seed failed.' }, 500);
  } finally {
    client?.release();
  }
}

export default async function handler(request) {
  const token = process.env.INDAGO_MEMBER_SEED_TOKEN;
  const raw = process.env.INDAGO_MEMBER_SEED;
  // Never open a database connection before checking the one-time token.
  if (!authorised(request, token) || request.method !== 'POST') {
    return json({ error: 'Not found.' }, 404);
  }
  const { db } = await import('./lib/db.mjs');
  return handleMemberSeed(request, { token, raw, pool: db.pool });
}

export const config = { path: '/api/indago-member-seed' };
