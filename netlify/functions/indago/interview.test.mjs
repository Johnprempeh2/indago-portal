import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInterview, writeAiDraft } from './interview.mjs';
import { MOVES } from '../../../src/indago/model/interview.mjs';

function memoryClient() {
  const sessions = new Map();
  const answers = [];
  const challenges = [];
  return {
    sessions, answers, challenges,
    async query(sql, args = []) {
      if (sql.startsWith('INSERT INTO indago.client_interviews')) { sessions.set(args[0], { id: args[0], owner_id: args[1], ai_assisted: args[2], record_id: 'IND-NS-001', gate: 'G2', status: 'in_progress', corrected_summary: '', draft: null }); return { rows: [] }; }
      if (sql.startsWith('SELECT id, status, updated_at')) return { rows: [...sessions.values()] };
      if (sql.startsWith('SELECT * FROM indago.client_interviews')) return { rows: [sessions.get(args[0])].filter(Boolean) };
      if (sql.startsWith('SELECT id, move, original')) return { rows: answers.filter(a => a.session_id === args[0]) };
      if (sql.startsWith('SELECT c.id')) return { rows: challenges.filter(c => answers.some(a => a.id === c.answer_id && a.session_id === args[0])) };
      if (sql.startsWith('INSERT INTO indago.client_interview_answers')) { answers.push({ id: args[0], session_id: args[1], move: args[2], original: args[3] }); return { rows: [] }; }
      if (sql.startsWith('UPDATE indago.client_interviews SET next_question')) { sessions.get(args[1]).next_question = args[0]; return { rows: [] }; }
      if (sql.startsWith('INSERT INTO indago.client_interview_challenges')) { challenges.push({ id: args[0], answer_id: args[1], question: args[2], reply: '' }); return { rows: [] }; }
      if (sql.startsWith('UPDATE indago.client_interview_challenges')) { const c = challenges.find(c => c.id === args[1] && !c.reply); if (c) c.reply = args[0]; return { rows: c ? [{ id: c.id }] : [] }; }
      if (sql.startsWith("UPDATE indago.client_interviews SET ai_draft = 'running'")) { const s = sessions.get(args[0]); if (!s || s.owner_id !== args[1] || s.status !== 'submitted' || s.ai_draft !== 'pending') return { rows: [] }; s.ai_draft = 'running'; return { rows: [{ id: s.id }] }; }
      if (sql.startsWith('UPDATE indago.client_interviews SET draft = $1, ai_draft')) { const s = sessions.get(args[2]); if (s.ai_draft === 'running') { s.draft = JSON.parse(args[0]); s.ai_draft = args[1]; } return { rows: [] }; }
      if (sql.startsWith('UPDATE indago.client_interviews')) { const s = sessions.get(args[3]); s.corrected_summary = args[0]; s.draft = JSON.parse(args[1]); s.ai_draft = args[2]; s.status = 'submitted'; return { rows: [] }; }
      throw new Error(`Unexpected query: ${sql.slice(0, 60)}`);
    },
  };
}
const post = body => new Request('https://example.test/api/indago/interviews', { method: 'POST', body: JSON.stringify(body) });

test('API keeps first words, stores challenges separately, and submits only a draft', async () => {
  const client = memoryClient();
  assert.equal((await handleInterview(post({ consent: true }), client, 'interviews', 'open-access', false, true)).status, 403);
  assert.equal((await handleInterview(post({}), client, 'interviews', 'client-one')).status, 400);
  const created = await handleInterview(post({ consent: true }), client, 'interviews', 'client-one');
  assert.equal(created.status, 201);
  let session = await created.json();
  const id = session.id;
  for (const [index, move] of MOVES.entries()) {
    const original = move.id === 'convergence' ? 'Direction\nOutcome one\nOutcome two\nOutcome three' : `Original ${index}\nLine 2`;
    const response = await handleInterview(post({ move: move.id, original }), client, `interviews/${id}/answers`, 'client-one');
    assert.equal(response.status, 200);
    session = await response.json();
  }
  const first = session.answers[0];
  const duplicate = await handleInterview(post({ move: 'ambition', original: 'Changed' }), client, `interviews/${id}/answers`, 'client-one');
  assert.equal(duplicate.status, 409);
  session = await (await handleInterview(post({ answerId: first.id }), client, `interviews/${id}/challenges`, 'client-one')).json();
  const challenge = session.answers[0].challenges[0];
  assert.match(challenge.question, /concrete example/);
  session = await (await handleInterview(post({ challengeId: challenge.id, reply: 'Separate reply' }), client, `interviews/${id}/replies`, 'client-one')).json();
  assert.equal(session.answers[0].original, 'Original 0\nLine 2');
  assert.equal(session.answers[0].challenges[0].reply, 'Separate reply');
  session = await (await handleInterview(post({ correctedSummary: 'Corrected by participant' }), client, `interviews/${id}/submit`, 'client-one')).json();
  assert.equal(session.status, 'submitted');
  assert.equal(session.draft.approvalStatus, 'Draft');
  assert.equal(session.draft.summary.text, 'Corrected by participant');
  assert.equal(session.draft.evidenceRequests.length, 3);
  assert.equal((await handleInterview(post({ answerId: first.id }), client, `interviews/${id}/challenges`, 'client-one')).status, 403);
  const get = new Request('https://example.test/api/indago/interviews');
  assert.equal((await handleInterview(get, client, `interviews/${id}/export`, 'client-one')).status, 403);
  const facilitatorView = await (await handleInterview(get, client, `interviews/${id}`, 'facilitator', true)).json();
  assert.equal(facilitatorView.canWrite, false);
  const exported = await handleInterview(get, client, `interviews/${id}/export`, 'facilitator', true);
  assert.equal(exported.status, 200);
  assert.match(await exported.text(), /Corrected by participant/);
});

test('next AI question uses answer context, and a failed call keeps the guided path', async () => {
  const client = memoryClient();
  let session = await (await handleInterview(post({ consent: true, ai: true }), client, 'interviews', 'client-one', false, false, undefined, true)).json();
  const seen = [];
  const ask = async request => { seen.push(request); return JSON.stringify({ move: 'value', question: 'Which client decision would change first?', covered: ['ambition'], complete: false }); };
  session = await (await handleInterview(post({ move: 'ambition', original: 'Client decisions improve' }), client,
    `interviews/${session.id}/answers`, 'client-one', false, false, ask)).json();
  assert.equal(session.next_question, 'Which client decision would change first?');
  assert.match(seen[0].input, /Client decisions improve/);
  assert.match(seen[0].input, /participant_answer/);
  assert.match(seen[0].input, /Next move \(the portal asks the moves in order\): value/);
  session = await (await handleInterview(post({ move: 'value', original: 'Better decisions' }), client,
    `interviews/${session.id}/answers`, 'client-one', false, false, async () => { throw new Error('provider down'); })).json();
  assert.equal(session.next_question, null);
  assert.equal(session.answers.length, 2);
});

test('AI challenge keeps the original answer and stores the follow-up separately', async () => {
  const client = memoryClient();
  let session = await (await handleInterview(post({ consent: true, ai: true }), client, 'interviews', 'client-one', false, false, undefined, true)).json();
  session = await (await handleInterview(post({ move: 'ambition', original: 'Original view' }), client,
    `interviews/${session.id}/answers`, 'client-one')).json();
  const answerId = session.answers[0].id;
  session = await (await handleInterview(post({ answerId }), client, `interviews/${session.id}/challenges`,
    'client-one', false, false, async () => JSON.stringify({ answerId, angle: 'counterexample', question: 'What would disprove that view?' }))).json();
  assert.equal(session.answers[0].original, 'Original view');
  assert.equal(session.answers[0].challenges[0].question, 'What would disprove that view?');
});

async function submittedAiSession(client) {
  let session = await (await handleInterview(post({ consent: true, ai: true }), client, 'interviews', 'client-one', false, false, undefined, true)).json();
  for (const move of MOVES) {
    const original = move.id === 'convergence' ? 'Direction\nOutcome one\nOutcome two\nOutcome three' : `${move.id} response`;
    session = await (await handleInterview(post({ move: move.id, original }), client,
      `interviews/${session.id}/answers`, 'client-one')).json();
  }
  const ask = async () => { throw new Error('submit must not call the AI draft'); };
  return (await handleInterview(post({ correctedSummary: 'My corrected summary' }), client,
    `interviews/${session.id}/submit`, 'client-one', false, false, ask)).json();
}
const inTransaction = client => async work => work(client);

test('submit saves the guided draft at once and leaves the AI draft pending', async () => {
  const session = await submittedAiSession(memoryClient());
  assert.equal(session.status, 'submitted');
  assert.equal(session.ai_draft, 'pending');
  assert.equal(session.draft.processing, 'guided, no AI');
  assert.equal(session.draft.approvalStatus, 'Draft');
});

test('background AI draft replaces the guided draft as a sourced proposal even when model claims approval', async () => {
  const client = memoryClient();
  const session = await submittedAiSession(client);
  const item = (text, sources) => ({ text, sources });
  let draftRequest;
  const modelOutput = JSON.stringify({ approvalStatus: 'Approved',
    candidates: [item('Candidate one', [session.answers[0].id]), item('Candidate two', [session.answers[1].id])],
    outcomes: [item('Outcome one', [session.answers[5].id]), item('Outcome two', [session.answers[5].id]), item('Outcome three', [session.answers[5].id])],
    boundaries: [item('Experts decide', [session.answers[4].id])], hypotheses: [{ question: 'Test demand', sources: [session.answers[3].id] }],
  });
  assert.equal(await writeAiDraft(session.id, 'client-two', inTransaction(client), async () => modelOutput), 'skipped');
  assert.equal(await writeAiDraft(session.id, 'client-one', inTransaction(client), async request => { draftRequest = request; return modelOutput; }), 'done');
  assert.equal(draftRequest.timeoutMs, 120000);
  assert.equal(draftRequest.maxTokens, 4500);
  assert.match(draftRequest.input, /<corrected_summary>My corrected summary<\/corrected_summary>/);
  const stored = client.sessions.get(session.id);
  assert.equal(stored.ai_draft, 'done');
  assert.equal(stored.draft.processing, 'AI-assisted draft, human review required');
  assert.equal(stored.draft.approvalStatus, 'Draft');
  assert.equal(stored.draft.candidates[0].sources[0].answerId, session.answers[0].id);
  assert.equal(stored.status, 'submitted');
  // A second start (another tab, a reload) does not call the AI again.
  assert.equal(await writeAiDraft(session.id, 'client-one', inTransaction(client), async () => { throw new Error('called twice'); }), 'skipped');
});

test('a failed AI draft keeps the guided draft and records only a fixed reason', async () => {
  const client = memoryClient();
  const session = await submittedAiSession(client);
  assert.equal(await writeAiDraft(session.id, 'client-one', inTransaction(client),
    async () => JSON.stringify({ candidates: [{ text: 'Participant secret is final', sources: [] }] })), 'failed');
  const stored = client.sessions.get(session.id);
  assert.equal(stored.ai_draft, 'failed');
  assert.equal(stored.draft.processing, 'guided, no AI');
  assert.equal(stored.draft.approvalStatus, 'Draft');
  assert.equal(stored.draft.aiFallbackReason, 'AI draft incomplete.');
  assert.doesNotMatch(JSON.stringify(stored.draft), /Participant secret/);
});

test('Continue without AI makes no AI call, and AI cannot be chosen while it is off', async () => {
  const client = memoryClient();
  const ask = async () => { throw new Error('AI must not be called'); };
  const listed = await (await handleInterview(new Request('https://example.test/api/indago/interviews'), client, 'interviews', 'client-one', false, false, ask, false)).json();
  assert.equal(listed.aiAvailable, false);
  let session = await (await handleInterview(post({ consent: true, ai: true }), client, 'interviews', 'client-one', false, false, ask, false)).json();
  assert.equal(session.ai_assisted, false);
  session = await (await handleInterview(post({ consent: true, ai: false }), client, 'interviews', 'client-one', false, false, ask, true)).json();
  assert.equal(session.ai_assisted, false);
  for (const move of MOVES) {
    const original = move.id === 'convergence' ? 'Direction\nOutcome one\nOutcome two\nOutcome three' : `${move.id} response`;
    session = await (await handleInterview(post({ move: move.id, original }), client, `interviews/${session.id}/answers`, 'client-one', false, false, ask)).json();
  }
  assert.equal(session.next_question, undefined);
  session = await (await handleInterview(post({ answerId: session.answers[0].id }), client, `interviews/${session.id}/challenges`, 'client-one', false, false, ask)).json();
  assert.ok(session.answers[0].challenges[0].question);
  session = await (await handleInterview(post({ correctedSummary: 'Summary' }), client, `interviews/${session.id}/submit`, 'client-one', false, false, ask)).json();
  assert.equal(session.draft.processing, 'guided, no AI');
  assert.equal(session.draft.aiFallbackReason, undefined);
  assert.equal(session.ai_draft, null);
  assert.equal(await writeAiDraft(session.id, 'client-one', inTransaction(client), ask), 'skipped');
});
