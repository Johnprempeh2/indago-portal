// The guided route remains available when server-side AI is disabled or unavailable.
export const MOVES = [
  { id: 'ambition', title: 'Your starting point', question: 'In your own words, what should Indago become, and what would its clients gain?' },
  { id: 'value', title: 'Client value', question: 'If Indago stopped running surveys tomorrow, what valuable outcome would clients still pay it to deliver?' },
  { id: 'futures', title: 'Possible futures', question: 'Consider premium research excellence, a continuous intelligence partnership, and a scalable intelligence product and service. Which future is most valuable, which is credible, and could a combination be better?' },
  { id: 'economics', title: 'Economics and difference', question: 'What would clients pay for repeatedly, and what could Indago uniquely own or build to make that valuable?' },
  { id: 'boundaries', title: 'People and boundaries', question: 'Which decisions need expert judgement, what must not be automated, and what legal or ethical limits would shape the ambition?' },
  { id: 'convergence', title: 'Bring it together', question: 'What strategic identity, customers, outcome, advantage, horizon and principles should the draft reflect? On separate lines after that direction, give 3 to 5 measurable outcomes with target, date and owner where known.' },
];

// NS-01 move 1: shown only after the participant's own ambition, as items to confirm or correct, not as facts.
export const SOURCE_STATEMENTS = [
  'Delivery that adds value and saves effort',
  'An African market intelligence ambition',
  'A client digital front door',
  'The published vision of value-adding consumer insights in Africa',
];
const SOURCE_CHECK = {
  guided: 'Which parts of your ambition are non-negotiable, and which of these earlier statements would you confirm, correct or drop?',
  // In the AI path the interviewer has already asked about non-negotiables.
  AI: 'Which of these earlier statements would you confirm, correct or drop?',
};
// NS-01: at most 3 questions on one move. The source statement check does not count.
export const MAX_QUESTIONS_PER_MOVE = 3;

const isMove = id => MOVES.some(move => move.id === id);
export const moveAnswers = (answers, id) => answers.filter(answer => answer.move === id && !answer.source_check);

// A move is done when it has an answer, or when the AI marked it covered by another answer. Convergence is the
// participant's own synthesis, so only an answer to it counts.
export function doneMoves(answers, pendingCovered = []) {
  const done = new Set(answers.map(answer => answer.move));
  for (const id of [...answers.flatMap(answer => answer.ai_covered || []), ...pendingCovered]) if (isMove(id) && id !== 'convergence') done.add(id);
  return done;
}

// Moves the AI marked covered that no saved answer has yet passed. NS-01 (Touchstone S3): the participant sees
// these before they are skipped and can choose to answer one. A move counts as covered only once the participant
// has saved an answer to a turn that showed it, which stores it in that answer's `ai_covered`.
export const pendingSkips = (answers, covered = []) => {
  const done = doneMoves(answers);
  return [...new Set(covered)].filter(id => isMove(id) && id !== 'convergence' && !done.has(id));
};

// The participant chose to answer a move the AI wanted to skip: its guided question, with the other skips kept.
export function reopenTurn(answers, covered, id) {
  if (needsSourceCheck(answers) || !pendingSkips(answers, covered).includes(id)) return null;
  return { move: id, question: MOVES.find(move => move.id === id).question, askedBy: 'guided', covered: covered.filter(item => item !== id) };
}

export const needsSourceCheck = answers => moveAnswers(answers, 'ambition').length > 0 && !answers.some(answer => answer.source_check);
export const sourceCheckTurn = (askedBy = 'guided') => ({ move: 'ambition', question: SOURCE_CHECK[askedBy], askedBy: 'guided', sourceCheck: true });

// The guided path: one fixed question per move in order, skipping moves already done, plus the move 1 source check.
export function guidedTurn(answers, pendingCovered = []) {
  if (!moveAnswers(answers, 'ambition').length) return { move: 'ambition', question: MOVES[0].question, askedBy: 'guided' };
  if (needsSourceCheck(answers)) return sourceCheckTurn('guided');
  const done = doneMoves(answers, pendingCovered);
  const move = MOVES.find(item => !done.has(item.id));
  return move ? { move: move.id, question: move.question, askedBy: 'guided' } : null;
}

// Checks the move the AI chose against NS-01: a follow-up in the move just answered (up to the cap), or a move
// not yet done. `complete` is accepted only when every move is done.
export function acceptAiTurn(result, answers, currentMove) {
  if (!result || !Array.isArray(result.covered) || result.covered.some(id => !isMove(id)) || typeof result.complete !== 'boolean') throw new Error('AI move invalid.');
  const covered = [...new Set(result.covered)];
  const reason = typeof result.reason === 'string' ? result.reason.trim().slice(0, 200) : '';
  const done = doneMoves(answers, covered);
  if (result.complete) {
    if (MOVES.some(move => !done.has(move.id))) throw new Error('AI move invalid.');
    return { complete: true, covered, reason };
  }
  const followUp = result.move === currentMove && moveAnswers(answers, currentMove).length < MAX_QUESTIONS_PER_MOVE;
  if (!isMove(result.move) || (!followUp && done.has(result.move))) throw new Error('AI move invalid.');
  return { move: result.move, covered, reason };
}

// The answers that stand for a move in the draft: its own answers or, for a move the AI marked covered, the answer
// it had just read when it first did so.
export function answersFor(answers, id, pendingCovered = []) {
  const own = moveAnswers(answers, id);
  if (own.length || id === 'convergence') return own;
  const main = answers.filter(answer => !answer.source_check);
  const at = answers.findIndex(answer => (answer.ai_covered || []).includes(id));
  if (at > 0) return [answers.slice(0, at).filter(answer => !answer.source_check).at(-1)].filter(Boolean);
  return pendingCovered.includes(id) && main.length ? [main.at(-1)] : [];
}

export function challengeFor(move, answer, preceding = [], attempt = 0) {
  if (attempt > 0) return [
    'What counterexample would make you change this view?',
    'Which assumption would you test first, and what result would change your mind?',
    'What trade-off would you accept to make this possible?',
  ][(attempt - 1) % 3];
  const text = answer.toLowerCase();
  const prior = preceding.map(a => a.original).join(' ').toLowerCase();
  if (/client|customer|decision/.test(text) && move !== 'value') return 'Which specific client decision would change, and how would you tell?';
  if (/revenue|subscription|fee|pay|grow/.test(text)) return 'What evidence would show that clients would pay for this repeatedly?';
  if (/ai|automat|technolog|portal|platform/.test(text)) return 'If that technology were unavailable, which outcome would still matter?';
  if (move === 'futures') return 'What would you stop doing to make room for that future?';
  if (move === 'boundaries') return 'Where would you draw the line even if automation saved time?';
  if (move === 'convergence') return 'Which assumption could most seriously weaken this draft, and what evidence would test it?';
  if (prior.includes('client') || prior.includes('customer')) return 'How would the client outcome you described earlier change in this case?';
  return 'What concrete example would let someone else test this claim?';
}

const source = answer => ({ move: answer.move, answerId: answer.id, label: 'client statement' });
export function proposedOutcomes(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 4 || lines.length > 6) throw new Error('Give 3 to 5 proposed outcomes on separate lines after your direction.');
  return lines.slice(1);
}
// IND-NS-001 already holds NS-H-01 to NS-H-06, and the record's allocator issues NS-H-07 onward. A draft cannot
// reserve those numbers, so its requests carry draft numbers until a facilitator adds them to the record.
const draftHypothesisId = index => `DH-${String(index + 1).padStart(2, '0')}`;
export const HYPOTHESIS_NOTE = 'Draft numbers: each request gets the next free NS-H number (NS-H-07 onward) when a facilitator adds it to IND-NS-001.';

function sourceStatementCheck(answers) {
  const answer = answers.find(item => item.source_check);
  return answer ? { statements: SOURCE_STATEMENTS, statementStatus: 'Greatstone hypothesis', response: answer.original,
    status: 'client statement', sources: [source(answer)] } : null;
}

export function makeDraft(answers, correctedSummary, pendingCovered = []) {
  const by = Object.fromEntries(MOVES.map(move => [move.id, answersFor(answers, move.id, pendingCovered)]));
  if (MOVES.some(move => !by[move.id].length)) throw new Error('Complete each conversation move before drafting.');
  const words = id => by[id].map(answer => answer.original.trim()).join(' ');
  const from = (...ids) => [...new Map(ids.flatMap(id => by[id]).map(answer => [answer.id, source(answer)])).values()];
  const summary = correctedSummary?.trim() || MOVES.map(move => `${move.title}: ${words(move.id)}`).join('\n');
  // A guided convergence answer is checked for 3 to 5 outcome lines when saved. An AI follow-up answer may not
  // use that format; then the facilitator draws the outcomes out.
  const formatted = by.convergence.find(answer => answer.asked_by !== 'AI') || by.convergence.find(answer => { try { proposedOutcomes(answer.original); return true; } catch { return false; } });
  const outcomes = formatted ? proposedOutcomes(formatted.original).map(text => ({ text, status: 'client statement', sources: [source(formatted)] })) : [];
  const candidates = [
    { framing: 'Client outcome', text: `By the horizon described in the conversation, Indago could focus on ${words('value')}`, sources: from('value', 'convergence') },
    { framing: 'Strategic identity', text: `Indago could become ${words('ambition')}, shaped by ${words('boundaries')}`, sources: from('ambition', 'boundaries') },
    { framing: 'Future and advantage', text: `Indago could pursue ${words('futures')} through ${words('economics')}`, sources: from('futures', 'economics') },
  ].map(item => ({ ...item, status: 'Draft: pending Gordon’s confirmation', provenance: 'Greatstone hypothesis' }));
  return {
    recordId: 'IND-NS-001', gate: 'G2', approvalStatus: 'Draft', processing: 'guided, no AI',
    summary: { text: summary, status: 'client statement', sources: answers.map(source) },
    sourceStatements: sourceStatementCheck(answers),
    candidates, outcomes,
    boundaries: [{ text: words('boundaries'), status: 'client statement', sources: from('boundaries') }],
    evidenceRequests: [
      { question: 'Which client decisions and outcomes can be independently evidenced?', sources: from('value') },
      { question: 'What repeat demand, economics and rights support the preferred future?', sources: from('economics', 'futures') },
      { question: 'Which operating and ethical limits are confirmed by policy or contract?', sources: from('boundaries') },
    ].map((item, i) => ({ id: draftHypothesisId(i), ...item, status: 'Greatstone hypothesis' })),
    hypothesisNote: HYPOTHESIS_NOTE,
    unresolved: outcomes.length ? [] : [{ text: 'Measurable outcomes are still to be drawn out with the facilitator.', status: 'Greatstone hypothesis', sources: from('convergence') }],
  };
}

export function makeAiDraft(raw, answers, correctedSummary) {
  const item = JSON.parse(raw);
  const byId = new Map(answers.map(answer => [answer.id, answer]));
  const sourcesFor = ids => {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !byId.has(id))) throw new Error('AI sources invalid.');
    return [...new Set(ids)].map(id => source(byId.get(id)));
  };
  const entries = (items, min, max, field = 'text') => {
    if (!Array.isArray(items) || items.length < min || items.length > max) throw new Error('AI draft incomplete.');
    return items.map(value => {
      const text = value?.[field];
      if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('AI draft invalid.');
      return { text: text.trim(), sources: sourcesFor(value.sources) };
    });
  };
  // A candidate North Star must not claim approval. Other items may quote the participant ("confirm the first
  // statement", "the final say"), and the server sets every status field itself.
  const approvalClaim = /\b(?:approved|confirmed|final)\b/i;
  const candidates = entries(item.candidates, 2, 3).map((value, i) => ({
    ...value, framing: String(item.candidates[i].framing || `Candidate ${i + 1}`).slice(0, 80),
    rationale: String(item.candidates[i].rationale || '').slice(0, 300),
    status: 'Draft: pending Gordon’s confirmation', provenance: 'Greatstone hypothesis',
  }));
  if (item.candidates.some(value => approvalClaim.test(`${value.text} ${value.rationale || ''}`))) throw new Error('AI draft claims approval.');
  const outcomes = entries(item.outcomes, 3, 5).map((value, i) => ({ ...value,
    target: String(item.outcomes[i].target || 'not stated').slice(0, 200),
    horizon: String(item.outcomes[i].horizon || 'not stated').slice(0, 200),
    owner: String(item.outcomes[i].owner || 'not stated').slice(0, 200),
    status: item.outcomes[i].provenance === 'client statement' ? 'client statement' : 'Greatstone hypothesis' }));
  const boundaries = entries(item.boundaries, 0, 8).map((value, i) => ({ ...value,
    status: item.boundaries[i].provenance === 'client statement' ? 'client statement' : 'Greatstone hypothesis' }));
  const evidenceRequests = entries(item.hypotheses, 1, 10, 'question').map((value, i) => ({
    id: draftHypothesisId(i), question: value.text, status: 'Greatstone hypothesis', sources: value.sources,
  }));
  return {
    recordId: 'IND-NS-001', gate: 'G2', approvalStatus: 'Draft', processing: 'AI-assisted draft, human review required',
    summary: { text: correctedSummary.trim(), status: 'client statement', sources: answers.map(source) },
    sourceStatements: sourceStatementCheck(answers),
    candidates, outcomes, boundaries, evidenceRequests, hypothesisNote: HYPOTHESIS_NOTE,
    unresolved: entries(item.unresolved || [], 0, 10).map((value, i) => ({ ...value,
      status: item.unresolved[i].provenance === 'client statement' ? 'client statement' : 'Greatstone hypothesis' })),
  };
}
