import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMemberSeed } from '../netlify/functions/indago-member-seed.mjs';

const token = 'a'.repeat(48);
const raw = JSON.stringify([
  { email: 'editor@example.test', role: 'editor', facilitator: false },
  { email: 'owner@example.test', role: 'editor', facilitator: true },
  { email: 'viewer@example.test', role: 'viewer', facilitator: false },
]);
const request = (method = 'POST', bearer = token) => new Request('https://example.test/api/indago-member-seed', {
  method, headers: { Authorization: `Bearer ${bearer}` },
});

test('refuses unauthorised and invalid seed requests without connecting', async () => {
  const pool = { connect: () => { throw new Error('must not connect'); } };
  assert.equal((await handleMemberSeed(request('GET'), { token, raw, pool })).status, 405);
  assert.equal((await handleMemberSeed(request('POST', 'wrong'), { token, raw, pool })).status, 404);
  assert.equal((await handleMemberSeed(request(), { token, raw: '[]', pool })).status, 503);
});

test('seeds only approved roles plus a synthetic viewer in one transaction', async () => {
  const queries = [];
  const client = { query: async (sql, params) => { queries.push([sql, params]); }, release() {} };
  const response = await handleMemberSeed(request(), { token, raw, pool: { connect: async () => client } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seeded: 4 });
  assert.equal(queries[0][0], 'BEGIN');
  assert.equal(queries.at(-1)[0], 'COMMIT');
  assert.deepEqual(queries.slice(1, -1).map(([, params]) => params), [
    ['editor@example.test', 'editor', false],
    ['owner@example.test', 'editor', true],
    ['viewer@example.test', 'viewer', false],
    ['participant@indago.test', 'viewer', false],
  ]);
  assert.ok(queries.slice(1, -1).every(([sql]) => sql.includes('ON CONFLICT (email)')));
});

test('rolls back a failed seed', async () => {
  const queries = [];
  const client = {
    query: async sql => { queries.push(sql); if (sql.startsWith('INSERT')) throw new Error('database unavailable'); },
    release() {},
  };
  const response = await handleMemberSeed(request(), { token, raw, pool: { connect: async () => client } });
  assert.equal(response.status, 500);
  assert.equal(queries.at(-1), 'ROLLBACK');
});
