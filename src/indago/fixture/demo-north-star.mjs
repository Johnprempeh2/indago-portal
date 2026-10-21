// Entirely invented NS-01 preview content. It has no connection to the private source.
export const demoNorthStar = {
  id: 'DEMO-NS-001', edition: 'Demo facilitator edition · invented content',
  purpose: 'Use this sample session to test the layout and editing controls.',
  guardrails: ['Record what the participant says first.', 'Label hypotheses clearly.', 'Keep decisions and open questions separate.', 'Test ideas against evidence.', 'Confirm the final wording.'],
  baselineNote: 'These are invented prompts for a layout preview, not client evidence.',
  baseline: Array.from({ length: 7 }, (_, i) => ({ id: `DEMO-EV-${i + 1}`, proposition: `DEMO-EV-${i + 1}: invented proposition ${i + 1}`, treatment: 'Ask for a concrete example and record the answer.' })),
  runOfShow: ['0–10', '10–25', '25–40', '40–55', '55–70', '70–82', '82–90'].map(time => ({ time, move: 'Explore an invented prompt', outcome: 'A clear demo note' })),
  questions: 'ABCDEF'.split('').map(letter => ({ heading: `${letter}. Demo discussion`, items: Array.from({ length: letter === 'B' || letter === 'C' ? 5 : 4 }, (_, i) => `Invented question ${letter}${i + 1}: what would a useful outcome look like?`) })),
  futures: 'ABC'.split('').map(letter => ({ name: `${letter} — Demo future`, provocation: 'A fictional organisation explores a possible future.', evidence: 'Invented evidence request.' })),
  futuresAsk: 'Explore each future. These are invented examples.',
  sentenceAid: 'By [horizon], the fictional organisation will [outcome].',
  dimensions: Array.from({ length: 8 }, (_, i) => `Demo outcome dimension ${i + 1}`),
  boundary: Array.from({ length: 7 }, (_, i) => `What boundary applies to invented scenario ${i + 1}?`),
  convergence: Array.from({ length: 6 }, (_, i) => `Has demo check ${i + 1} been answered?`).concat('Has the fictional participant accepted the wording?'),
  hypotheses: Array.from({ length: 6 }, (_, i) => `NS-H-0${i + 1}`),
  recommendedRequests: Array.from({ length: 8 }, (_, i) => `invented evidence request ${i + 1}`),
  important: 'This is a demo. No decision or approval is recorded for a real project.',
};
