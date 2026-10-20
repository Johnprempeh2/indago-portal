import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePortalRequest } from './portal-api.mjs';

const request = (method, body) => new Request('https://example.test/api/indago/save', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('Viewer cannot call a write action', async () => {
  const client = { query() { throw Error('database should not be reached'); } };
  const response = await handlePortalRequest(request('POST', { id: 'r1' }), client, 'viewer', 'save');
  assert.equal(response.status, 403);
});

test('save requires a version and writes only the edit overlay', async () => {
  const queries = [];
  const client = { async query(sql, values) { queries.push([sql, values]); return { rows: [{ id: 'r1', version: 2 }] }; } };
  const input = { id: 'r1', version: 1, edits: { 2: 'Done' }, source_values: ['changed'] };
  const response = await handlePortalRequest(request('POST', input), client, 'editor', 'save');
  assert.equal(response.status, 200);
  assert.deepEqual(queries[0][1], [input.edits, 'r1', 1]);
  assert.match(queries[0][0], /WHERE id = \$2 AND version = \$3/);
});

test('a stale save reports a conflict', async () => {
  const client = { async query() { return { rows: [] }; } };
  const response = await handlePortalRequest(request('POST', { id: 'r1', version: 1, edits: {} }), client, 'editor', 'save');
  assert.equal(response.status, 409);
});

test('malformed add data is rejected before SQL', async () => {
  const client = { query() { throw Error('database should not be reached'); } };
  const response = await handlePortalRequest(request('POST', {
    id: 'r1', sheet_id: 'risk', position: 1, source_values: ['safe', { unsafe: true }],
  }), client, 'editor', 'add');
  assert.equal(response.status, 400);
});
