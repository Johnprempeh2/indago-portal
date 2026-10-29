import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, challengeFor, makeDraft, nextMove } from './interview.mjs';

const answers = MOVES.map((move, index) => ({ id: `answer-${index}`, move: move.id,
  original: [
    'Help clients decide with confidence.',
    'A client should spot demand earlier.',
    'A continuing intelligence partnership sounds useful if clients value it.',
    'We need evidence of repeat demand and data rights.',
    'Experts make final research judgements. Do not reuse data without rights.',
    'Indago should improve decisions by 2031.\nThree clients report faster decisions.\nRenewal rate improves.\nQuality remains trusted.',
  ][index] }));

test('the opening is unprompted and already answered moves are skipped', () => {
  assert.equal(nextMove([]).id, 'ambition');
  assert.equal(nextMove(answers.slice(0, 2)).id, 'futures');
  assert.equal(nextMove(answers), null);
  assert.doesNotMatch(MOVES[0].question, /portal|\bAI\b|platform/i);
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
  assert.ok(!JSON.stringify(draft).includes('independently verified fact'));
});
