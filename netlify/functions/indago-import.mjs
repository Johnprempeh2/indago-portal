import { timingSafeEqual } from 'node:crypto';
import { previewUsers } from './lib/preview-login.mjs';

const host = 'indago.greatstoneint.com';
const sheetIds = [
  'plan:Work Breakdown', 'plan:Stage Gates', 'plan:Milestones', 'plan:Risks & Issues',
  'register:Client Findings', 'register:Information Requests', 'register:New Deep Dive Evidence',
  'register:Service Processes', 'register:Commercial Baseline', 'register:Findings',
  'register:Opportunities', 'register:Decisions', 'register:GDXP Traceability',
  'register:Validation Log', 'toolkit:Delivery Toolkit', 'portal:Portal Settings',
];
const requiredCounts = new Map([
  ['plan:Work Breakdown', 41], ['plan:Stage Gates', 6],
  ['register:Client Findings', 140], ['register:Information Requests', 31],
]);

function authorised(request, env) {
  const url = new URL(request.url);
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  const expected = env.INDAGO_IMPORT_TOKEN;
  if (request.method !== 'POST' || url.protocol !== 'https:' || url.hostname !== host ||
      env.INDAGO_IMPORT_ENABLED !== '1' || !token || !expected || expected.length < 32) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validPayload(body) {
  if (!body || !Array.isArray(body.sheets) || body.sheets.length !== sheetIds.length) return false;
  const ids = new Set();
  for (const sheet of body.sheets) {
    if (!sheet || !sheetIds.includes(sheet.id) || ids.has(sheet.id) ||
        typeof sheet.title !== 'string' || sheet.title !== sheet.id.split(':')[1] ||
        sheet.source_name !== sheet.id.split(':')[0] ||
        !Number.isInteger(sheet.position) || sheet.position < 0 ||
        !Array.isArray(sheet.columns) || !sheet.columns.every(x => typeof x === 'string') ||
        !Array.isArray(sheet.locked_columns) ||
        !sheet.locked_columns.every(x => Number.isInteger(x) && x >= 0 && x < sheet.columns.length) ||
        !Array.isArray(sheet.records)) return false;
    ids.add(sheet.id);
    const required = requiredCounts.get(sheet.id);
    if (required !== undefined && sheet.records.length !== required) return false;
    const locks = sheet.id === 'register:Client Findings' ? [0, 1, 2, 3, 4] :
      sheet.id === 'register:Information Requests' ? [0, 1, 2] : [];
    if (!locks.every(x => sheet.locked_columns.includes(x))) return false;
    for (const [index, record] of sheet.records.entries()) {
      if (record?.id !== `${sheet.id}:${index + 1}` || record.sheet_id !== sheet.id ||
          record.position !== index + 1 || !Array.isArray(record.source_values) ||
          record.source_values.length !== sheet.columns.length ||
          !record.source_values.every(x => typeof x === 'string')) return false;
    }
  }
  return ids.size === sheetIds.length &&
    new Set(body.sheets.map(x => x.position)).size === sheetIds.length;
}

export async function handleImportRequest(request, env = process.env, load = async () => {
  const { db } = await import('./lib/db.mjs');
  return db;
}) {
  if (!authorised(request, env)) return new Response(null, { status: 404 });
  if (env.INDAGO_TEST_LOGIN === '1') return Response.json({ error: 'Import unavailable.' }, { status: 503 });
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4_000_000) throw new Error('size');
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid import.' }, { status: 400 });
  }
  if (!validPayload(body)) return Response.json({ error: 'Invalid import.' }, { status: 400 });

  const db = await load();
  const client = await db.pool.connect();
  let phase = 'begin';
  try {
    await client.query('BEGIN');
    phase = 'remove-preview-users';
    for (const email of Object.values(previewUsers)) {
      await client.query('DELETE FROM indago.members WHERE email = $1', [email]);
      await client.query('DELETE FROM "user" WHERE email = $1', [email]);
    }
    for (const sheet of body.sheets) {
      phase = 'insert-sheet';
      await client.query(`INSERT INTO indago.sheets
        (id, title, source_name, columns, locked_columns, position) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO NOTHING`, [sheet.id, sheet.title, sheet.source_name,
        JSON.stringify(sheet.columns), JSON.stringify(sheet.locked_columns), sheet.position]);
      phase = 'read-sheet';
      const existingSheet = await client.query(`SELECT title, source_name, columns, locked_columns, position
        FROM indago.sheets WHERE id = $1`, [sheet.id]);
      const saved = existingSheet.rows[0];
      if (!saved || saved.title !== sheet.title || saved.source_name !== sheet.source_name ||
          JSON.stringify(saved.columns) !== JSON.stringify(sheet.columns) ||
          JSON.stringify(saved.locked_columns) !== JSON.stringify(sheet.locked_columns) ||
          saved.position !== sheet.position) throw new Error('sheet mismatch');
      for (const record of sheet.records) {
        phase = 'insert-record';
        await client.query(`INSERT INTO indago.records (id, sheet_id, position, source_values)
          VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [record.id, record.sheet_id, record.position, JSON.stringify(record.source_values)]);
        phase = 'read-record';
        const existing = await client.query(`SELECT sheet_id, position, source_values
          FROM indago.records WHERE id = $1`, [record.id]);
        const row = existing.rows[0];
        if (!row || row.sheet_id !== record.sheet_id || row.position !== record.position ||
            JSON.stringify(row.source_values) !== JSON.stringify(record.source_values)) {
          throw new Error('record mismatch');
        }
      }
    }
    phase = 'verify-counts';
    const counts = {};
    for (const [id, expected] of requiredCounts) {
      const result = await client.query('SELECT count(*)::integer AS count FROM indago.records WHERE sheet_id = $1', [id]);
      counts[id] = result.rows[0]?.count;
      if (counts[id] !== expected) throw new Error('count mismatch');
    }
    phase = 'verify-locks';
    const locks = await client.query(`SELECT id, locked_columns FROM indago.sheets
      WHERE id IN ('register:Client Findings', 'register:Information Requests')`);
    if (locks.rows.length !== 2 || locks.rows.some(row => {
      const required = row.id === 'register:Client Findings' ? [0, 1, 2, 3, 4] : [0, 1, 2];
      return !required.every(index => row.locked_columns.includes(index));
    })) throw new Error('lock mismatch');
    phase = 'commit';
    await client.query('COMMIT');
    return Response.json({ counts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await client.query('ROLLBACK');
    const code = /^[A-Z0-9]{5}$/.test(error?.code ?? '') ? error.code : undefined;
    return Response.json({ error: 'Import failed; no changes were committed.', phase, code },
      { status: 500 });
  } finally {
    client.release();
  }
}

export default async function handler(request) {
  return handleImportRequest(request);
}

export const config = { path: '/api/indago-import' };
