import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, acceptAiTurn, answersFor, challengeFor, guidedTurn, makeAiDraft, makeDraft, pendingSkips, proposedOutcomes, reopenTurn } from './interview.mjs';

const answers = MOVES.map((move, index) => ({ id: `answer-${index}`, move: move.id,
  original: [
    'Help clients decide with confidence.',
    'A client should spot demand earlier.',
    'A continuing intelligence partnership sounds useful if clients value it.',
    'We need evidence of repeat demand and data rights.',
    'Experts make final research judgements. Do not reuse data without rights.',
    'Indago should improve decisions by 2031.\nThree clients report faster decisions.\nRenewal rate improves.\nQuality remains trusted.',
  ][index] }));

test('AI draft retains sources, labels hypotheses, and cannot approve a North Star', () => {
  const item = (text, sources) => ({ text, sources });
  const raw = JSON.stringify({
    approvalStatus: 'Approved',
    candidates: [item('A first direction', ['answer-0', 'answer-1']), item('A second direction', ['answer-2'])],
    outcomes: [item('Outcome 1', ['answer-1']), item('Outcome 2', ['answer-3']), item('Outcome 3', ['answer-5'])],
    boundaries: [item('Human judgement remains', ['answer-4'])],
    hypotheses: [{ question: 'Test repeat demand', sources: ['answer-3'] }],
  });
  const draft = makeAiDraft(raw, answers, 'Participant corrected summary');
  assert.equal(draft.approvalStatus, 'Draft');
  assert.equal(draft.candidates[0].status, 'Draft: pending Gordon’s confirmation');
  assert.equal(draft.outcomes[0].status, 'Greatstone hypothesis');
  assert.deepEqual(draft.boundaries[0].sources, [{ move: 'boundaries', answerId: 'answer-4', label: 'client statement' }]);
  assert.equal(draft.summary.status, 'client statement');
  assert.throws(() => makeAiDraft(raw.replace('"answer-3"', '"invented"'), answers, 'Summary'));
  // Items other than candidates may quote the participant's own words.
  const quoting = JSON.parse(raw);
  quoting.boundaries[0].text = 'Experts have the final say; confirm the first source statement';
  assert.equal(makeAiDraft(JSON.stringify(quoting), answers, 'Summary').boundaries[0].text, 'Experts have the final say; confirm the first source statement');
  quoting.candidates[0].text = 'The approved North Star';
  assert.throws(() => makeAiDraft(JSON.stringify(quoting), answers, 'Summary'), /claims approval/);
});

const sourceCheck = { id: 'answer-s', move: 'ambition', original: 'Confirm the first two', source_check: true };

test('the opening is unprompted, the source check follows the ambition, and answered moves are skipped', () => {
  assert.equal(guidedTurn([]).move, 'ambition');
  assert.equal(guidedTurn([]).sourceCheck, undefined);
  assert.equal(guidedTurn(answers.slice(0, 1)).sourceCheck, true);
  assert.equal(guidedTurn([answers[0], sourceCheck, answers[1]]).move, 'futures');
  assert.equal(guidedTurn([answers[0], sourceCheck, answers[1]], ['futures']).move, 'economics');
  assert.equal(guidedTurn([...answers, sourceCheck]), null);
  assert.doesNotMatch(MOVES[0].question, /portal|\bAI\b|platform/i);
});

test('the AI may follow up in the current move up to 3 questions, or choose a move not yet done', () => {
  const two = [answers[0], sourceCheck, answers[1]];
  const turn = (move, covered = [], complete = false) => ({ move, question: 'Q?', covered, complete });
  assert.equal(acceptAiTurn(turn('value'), two, 'value').move, 'value');
  assert.equal(acceptAiTurn(turn('boundaries'), two, 'value').move, 'boundaries');
  assert.throws(() => acceptAiTurn(turn('ambition'), two, 'value'), /move invalid/);
  assert.throws(() => acceptAiTurn(turn('economics', ['economics']), two, 'value'), /move invalid/);
  assert.throws(() => acceptAiTurn(turn('value'), [...two, { ...answers[1], id: 'v2' }, { ...answers[1], id: 'v3' }], 'value'), /move invalid/);
  assert.throws(() => acceptAiTurn(turn('nowhere'), two, 'value'), /move invalid/);
  assert.throws(() => acceptAiTurn({ move: 'value', covered: 'all', complete: false }, two, 'value'), /move invalid/);
  assert.throws(() => acceptAiTurn(turn(undefined, MOVES.map(m => m.id), true), two, 'value'), /move invalid/);
  assert.equal(acceptAiTurn(turn(undefined, [], true), [...answers, sourceCheck], 'convergence').complete, true);
});

test('a move the AI saw as covered cites the answer it had just read', () => {
  const later = { id: 'answer-f', move: 'futures', original: 'Partner', ai_covered: ['economics'] };
  assert.deepEqual(answersFor([answers[0], answers[1], later], 'economics').map(a => a.id), ['answer-1']);
  assert.deepEqual(answersFor([answers[0], answers[1]], 'economics', ['economics']).map(a => a.id), ['answer-1']);
  assert.deepEqual(answersFor([answers[0], answers[1]], 'convergence', ['convergence']), []);
});

test('a covered move stays pending until an answer was saved to a turn that showed it (Touchstone S3)', () => {
  const two = [answers[0], sourceCheck, answers[1]];
  assert.deepEqual(pendingSkips(two, ['ambition', 'value', 'economics', 'boundaries', 'convergence', 'nowhere']), ['economics', 'boundaries']);
  // Once the participant answered a turn that showed economics, it is no longer pending.
  assert.deepEqual(pendingSkips([...two, { ...answers[2], ai_covered: ['economics'] }], ['economics', 'boundaries']), ['boundaries']);
  assert.deepEqual(reopenTurn(two, ['value', 'economics', 'boundaries'], 'economics'),
    { move: 'economics', question: MOVES[3].question, askedBy: 'guided', covered: ['value', 'boundaries'] });
  assert.equal(reopenTurn(two, ['economics'], 'futures'), null, 'only a pending skip can be reopened');
  assert.equal(reopenTurn(two, ['convergence'], 'convergence'), null);
  assert.equal(reopenTurn([answers[0]], ['economics'], 'economics'), null, 'the source check still comes first');
});

test('challenge depends on the answer and prior context', () => {
  assert.match(challengeFor('ambition', 'Clients make better decisions'), /specific client decision/);
  assert.match(challengeFor('economics', 'We need repeat revenue'), /evidence.*pay/);
  assert.match(challengeFor('ambition', 'We can improve our work', answers.slice(0, 2)), /client outcome.*earlier/);
  assert.notEqual(challengeFor('ambition', 'Clients make better decisions'), challengeFor('ambition', 'Clients make better decisions', [], 1));
});

test('draft links each proposal to source answers and cannot approve itself', () => {
  const original = answers[0].original;
  const draft = makeDraft(answers, 'Corrected by participant.');
  assert.equal(answers[0].original, original);
  assert.equal(draft.summary.text, 'Corrected by participant.');
  assert.equal(draft.recordId, 'IND-NS-001');
  assert.equal(draft.gate, 'G2');
  assert.equal(draft.approvalStatus, 'Draft');
  assert.equal(draft.candidates.length, 3);
  assert.ok(draft.candidates.every(c => c.status.includes('pending Gordon') && c.sources.every(s => s.answerId)));
  assert.ok(draft.outcomes.length >= 3 && draft.outcomes.length <= 5);
  assert.ok(draft.evidenceRequests.every(r => r.status === 'Greatstone hypothesis' && r.sources.length));
  // IND-NS-001 already holds NS-H-01 to 06; a draft must not reuse those numbers.
  assert.deepEqual(draft.evidenceRequests.map(r => r.id), ['DH-01', 'DH-02', 'DH-03']);
  assert.match(draft.hypothesisNote, /NS-H-07 onward/);
  assert.ok(!JSON.stringify(draft).includes('independently verified fact'));
  assert.ok(draft.outcomes.every(outcome => outcome.status === 'client statement'));
});

test('outcomes must be 3 to 5 participant statements', () => {
  assert.throws(() => proposedOutcomes('Direction\nOne\nTwo'), /3 to 5/);
  assert.throws(() => proposedOutcomes('Direction\nOne\nTwo\nThree\nFour\nFive\nSix'), /3 to 5/);
  assert.throws(() => makeDraft(answers.map(a => a.move === 'convergence' ? { ...a, original: 'Direction\nOne' } : a)), /3 to 5/);
});
