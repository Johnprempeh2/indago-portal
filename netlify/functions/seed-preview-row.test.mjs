import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSeedRequest } from './seed-preview-row.mjs';
import { recordsToState } from '../../src/data/record-store.mjs';

const url = 'https://greatstone-indago-portal.netlify.app/api/seed-preview-row';
const env = { INDAGO_ROW_SEED_MODE: '1', INDAGO_ROW_SEED_TOKEN: 'synthetic-test-token' };
const request = (target = url, token = env.INDAGO_ROW_SEED_TOKEN, method = 'POST') =>
  new Request(target, { method, headers: { Authorization: `Bearer ${token}` } });

test('seed denies wrong secret, host, path, method and disabled mode before database access', async () => {
  const noDb = async () => { throw new Error('Database reached'); };
  for (const [req, config] of [
    [request(url, 'wrong'), env],
    [request('https://other.netlify.app/api/seed-preview-row'), env],
    [request('https://greatstone-indago-portal.netlify.app/api/other'), env],
    [request(url, env.INDAGO_ROW_SEED_TOKEN, 'GET'), env],
    [request(), { ...env, INDAGO_ROW_SEED_MODE: '0' }],
  ]) assert.equal((await handleSeedRequest(req, config, noDb)).status, 404);
});

test('seed writes only fixed synthetic sheets and rows in one transaction', async () => {
  const queries = [];
  const client = { query: async (sql, args) => {
    queries.push([sql, args]);
    return sql.startsWith('SELECT EXISTS') ? { rows: [{ present: false }] } : { rows: [] };
  }, release() { queries.push(['RELEASE']); } };
  const response = await handleSeedRequest(request(), env, async () => ({ connect: async () => client }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true, sheets: 3, records: 3 });
  assert.equal(queries[0][0], 'BEGIN');
  assert.equal(queries.at(-2)[0], 'COMMIT');
  assert.equal(queries.filter(([sql]) => sql.startsWith('INSERT INTO indago.sheets')).length, 3);
  assert.equal(queries.filter(([sql]) => sql.startsWith('INSERT INTO indago.records')).length, 3);
  assert(queries.flatMap(([, args]) => args || []).join(' ').includes('Synthetic QA risk'));
  const sheets = queries.filter(([sql]) => sql.startsWith('INSERT INTO indago.sheets'))
    .map(([, [id, title, , columns]]) => ({ id, title, columns: JSON.parse(columns) }));
  const records = queries.filter(([sql]) => sql.startsWith('INSERT INTO indago.records'))
    .map(([, [id, sheet_id, source_values]]) => ({ id, sheet_id, source_values: JSON.parse(source_values), edits: {}, position: 1 }));
  const state = recordsToState({ sheets, records });
  assert.equal(state.toolkit.rules[0].startsWith('Demo rule:'), true);
  assert.equal(state.risks[0].risk, 'Synthetic QA risk');
});

test('seed refuses a workspace with existing data', async () => {
  const queries = [];
  const client = { query: async sql => {
    queries.push(sql);
    return sql.startsWith('SELECT EXISTS') ? { rows: [{ present: true }] } : { rows: [] };
  }, release() {} };
  const response = await handleSeedRequest(request(), env, async () => ({ connect: async () => client }));
  assert.equal(response.status, 409);
  assert(queries.includes('ROLLBACK'));
  assert(!queries.some(sql => sql.startsWith('INSERT')));
});
