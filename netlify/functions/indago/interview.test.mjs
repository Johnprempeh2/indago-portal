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
      if (sql.startsWith('INSERT INTO indago.client_interview_answers')) {
        const [id, session_id, move, original, question, asked_by, ai_reason, ai_covered, source_check] = args;
        if (source_check && answers.some(a => a.session_id === session_id && a.source_check)) throw new Error('one source check per session');
        answers.push({ id, session_id, move, original, question, asked_by, ai_reason, ai_covered, source_check }); return { rows: [] };
      }
      if (sql.startsWith('UPDATE indago.client_interviews SET next_turn')) { sessions.get(args[1]).next_turn = JSON.parse(args[0]); return { rows: [] }; }
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
const answer = async (client, session, original, ask) => (await handleInterview(post({ move: session.turn.move, original }), client,
  `interviews/${session.id}/answers`, 'client-one', false, false, ask)).json();
// Answers whatever the interviewer asks until the summary review; convergence gets the 3-outcome format.
async function answerAll(client, session, ask, text = move => `${move} response`) {
  while (session.turn) session = await answer(client, session, session.turn.move === 'convergence' ? 'Direction\nOutcome one\nOutcome two\nOutcome three' : text(session.turn.move), ask);
  return session;
}
const byMove = (session, move) => session.answers.find(a => a.move === move && !a.source_check);

test('API keeps first words, stores challenges separately, and submits only a draft', async () => {
  const client = memoryClient();
  assert.equal((await handleInterview(post({ consent: true }), client, 'interviews', 'open-access', false, true)).status, 403);
  assert.equal((await handleInterview(post({}), client, 'interviews', 'client-one')).status, 400);
  const created = await handleInterview(post({ consent: true }), client, 'interviews', 'client-one');
  assert.equal(created.status, 201);
  let session = await created.json();
  const id = session.id;
  assert.equal(session.turn.move, 'ambition');
  session = await answer(client, session, 'Original 0\nLine 2');
  session = await answerAll(client, session);
  assert.deepEqual(session.answers.map(a => a.move), ['ambition', 'ambition', 'value', 'futures', 'economics', 'boundaries', 'convergence']);
  assert.ok(session.answers.every(a => a.asked_by === 'guided' && a.question));
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
  const text = await exported.text();
  assert.match(text, /Corrected by participant/);
  assert.match(text, /Question \(guided\): In your own words/);
  assert.match(text, /Question \(guided, earlier source statements to confirm or correct\)/);
});

test('guided path shows the earlier source statements only after the ambition answer', async () => {
  const client = memoryClient();
  let session = await (await handleInterview(post({ consent: true }), client, 'interviews', 'client-one')).json();
  assert.equal(session.turn.sourceCheck, undefined);
  assert.equal(session.turn.question, MOVES[0].question);
  session = await answer(client, session, 'My own ambition');
  assert.equal(session.turn.sourceCheck, true);
  assert.match(session.turn.question, /non-negotiable.*earlier statements/);
  session = await answer(client, session, 'Confirm the first, drop the third');
  assert.equal(session.answers[1].source_check, true);
  assert.equal(session.turn.move, 'value');
  session = await answerAll(client, session);
  session = await (await handleInterview(post({ correctedSummary: 'Summary' }), client, `interviews/${session.id}/submit`, 'client-one')).json();
  assert.equal(session.draft.sourceStatements.response, 'Confirm the first, drop the third');
  assert.equal(session.draft.sourceStatements.statementStatus, 'Greatstone hypothesis');
});

test('an answer to a question that is no longer current is refused', async () => {
  const client = memoryClient();
  let session = await (await handleInterview(post({ consent: true }), client, 'interviews', 'client-one')).json();
  const stale = await handleInterview(post({ move: 'value', original: 'Out of turn' }), client, `interviews/${session.id}/answers`, 'client-one');
  assert.equal(stale.status, 409);
  assert.equal(client.answers.length, 0);
});

const aiSession = async client => (await handleInterview(post({ consent: true, ai: true }), client, 'interviews', 'client-one', false, false, undefined, true)).json();
const reply = value => async () => JSON.stringify(value);

test('next AI question uses answer context, and a failed call keeps the guided path', async () => {
  const client = memoryClient();
  let session = await aiSession(client);
  const seen = [];
  const ask = async request => { seen.push(request); return JSON.stringify({ move: 'ambition', question: 'Which parts of that are non-negotiable?', reason: 'Move 1 asks for non-negotiables.', covered: [], complete: false }); };
  session = await answer(client, session, 'Client decisions improve', ask);
  assert.equal(session.turn.question, 'Which parts of that are non-negotiable?');
  assert.equal(session.turn.askedBy, 'AI');
  assert.match(seen[0].input, /Client decisions improve/);
  assert.match(seen[0].input, /participant_answer/);
  assert.match(seen[0].input, /Current move: ambition \(1 of at most 3 questions asked\)/);
  session = await answer(client, session, 'Independence', async () => { throw new Error('provider down'); });
  assert.equal(session.next_turn, null);
  assert.equal(session.turn.askedBy, 'guided');
  assert.equal(session.turn.sourceCheck, true);
  assert.equal(session.answers.length, 2);
  assert.equal(session.answers[1].asked_by, 'AI');
  assert.equal(session.answers[1].ai_reason, 'Move 1 asks for non-negotiables.');
});

async function atValue(client) {
  let session = await aiSession(client);
  session = await answer(client, session, 'Our ambition', reply({ move: 'value', question: 'What would clients pay for?', covered: ['ambition'], complete: false }));
  assert.equal(session.turn.sourceCheck, true, 'the source check comes before the AI leaves the ambition move');
  assert.equal(session.turn.question, 'Which of these earlier statements would you confirm, correct or drop?');
  return answer(client, session, 'Confirm all four', reply({ move: 'value', question: 'If Indago stopped running surveys, what would clients still pay for?', reason: 'Start client value.', covered: ['ambition'], complete: false }));
}

test('a broad answer gets a concrete-example follow-up in the same move', async () => {
  const client = memoryClient();
  let session = await atValue(client);
  assert.equal(session.turn.move, 'value');
  session = await answer(client, session, 'Clients would value better decisions.', reply({ move: 'value', question: 'Which client decision, for example, would change first?', reason: 'Answer was broad; ask for an example.', covered: ['ambition'], complete: false }));
  assert.equal(session.turn.move, 'value');
  assert.equal(session.turn.question, 'Which client decision, for example, would change first?');
  session = await answer(client, session, 'A bank deciding where to open branches.');
  assert.equal(session.answers.filter(a => a.move === 'value').length, 2);
});

test('an answer that covers value and economics skips economics', async () => {
  const client = memoryClient();
  let session = await atValue(client);
  session = await answer(client, session, 'Clients pay a yearly fee for continuous tracking of their markets.', reply({ move: 'futures', question: 'Which of three futures is most credible to you?', reason: 'Economics already covered.', covered: ['ambition', 'value', 'economics'], complete: false }));
  assert.equal(session.turn.move, 'futures');
  session = await answer(client, session, 'The continuous partner.', reply({ move: 'boundaries', question: 'Which decisions need expert judgement?', covered: ['ambition', 'value', 'futures', 'economics'], complete: false }));
  assert.equal(session.turn.move, 'boundaries');
  // If the AI fails now, the guided path also skips economics.
  session = await answer(client, session, 'Final research judgements.', async () => { throw new Error('down'); });
  assert.equal(session.turn.move, 'convergence');
  session = await answer(client, session, 'Direction\nOutcome one\nOutcome two\nOutcome three', reply({ complete: true, covered: ['ambition', 'value', 'futures', 'economics', 'boundaries'] }));
  assert.equal(session.turn, null);
  assert.ok(!session.answers.some(a => a.move === 'economics'));
  session = await (await handleInterview(post({ correctedSummary: 'Summary' }), client, `interviews/${session.id}/submit`, 'client-one', false, false)).json();
  assert.equal(session.status, 'submitted');
  const economicsSource = session.draft.candidates.find(c => c.framing === 'Future and advantage').sources.map(s => s.answerId);
  assert.ok(economicsSource.includes(byMove(session, 'value').id), 'the covered move cites the answer that covered it');
});

const reopen = async (client, session, move) => handleInterview(post({ move }), client, `interviews/${session.id}/reopen`, 'client-one', false, false);

test('the participant sees a part before the AI skips it and can choose to answer it (Touchstone S3)', async () => {
  const client = memoryClient();
  let session = await atValue(client);
  assert.deepEqual(session.skipped, []);
  // One broad answer: the AI says value, economics and boundaries are all covered.
  session = await answer(client, session, 'Clients pay a yearly fee for tracking, and experts sign off every finding.',
    reply({ move: 'futures', question: 'Which future is most credible?', covered: ['ambition', 'value', 'economics', 'boundaries'], complete: false }));
  assert.equal(session.turn.move, 'futures');
  assert.deepEqual(session.skipped, ['economics', 'boundaries'], 'the participant is told which parts would be skipped');
  assert.equal((await reopen(client, session, 'futures')).status, 409, 'only a pending skip can be reopened');
  session = await (await reopen(client, session, 'boundaries')).json();
  assert.equal(session.turn.move, 'boundaries');
  assert.equal(session.turn.askedBy, 'guided');
  assert.equal(session.turn.question, MOVES.find(m => m.id === 'boundaries').question);
  assert.deepEqual(session.skipped, ['economics']);
  session = await answer(client, session, 'Experts make the final call.',
    reply({ move: 'futures', question: 'Which future is most credible?', covered: ['ambition', 'value', 'economics', 'boundaries'], complete: false }));
  // Answering without reopening economics accepts the skip that was shown on that turn.
  assert.deepEqual(byMove(session, 'boundaries').ai_covered, ['ambition', 'value', 'economics'], 'the answer records the skips the participant saw');
  assert.deepEqual(session.skipped, []);
  assert.ok(!session.answers.some(a => a.move === 'economics'));
});

test('a skip offered at the end can still be answered, and the source check carries no skips', async () => {
  const client = memoryClient();
  let session = await aiSession(client);
  session = await answer(client, session, 'Everything at once', reply({ move: 'futures', question: 'Which future?', covered: ['ambition', 'value', 'economics'], complete: false }));
  assert.equal(session.turn.sourceCheck, true);
  assert.deepEqual(session.skipped, [], 'the AI is asked again after the source check');
  assert.deepEqual(session.next_turn.covered, undefined);
  assert.equal((await reopen(client, session, 'value')).status, 409);
  session = await answer(client, session, 'Confirm', reply({ move: 'futures', question: 'Which future?', covered: ['ambition'], complete: false }));
  session = await answer(client, session, 'Partner', reply({ move: 'economics', question: 'What repeats?', covered: ['ambition', 'value'], complete: false }));
  session = await answer(client, session, 'Fees', reply({ move: 'boundaries', question: 'Limits?', covered: ['ambition', 'value'], complete: false }));
  session = await answer(client, session, 'Limits', reply({ move: 'convergence', question: 'Together?', covered: ['ambition', 'value'], complete: false }));
  session = await answer(client, session, 'Direction\nOutcome one\nOutcome two\nOutcome three', reply({ complete: true, covered: ['ambition', 'value', 'boundaries'] }));
  assert.equal(session.turn, null, 'the summary review is next');
  assert.deepEqual(session.skipped, [], 'value was shown on every turn the participant answered');
  // A fresh session where the AI says complete with a part never shown: the participant sees it at the summary.
  const other = memoryClient();
  session = await atValue(other);
  session = await answer(other, session, 'Value', reply({ move: 'futures', question: 'Which future?', covered: ['ambition'], complete: false }));
  session = await answer(other, session, 'Partner', reply({ move: 'economics', question: 'What repeats?', covered: ['ambition'], complete: false }));
  session = await answer(other, session, 'Fees', reply({ move: 'convergence', question: 'Together?', covered: ['ambition'], complete: false }));
  session = await answer(other, session, 'Direction\nOutcome one\nOutcome two\nOutcome three', reply({ complete: true, covered: ['ambition', 'boundaries'] }));
  assert.equal(session.turn, null);
  assert.deepEqual(session.skipped, ['boundaries']);
  session = await (await reopen(other, session, 'boundaries')).json();
  assert.equal(session.turn.move, 'boundaries');
  session = await answer(other, session, 'Experts decide.', async () => null);
  assert.equal(session.turn, null);
  assert.deepEqual(session.skipped, []);
  assert.ok(byMove(session, 'boundaries'));
});

test('a fourth question in one move, a covered move or an early complete falls back to the guided path', async () => {
  const client = memoryClient();
  let session = await atValue(client);
  const again = reply({ move: 'value', question: 'And what else would clients pay for?', covered: ['ambition'], complete: false });
  session = await answer(client, session, 'One', again);
  session = await answer(client, session, 'Two', again);
  assert.equal(session.turn.askedBy, 'AI');
  session = await answer(client, session, 'Three', again);
  assert.equal(session.answers.filter(a => a.move === 'value').length, 3);
  assert.equal(session.turn.askedBy, 'guided');
  assert.equal(session.turn.move, 'futures');
  session = await answer(client, session, 'Futures', reply({ move: 'value', question: 'Back to value?', covered: ['ambition', 'value'], complete: false }));
  assert.equal(session.turn.askedBy, 'guided', 'a move already done is not reopened');
  assert.equal(session.turn.move, 'economics');
  session = await answer(client, session, 'Economics', reply({ complete: true, covered: ['ambition', 'value', 'futures', 'economics'] }));
  assert.equal(session.turn.move, 'boundaries', 'complete is refused while a move is not done');
  session = await answer(client, session, 'Boundaries', reply({ complete: true, covered: ['ambition', 'value', 'futures', 'economics', 'boundaries', 'convergence'] }));
  assert.equal(session.turn.move, 'convergence', 'convergence needs the participant\'s own answer');
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
  session = await answerAll(client, session);
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
    candidates: [item('Candidate one', [byMove(session, 'ambition').id]), item('Candidate two', [byMove(session, 'value').id])],
    outcomes: ['one', 'two', 'three'].map(n => item(`Outcome ${n}`, [byMove(session, 'convergence').id])),
    boundaries: [item('Experts decide', [byMove(session, 'boundaries').id])], hypotheses: [{ question: 'Test demand', sources: [byMove(session, 'economics').id] }],
  });
  assert.equal(await writeAiDraft(session.id, 'client-two', inTransaction(client), async () => modelOutput), 'skipped');
  assert.equal(await writeAiDraft(session.id, 'client-one', inTransaction(client), async request => { draftRequest = request; return '```json\n' + modelOutput + '\n```'; }), 'done');
  assert.equal(draftRequest.timeoutMs, 300000);
  assert.equal(draftRequest.maxTokens, 8000);
  assert.match(draftRequest.input, /<corrected_summary>My corrected summary<\/corrected_summary>/);
  const stored = client.sessions.get(session.id);
  assert.equal(stored.ai_draft, 'done');
  assert.equal(stored.draft.processing, 'AI-assisted draft, human review required');
  assert.equal(stored.draft.approvalStatus, 'Draft');
  assert.equal(stored.draft.candidates[0].sources[0].answerId, byMove(session, 'ambition').id);
  assert.equal(stored.draft.evidenceRequests[0].id, 'DH-01');
  assert.match(stored.draft.hypothesisNote, /NS-H-07 onward/);
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
  session = await answerAll(client, session, ask);
  assert.equal(session.next_turn, undefined);
  assert.ok(session.answers.every(a => a.asked_by === 'guided'));
  session = await (await handleInterview(post({ answerId: session.answers[0].id }), client, `interviews/${session.id}/challenges`, 'client-one', false, false, ask)).json();
  assert.ok(session.answers[0].challenges[0].question);
  session = await (await handleInterview(post({ correctedSummary: 'Summary' }), client, `interviews/${session.id}/submit`, 'client-one', false, false, ask)).json();
  assert.equal(session.draft.processing, 'guided, no AI');
  assert.equal(session.draft.aiFallbackReason, undefined);
  assert.equal(session.ai_draft, null);
  assert.equal(await writeAiDraft(session.id, 'client-one', inTransaction(client), ask), 'skipped');
});
