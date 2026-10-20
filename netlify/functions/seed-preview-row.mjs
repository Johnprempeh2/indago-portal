import { timingSafeEqual } from 'node:crypto';
import { demoState } from '../../src/fixture/demo-state.mjs';

const host = 'greatstone-indago-portal.netlify.app';
const fixtureSheets = [
  ['qa:toolkit', 'Delivery Toolkit', ['Toolkit JSON'], [], 1],
  ['qa:settings', 'Portal Settings', ['Settings'], [], 2],
  ['qa:risks', 'Risks & Issues', ['ID', 'Risk / issue', 'Likelihood', 'Impact', 'Owner', 'Response / mitigation', 'Status'], [0], 3],
];

function validSecret(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function handleSeedRequest(request, env = process.env, load = async () => {
  const { db } = await import('./lib/db.mjs');
  return db.pool;
}) {
  const url = new URL(request.url);
  const secret = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (request.method !== 'POST' || url.protocol !== 'https:' || url.hostname !== host ||
      url.pathname !== '/api/seed-preview-row' || env.INDAGO_ROW_SEED_MODE !== '1' ||
      !validSecret(secret, env.INDAGO_ROW_SEED_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const pool = await load();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE indago.sheets, indago.records IN EXCLUSIVE MODE');
    const existing = await client.query('SELECT EXISTS (SELECT 1 FROM indago.sheets) OR EXISTS (SELECT 1 FROM indago.records) AS present');
    if (existing.rows[0].present) {
      await client.query('ROLLBACK');
      return Response.json({ error: 'Preview workspace already has data.' }, { status: 409 });
    }
    for (const [id, title, columns, locked, position] of fixtureSheets) {
      await client.query(`INSERT INTO indago.sheets(id, title, source_name, columns, locked_columns, position)
        VALUES($1, $2, $3, $4, $5, $6)`,
      [id, title, 'Synthetic QA fixture', JSON.stringify(columns), JSON.stringify(locked), position]);
    }
    const records = [
      ['qa:toolkit', 'qa:toolkit', [JSON.stringify(demoState().toolkit)]],
      ['qa:settings', 'qa:settings', ['settings']],
      ['qa:risk-1', 'qa:risks', ['R01', 'Synthetic QA risk', 'Low', 'Low', 'Preview editor', 'Update this row for the two-account check', 'Open']],
    ];
    for (const [id, sheetId, values] of records) {
      await client.query(`INSERT INTO indago.records(id, sheet_id, position, source_values)
        VALUES($1, $2, 1, $3)`, [id, sheetId, JSON.stringify(values)]);
    }
    await client.query('COMMIT');
    return Response.json({ ready: true, sheets: fixtureSheets.length, records: records.length },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Preview row seed failed', error.code || error.name);
    return Response.json({ error: 'Preview row seed failed.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export default function handler(request) {
  return handleSeedRequest(request);
}

export const config = { path: '/api/seed-preview-row' };
