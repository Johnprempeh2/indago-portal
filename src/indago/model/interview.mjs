// The guided route remains available when server-side AI is disabled or unavailable.
export const MOVES = [
  { id: 'ambition', title: 'Your starting point', question: 'In your own words, what should Indago become, and what would its clients gain?' },
  { id: 'value', title: 'Client value', question: 'If Indago stopped running surveys tomorrow, what valuable outcome would clients still pay it to deliver?' },
  { id: 'futures', title: 'Possible futures', question: 'Consider premium research excellence, a continuous intelligence partnership, and a scalable intelligence product and service. Which future is most valuable, which is credible, and could a combination be better?' },
  { id: 'economics', title: 'Economics and difference', question: 'What would clients pay for repeatedly, and what could Indago uniquely own or build to make that valuable?' },
  { id: 'boundaries', title: 'People and boundaries', question: 'Which decisions need expert judgement, what must not be automated, and what legal or ethical limits would shape the ambition?' },
  { id: 'convergence', title: 'Bring it together', question: 'What strategic identity, customers, outcome, advantage, horizon and principles should the draft reflect? On separate lines after that direction, give 3 to 5 measurable outcomes with target, date and owner where known.' },
];

export function nextMove(answers) {
  return MOVES.find(move => !answers.some(answer => answer.move === move.id && answer.original.trim())) || null;
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
export function makeDraft(answers, correctedSummary) {
  const by = Object.fromEntries(answers.map(answer => [answer.move, answer]));
  if (MOVES.some(move => !by[move.id]?.original?.trim())) throw new Error('Complete each conversation move before drafting.');
  const summary = correctedSummary?.trim() || MOVES.map(move => `${move.title}: ${by[move.id].original}`).join('\n');
  const outcomes = proposedOutcomes(by.convergence.original).map(text => ({ text, status: 'client statement', sources: [source(by.convergence)] }));
  const candidates = [
    { framing: 'Client outcome', text: `By the horizon described in the conversation, Indago could focus on ${by.value.original.trim()}`, sources: [source(by.value), source(by.convergence)] },
    { framing: 'Strategic identity', text: `Indago could become ${by.ambition.original.trim()}, shaped by ${by.boundaries.original.trim()}`, sources: [source(by.ambition), source(by.boundaries)] },
    { framing: 'Future and advantage', text: `Indago could pursue ${by.futures.original.trim()} through ${by.economics.original.trim()}`, sources: [source(by.futures), source(by.economics)] },
  ].map(item => ({ ...item, status: 'Draft: pending Gordon’s confirmation', provenance: 'Greatstone hypothesis' }));
  return {
    recordId: 'IND-NS-001', gate: 'G2', approvalStatus: 'Draft', processing: 'guided, no AI',
    summary: { text: summary, status: 'client statement', sources: answers.map(source) },
    candidates, outcomes,
    boundaries: [{ text: by.boundaries.original, status: 'client statement', sources: [source(by.boundaries)] }],
    evidenceRequests: [
      { id: 'NS-H-01', question: 'Which client decisions and outcomes can be independently evidenced?', status: 'Greatstone hypothesis', sources: [source(by.value)] },
      { id: 'NS-H-02', question: 'What repeat demand, economics and rights support the preferred future?', status: 'Greatstone hypothesis', sources: [source(by.economics), source(by.futures)] },
      { id: 'NS-H-03', question: 'Which operating and ethical limits are confirmed by policy or contract?', status: 'Greatstone hypothesis', sources: [source(by.boundaries)] },
    ],
  };
}

export function makeAiDraft(raw, answers, correctedSummary) {
  const item = JSON.parse(raw);
  const byMove = new Map(answers.map(answer => [answer.move, answer]));
  const sourceMoves = moves => {
    if (!Array.isArray(moves) || !moves.length || moves.some(move => !byMove.has(move))) throw new Error('AI sources invalid.');
    return [...new Set(moves)].map(move => source(byMove.get(move)));
  };
  const entries = (items, min, max) => {
    if (!Array.isArray(items) || items.length < min || items.length > max) throw new Error('AI draft incomplete.');
    return items.map(value => {
      if (typeof value?.text !== 'string' || !value.text.trim() || value.text.length > 1000) throw new Error('AI draft invalid.');
      return { text: value.text.trim(), sources: sourceMoves(value.sourceMoves) };
    });
  };
  const candidates = entries(item.candidates, 2, 3).map((value, i) => ({
    ...value, framing: `Candidate ${i + 1}`, status: 'Draft: pending Gordon’s confirmation', provenance: 'Greatstone hypothesis',
  }));
  const outcomes = entries(item.outcomes, 3, 5).map(value => ({ ...value, status: 'Greatstone hypothesis' }));
  const boundaries = entries(item.boundaries, 1, 8).map(value => ({ ...value, status: 'Greatstone hypothesis' }));
  const evidenceRequests = entries(item.evidenceRequests, 1, 10).map((value, i) => ({
    id: `NS-H-${String(i + 1).padStart(2, '0')}`, question: value.text, status: 'Greatstone hypothesis', sources: value.sources,
  }));
  return {
    recordId: 'IND-NS-001', gate: 'G2', approvalStatus: 'Draft', processing: 'AI-assisted draft',
    summary: { text: correctedSummary.trim(), status: 'client statement', sources: answers.map(source) },
    candidates, outcomes, boundaries, evidenceRequests,
  };
}
