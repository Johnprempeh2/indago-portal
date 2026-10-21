import test from 'node:test';
import assert from 'node:assert/strict';
import { handleImportRequest } from '../netlify/functions/indago-import.mjs';

const ids = [
  'plan:Work Breakdown', 'plan:Stage Gates', 'plan:Milestones', 'plan:Risks & Issues',
  'register:Client Findings', 'register:Information Requests', 'register:New Deep Dive Evidence',
  'register:Service Processes', 'register:Commercial Baseline', 'register:Findings',
  'register:Opportunities', 'register:Decisions', 'register:GDXP Traceability',
  'register:Validation Log', 'toolkit:Delivery Toolkit', 'portal:Portal Settings',
];
const counts = { 'plan:Work Breakdown': 41, 'plan:Stage Gates': 6,
  'register:Client Findings': 140, 'register:Information Requests': 31 };
const sheets = ids.map((id, position) => {
  const [source_name, title] = id.split(':');
  const columns = ['one', 'two', 'three', 'four', 'five'];
  const locked_columns = id === 'register:Client Findings' ? [0, 1, 2, 3, 4] :
    id === 'register:Information Requests' ? [0, 1, 2] : [0];
  return { id, source_name, title, position, columns, locked_columns,
    records: Array.from({ length: counts[id] ?? 1 }, (_, index) => ({
      id: `${id}:${index + 1}`, sheet_id: id, position: index + 1,
      source_values: ['', '', '', '', ''],
    })) };
});
const env = { INDAGO_IMPORT_ENABLED: '1', INDAGO_IMPORT_TOKEN: 'a'.repeat(48), INDAGO_TEST_LOGIN: '0' };
const url = 'https://indago.greatstoneint.com/api/indago-import';
const request = (body, token = env.INDAGO_IMPORT_TOKEN) => new Request(url, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

test('import stays hidden without the exact gate and token', async () => {
  let called = false;
  const load = async () => { called = true; throw new Error('must not load database'); };
  assert.equal((await handleImportRequest(request({ sheets }, 'wrong'), env, load)).status, 404);
  assert.equal((await handleImportRequest(request({ sheets }), { ...env, INDAGO_IMPORT_ENABLED: '0' }, load)).status, 404);
  assert.equal(called, false);
});

test('a count mismatch rolls back the preview removal and all imported rows', async () => {
  const calls = [];
  let sheet;
  let record;
  const client = {
    release() {},
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.includes('INSERT INTO indago.sheets')) {
        sheet = { title: values[1], source_name: values[2], columns: JSON.parse(values[3]),
          locked_columns: JSON.parse(values[4]), position: values[5] };
      }
      if (sql.includes('SELECT title, source_name')) return { rows: [sheet] };
      if (sql.includes('INSERT INTO indago.records')) {
        record = { sheet_id: values[1], position: values[2], source_values: JSON.parse(values[3]) };
      }
      if (sql.includes('SELECT sheet_id, position')) return { rows: [record] };
      if (sql.includes('SELECT count(*)')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
  };
  const response = await handleImportRequest(request({ sheets }), env, async () => ({ pool: {
    connect: async () => client,
  } }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Import failed; no changes were committed.', phase: 'verify-counts',
  });
  assert.ok(calls.includes('BEGIN'));
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.includes('COMMIT'), false);
});

test('valid import commits exact counts and locked client columns', async () => {
  const calls = [];
  let sheet;
  let record;
  const client = {
    release() {},
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.includes('INSERT INTO indago.sheets')) {
        sheet = { title: values[1], source_name: values[2], columns: JSON.parse(values[3]),
          locked_columns: JSON.parse(values[4]), position: values[5] };
      }
      if (sql.includes('SELECT title, source_name')) return { rows: [sheet] };
      if (sql.includes('INSERT INTO indago.records')) {
        record = { sheet_id: values[1], position: values[2], source_values: JSON.parse(values[3]) };
      }
      if (sql.includes('SELECT sheet_id, position')) return { rows: [record] };
      if (sql.includes('SELECT count(*)')) return { rows: [{ count: counts[values[0]] }] };
      if (sql.includes('SELECT id, locked_columns')) return { rows: sheets
        .filter(x => x.id === 'register:Client Findings' || x.id === 'register:Information Requests')
        .map(x => ({ id: x.id, locked_columns: x.locked_columns })) };
      return { rows: [] };
    },
  };
  const response = await handleImportRequest(request({ sheets }), env, async () => ({ pool: {
    connect: async () => client,
  } }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).counts, counts);
  assert.ok(calls.includes('COMMIT'));
  assert.equal(calls.includes('ROLLBACK'), false);
});


test('database errors expose only a safe phase and SQLSTATE', async () => {
  const client = {
    release() {},
    async query(sql) {
      if (sql.includes('DELETE FROM indago.members')) {
        throw Object.assign(new Error('sensitive database detail'), { code: '42501' });
      }
      return { rows: [] };
    },
  };
  const response = await handleImportRequest(request({ sheets }), env, async () => ({ pool: {
    connect: async () => client,
  } }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Import failed; no changes were committed.', phase: 'remove-preview-users', code: '42501',
  });
});

test('known preview fixture is removed in the import transaction', async () => {
  const calls = [];
  const fixtureSheets = [
    { id: 'qa:toolkit', title: 'Delivery Toolkit', source_name: 'Synthetic QA fixture', position: 1 },
    { id: 'qa:settings', title: 'Portal Settings', source_name: 'Synthetic QA fixture', position: 2 },
    { id: 'qa:risks', title: 'Risks & Issues', source_name: 'Synthetic QA fixture', position: 3 },
  ];
  const fixtureRecords = [
    { id: 'qa:toolkit', sheet_id: 'qa:toolkit', position: 1 },
    { id: 'qa:settings', sheet_id: 'qa:settings', position: 1 },
    { id: 'qa:risk-1', sheet_id: 'qa:risks', position: 1 },
  ];
  let sheet;
  let record;
  const client = {
    release() {},
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.includes('SELECT id, title, source_name, position')) return { rows: fixtureSheets };
      if (sql.includes('SELECT id, sheet_id, position')) return { rows: fixtureRecords };
      if (sql.includes('INSERT INTO indago.sheets')) {
        sheet = { title: values[1], source_name: values[2], columns: JSON.parse(values[3]),
          locked_columns: JSON.parse(values[4]), position: values[5] };
      }
      if (sql.includes('SELECT title, source_name')) return { rows: [sheet] };
      if (sql.includes('INSERT INTO indago.records')) {
        record = { sheet_id: values[1], position: values[2], source_values: JSON.parse(values[3]) };
      }
      if (sql.includes('SELECT sheet_id, position')) return { rows: [record] };
      if (sql.includes('SELECT count(*)')) return { rows: [{ count: counts[values[0]] }] };
      if (sql.includes('SELECT id, locked_columns')) return { rows: sheets
        .filter(x => x.id === 'register:Client Findings' || x.id === 'register:Information Requests')
        .map(x => ({ id: x.id, locked_columns: x.locked_columns })) };
      return { rows: [] };
    },
  };
  const response = await handleImportRequest(request({ sheets }), env, async () => ({ pool: {
    connect: async () => client,
  } }));
  assert.equal(response.status, 200);
  const deletes = calls.filter(sql => sql.startsWith('DELETE FROM indago.'));
  assert.deepEqual(deletes.map(sql => sql.match(/^DELETE FROM indago\.\w+/)[0]), [
    'DELETE FROM indago.members', 'DELETE FROM indago.members',
    'DELETE FROM indago.history', 'DELETE FROM indago.records', 'DELETE FROM indago.sheets',
  ]);
  assert.ok(calls.indexOf('DELETE FROM indago.sheets WHERE id = ANY($1::text[])') <
    calls.findIndex(sql => sql.includes('INSERT INTO indago.sheets')));
  assert.ok(calls.includes('COMMIT'));
});

test('unexpected preview fixture rolls back before deleting rows', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql) {
      calls.push(sql);
      if (sql.includes('SELECT id, title, source_name, position')) return { rows: [
        { id: 'qa:toolkit', title: 'Unexpected title', source_name: 'Synthetic QA fixture', position: 1 },
      ] };
      return { rows: [] };
    },
  };
  const response = await handleImportRequest(request({ sheets }), env, async () => ({ pool: {
    connect: async () => client,
  } }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Import failed; no changes were committed.', phase: 'remove-preview-fixture',
  });
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some(sql => sql.startsWith('DELETE FROM indago.history')), false);
  assert.equal(calls.some(sql => sql.includes('INSERT INTO indago.sheets')), false);
});
