import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleNorthStar } from './north-star.mjs';

const seed = JSON.parse(readFileSync(new URL('../../../src/indago/north-star-seed.json', import.meta.url)));
const sql = readFileSync(new URL('../../database/migrations/0007_north_star/migration.sql', import.meta.url), 'utf8');
const request = (route, body) => new Request(`https://example.test/api/indago/${route}`, {
  method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function validateTemplate(template) {
  assert.equal(template.guardrails.length, 5);
  assert.equal(template.baseline.length, 7);
  assert.equal(template.runOfShow.length, 7);
  assert.equal(template.questions.length, 6);
  assert.equal(template.questions.reduce((sum, section) => sum + section.items.length, 0), 26);
  assert.equal(template.futures.length, 3);
  assert.equal(template.dimensions.length, 8);
  assert.equal(template.boundary.length, 7);
  assert.equal(template.convergence.length, 7);
  assert.equal(template.hypotheses.length, 6);
  assert.equal(template.recommendedRequests.length, 8);
}

test('NS-01 seed has the approved section counts and migration embeds the same text', () => {
  validateTemplate(seed);
  assert.deepEqual(JSON.parse(sql.match(/\$ns01\$(.*?)\$ns01\$/s)[1]), seed);
  assert.throws(() => validateTemplate({ ...seed, guardrails: seed.guardrails.slice(1) }));
});

test('approval is refused until Gordon acceptance is Yes', async () => {
  const client = { async query() { return { rows: [] }; } };
  const response = await handleNorthStar(request('north-star/field', {
    key: 'approval.status', value: 'Approved',
  }), client, 'editor', 'north-star/field');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Gordon acceptance/);
});

test('separate field saves use an upsert without a whole-record version', async () => {
  const writes = [];
  const client = { async query(sql, args) { writes.push({ sql, args }); return { rows: [{ field_key: args[1], value: args[2], version: 2 }] }; } };
  const response = await handleNorthStar(request('north-star/field', {
    key: 'question.0.verbatim', value: 'Invented words',
  }), client, 'editor', 'north-star/field');
  assert.equal(response.status, 200);
  assert.deepEqual(writes[0].args, ['IND-NS-001', 'question.0.verbatim', 'Invented words']);
  assert.match(writes[0].sql, /ON CONFLICT\(record_id, field_key\)/);
});

test('sending a hypothesis creates a linked Evidence request', async () => {
  const queries = [];
  const client = { async query(sql, args) {
    queries.push([sql, args]);
    if (sql.includes('SELECT field_key, value')) return { rows: [
      { field_key: 'hypothesis.NS-H-01.evidence', value: 'Invented source data' },
      { field_key: 'hypothesis.NS-H-01.owner', value: 'Demo owner' },
    ] };
    if (sql.includes('SELECT value')) return { rows: [] };
    if (sql.includes('max(position)')) return { rows: [{ next: 1 }] };
    return { rows: [] };
  } };
  const response = await handleNorthStar(request('north-star/send', { id: 'NS-H-01' }), client, 'editor', 'north-star/send');
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { requestId: 'IND-NS-RQ-001' });
  const insert = queries.find(([sql]) => sql.includes('INSERT INTO indago.records'));
  assert.deepEqual(JSON.parse(insert[1][2]), ['IND-NS-RQ-001', 'NS-H-01', 'Invented source data', 'Demo owner', '', '', 'IND-NS-001']);
});
