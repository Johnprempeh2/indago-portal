import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepDiveMcp, sha256Hex, TOOLS, checkInterview } from './mcp.mjs';
import { deepDiveMcpRpc } from './mcp-db.mjs';

const TOKEN = 'gsdd_' + 'a'.repeat(64);
const RUN = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const headers = (token = TOKEN) => ({ get: (n) => (n === 'authorization' && token ? `Bearer ${token}` : null) });
const call = (server, method, params, token) => server.handle({ method: 'POST', headers: headers(token),
  text: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => ({ ...r, json: JSON.parse(r.body) }));
const tool = (server, name, args, token) => call(server, 'tools/call', { name, arguments: args }, token);

function fakeDb(handler = () => ({ data: {}, error: null })) {
  const calls = [];
  return { calls, rpc: async (fn, params) => { calls.push({ fn, params }); return handler(fn, params); } };
}
const interview = (items, extra = {}) => ({ notion_page: 'https://www.notion.so/invented', meeting_title: 'Invented interview',
  held_on: '2026-11-11', interviewee: 'Invented Person, Role', question_source: 'NS-01', items, ...extra });

test('no or malformed token is refused before the database is touched', async () => {
  const db = fakeDb();
  const server = createDeepDiveMcp({ rpc: db.rpc });
  assert.equal((await call(server, 'tools/list', {}, null)).status, 401);
  assert.equal((await call(server, 'tools/list', {}, 'gspm_' + 'a'.repeat(64))).status, 401);
  assert.equal(db.calls.length, 0);
});

test('initialize checks the token; a revoked token fails at connect time', async () => {
  const db = fakeDb(() => ({ data: null, error: { code: '42501', message: 'invalid or revoked token' } }));
  const res = await call(createDeepDiveMcp({ rpc: db.rpc }), 'initialize', { protocolVersion: '2025-06-18' });
  assert.equal(res.status, 401);
  assert.equal(db.calls[0].params.p_token_sha256, await sha256Hex(TOKEN));
});

test('tools/list exposes the read tools and two draft-only writers, never a publish or approve tool', async () => {
  const res = await call(createDeepDiveMcp({ rpc: fakeDb().rpc }), 'tools/list', {});
  const names = res.json.result.tools.map((t) => t.name);
  assert.deepEqual(names, TOOLS.map((t) => t.name));
  assert.ok(!names.some((n) => /approve|publish|delete/.test(n)));
  assert.ok(res.json.result.tools.every((t) => !('rpc' in t)));
});

test('another engagement is refused by the database and the agent sees why', async () => {
  const db = fakeDb(() => ({ data: null, error: { code: '42501', message: 'this token is not for engagement other-client' } }));
  const res = await tool(createDeepDiveMcp({ rpc: db.rpc }), 'list_records', { engagement: 'other-client', sheet_id: 'findings' });
  assert.equal(res.json.result.isError, true);
  assert.match(res.json.result.content[0].text, /not for engagement other-client/);
  assert.equal(db.calls[0].params.p_engagement, 'other-client');
});

test('log_interview saves a draft with every question, and refuses guesses', async () => {
  const db = fakeDb(() => ({ data: { id: RUN, kind: 'interview_log', status: 'draft', version: 1 }, error: null }));
  const server = createDeepDiveMcp({ rpc: db.rpc });
  const items = [
    { ref: 'IND-NS-001.0.0', question: 'Q1', status: 'answered', answer: 'A', quote: 'Exact words.', at: '00:01:00' },
    { ref: 'IND-NS-001.0.1', question: 'Q2', status: 'not_answered' },
    { question: 'Q3', status: 'unclear', answer: 'Talked about something else' },
  ];
  const ok = await tool(server, 'log_interview', { engagement: 'indago', run_id: RUN, agent_id: AGENT,
    interview: interview(items, { outside_notes: [{ note: 'Mentioned a new data source', quote: 'We also have X.' }] }) });
  assert.equal(ok.json.result.isError, undefined);
  assert.deepEqual(ok.json.result.structuredContent.counts, { answered: 1, not_answered: 1, unclear: 1 });
  assert.match(ok.json.result.structuredContent.next_step, /DRAFT/);
  const saved = db.calls[0].params;
  assert.equal(saved.p_kind, 'interview_log');
  assert.equal(saved.p_draft_id, null);
  assert.equal(saved.p_payload.items.length, 3);

  assert.match(checkInterview(interview([{ question: 'Q', status: 'answered', answer: 'A' }])).join(), /quote is needed/);
  assert.match(checkInterview(interview([{ question: 'Q', status: 'not_answered', answer: 'guess' }])).join(), /use unclear/);
  assert.match(checkInterview(interview([{ question: 'Q', status: 'maybe' }])).join(), /status must be/);
  assert.match(checkInterview(interview([])).join(), /every question/);
  const bad = await tool(server, 'log_interview', { engagement: 'indago', run_id: RUN, agent_id: AGENT,
    interview: interview([{ question: 'Q', status: 'answered' }]) });
  assert.equal(bad.json.result.isError, true);
  assert.equal(db.calls.length, 1);
});

test('revising a draft needs the version last read', async () => {
  const db = fakeDb();
  const server = createDeepDiveMcp({ rpc: db.rpc });
  const args = { engagement: 'indago', run_id: RUN, agent_id: AGENT, sheet_id: 'findings', title: 'New finding', values: { Finding: 'x' } };
  const res = await tool(server, 'propose_record', { ...args, draft_id: RUN });
  assert.match(res.json.result.content[0].text, /expected_version/);
  await tool(server, 'propose_record', { ...args, draft_id: RUN, expected_version: 2 });
  assert.equal(db.calls[0].params.p_expected_version, 2);
  assert.deepEqual(db.calls[0].params.p_payload, { sheet_id: 'findings', values: { Finding: 'x' } });
});

test('unknown arguments and missing ids are refused', async () => {
  const db = fakeDb();
  const server = createDeepDiveMcp({ rpc: db.rpc });
  assert.match((await tool(server, 'list_drafts', { engagement: 'indago', extra: 1 })).json.result.content[0].text, /unknown arguments/);
  assert.match((await tool(server, 'propose_record', { engagement: 'indago', run_id: 'x', agent_id: AGENT, sheet_id: 's', title: 't', values: { a: 'b' } }))
    .json.result.content[0].text, /run_id must be a uuid/);
  assert.equal(db.calls.length, 0);
});

test('unexpected database errors are not passed to the agent', async () => {
  const logs = [];
  const db = fakeDb(() => ({ data: null, error: { code: 'XX000', message: 'internal detail' } }));
  const res = await tool(createDeepDiveMcp({ rpc: db.rpc, log: (...a) => logs.push(a) }), 'list_drafts', { engagement: 'indago' });
  assert.doesNotMatch(res.json.result.content[0].text, /internal detail/);
  assert.equal(logs.length, 1);
});

test('the database adapter runs each call as indago_mcp with typed named arguments', async () => {
  const queries = [];
  const client = { query: async (q, v) => { queries.push([q, v]); return { rows: [{ data: { ok: true } }] }; }, release() {} };
  const out = await deepDiveMcpRpc({ connect: async () => client }, 'mcp_get_draft', { p_token_sha256: 'h', p_engagement: 'indago', p_draft_id: RUN });
  assert.deepEqual(out, { data: { ok: true }, error: null });
  assert.deepEqual(queries.map(([q]) => q.split('(')[0]), ['BEGIN', 'SET LOCAL ROLE indago_mcp', 'SELECT indago.mcp_get_draft', 'COMMIT']);
  assert.match(queries[2][0], /p_draft_id => \$3::uuid/);
  await assert.rejects(deepDiveMcpRpc({ connect: async () => client }, 'mcp_register_token', {}), RangeError);
  await assert.rejects(deepDiveMcpRpc({ connect: async () => client }, 'mcp_get_draft', { p_token_sha256: 'h' }), RangeError);
});
