import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAgentDrafts } from './agent-drafts.mjs';

const ID = '33333333-3333-4333-8333-333333333333';
const req = (route, body) => new Request(`https://example.test/api/indago/${route}`,
  body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
const who = { role: 'editor', facilitator: true, openAccess: false, userId: 'fac-1' };

function fakeClient(draft, sheet = { id: 'findings', columns: ['ID', 'Finding', 'Source'] }) {
  const queries = [];
  return { queries, async query(q, v) {
    queries.push([q, v]);
    if (/FROM indago.mcp_drafts WHERE id/.test(q)) return { rows: draft ? [draft] : [] };
    if (/FROM indago.sheets/.test(q)) return { rows: sheet ? [sheet] : [] };
    if (/max\(position\)/.test(q)) return { rows: [{ p: 4 }] };
    if (/UPDATE indago.mcp_drafts/.test(q)) return { rows: [{ ...draft, status: v[0] }] };
    return { rows: [] };
  } };
}

test('only a named facilitator reviews drafts', async () => {
  for (const w of [{ ...who, facilitator: false }, { ...who, openAccess: true }]) {
    assert.equal((await handleAgentDrafts(req('agent-drafts'), fakeClient(), 'agent-drafts', w)).status, 403);
  }
});

test('approving a proposed row adds it in column order, as the facilitator', async () => {
  const draft = { id: ID, kind: 'record', status: 'draft', version: 2, payload: { sheet_id: 'findings', values: { Finding: 'F', ID: 'X-1' } } };
  const client = fakeClient(draft);
  const res = await handleAgentDrafts(req(`agent-drafts/${ID}/decision`, { decision: 'approve', version: 2 }), client, `agent-drafts/${ID}/decision`, who);
  assert.equal(res.status, 200);
  const insert = client.queries.find(([q]) => /INSERT INTO indago.records/.test(q));
  assert.deepEqual(JSON.parse(insert[1][3]), ['X-1', 'F', '']);
  assert.equal(insert[1][2], 4);
  const update = client.queries.find(([q]) => /UPDATE indago.mcp_drafts/.test(q));
  assert.deepEqual(update[1].slice(0, 2), ['approved', 'fac-1']);
});

test('a stale or decided draft, or an unknown column, is refused', async () => {
  const draft = { id: ID, kind: 'record', status: 'draft', version: 2, payload: { sheet_id: 'findings', values: { Nope: 'x' } } };
  const route = `agent-drafts/${ID}/decision`;
  assert.equal((await handleAgentDrafts(req(route, { decision: 'approve', version: 1 }), fakeClient(draft), route, who)).status, 409);
  assert.equal((await handleAgentDrafts(req(route, { decision: 'approve', version: 2 }), fakeClient({ ...draft, status: 'approved' }), route, who)).status, 409);
  const client = fakeClient(draft);
  const res = await handleAgentDrafts(req(route, { decision: 'approve', version: 2 }), client, route, who);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Nope/);
  assert.ok(!client.queries.some(([q]) => /INSERT INTO indago.records/.test(q)));
});

test('rejecting an interview log records the note and adds nothing', async () => {
  const draft = { id: ID, kind: 'interview_log', status: 'draft', version: 1, payload: { items: [] } };
  const client = fakeClient(draft);
  const route = `agent-drafts/${ID}/decision`;
  const res = await handleAgentDrafts(req(route, { decision: 'reject', version: 1, note: 'Q3 is wrong' }), client, route, who);
  assert.equal(res.status, 200);
  assert.ok(!client.queries.some(([q]) => /INSERT/.test(q)));
  assert.equal(client.queries.at(-1)[1][2], 'Q3 is wrong');
});
