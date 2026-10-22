// The guided North Star path (GRE-1891). Turns the NS-01 template and the saved
// fields into sections of small steps. Each step lists its inputs (at most five)
// and is "done" when its key answer is recorded. Field keys are the same as the
// full record, so nothing about storage, history, locks or approval changes.

export const MAX_INPUTS = 5;
// IND-NS-001: the record can be approved only after the participant accepts the wording.
export const ACCEPTANCE_KEY = 'convergence.6.answer';
export const APPROVAL_STATUSES = ['Draft', 'Confirmed in session', 'Approved', 'Approved with exceptions'];

const filled = value => String(value ?? '').trim() !== '';
const text = (key, label, hint = '') => ({ key, label, kind: 'text', hint });
const long = (key, label, hint = '') => ({ key, label, kind: 'long', hint });
const choice = (key, label, options) => ({ key, label, kind: 'choice', options });
const toggle = (key, label) => ({ key, label, kind: 'toggle' });
const date = (key, label) => ({ key, label, kind: 'date' });

export function hypothesisIdsOf(template, fields) {
  return [...new Set([...template.hypotheses, ...Object.keys(fields).map(key => key.match(/^hypothesis\.(NS-H-\d+)\./)?.[1]).filter(Boolean)])]
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
}

export function approvalBlocked(fields) {
  return fields[ACCEPTANCE_KEY] !== 'Yes';
}

export function sentencePreview(fields) {
  const agreed = ['horizon', 'identity', 'market', 'outcome', 'advantage', 'measures', 'principles'].map(key => fields[`draft.${key}`] || `[${key}]`);
  return `By ${agreed[0]}, Indago will be ${agreed[1]} for ${agreed[2]}, enabling ${agreed[3]} through ${agreed[4]}, while achieving ${agreed[5]}, without compromising ${agreed[6]}.`;
}

export function northStarSections(t, f) {
  const any = keys => keys.some(key => filled(f[key]));
  const step = (id, props) => ({ id, ...props, done: props.done(f) });
  let q = 0;
  const sections = [
    {
      id: 'baseline', number: 2, title: 'Check what we already know',
      purpose: 'Look at each earlier statement and say if it still holds.',
      guide: [t.baselineNote],
      steps: t.baseline.map((row, i) => step(`baseline-${i}`, {
        kicker: row.id, title: row.proposition.split(': ').slice(1).join(': ') || row.proposition, purpose: row.treatment,
        evidence: row.id.includes('/082') ? ['IND-EV-014', 'IND-EV-082'] : [row.id],
        fields: [choice(`baseline.${i}.status`, 'Status', ['Confirmed', 'Changed', 'Rejected', 'Still unverified']),
          long(`baseline.${i}.outcome`, 'Session outcome', 'What did the session conclude? One or two lines is enough.')],
        done: () => filled(f[`baseline.${i}.status`]),
      })),
    },
    {
      id: 'show', number: 3, title: 'Run the 90-minute session',
      purpose: 'Keep time and note what came out of each block.',
      steps: t.runOfShow.map((block, i) => step(`show-${i}`, {
        kicker: `Minutes ${block.time}`, title: block.move, purpose: `Aim: ${block.outcome}`,
        fields: [long(`show.${i}.notes`, 'Session notes', 'Short notes are fine, for example the three points people agreed on.')],
        done: () => filled(f[`show.${i}.notes`]), open: true,
      })),
    },
    {
      id: 'questions', number: 4, title: 'Ask the hard questions',
      purpose: 'One question at a time. Record Gordon’s words first, then your note.',
      guide: ['Record Gordon’s words before drafting a Greatstone interpretation. These are separate fields.'],
      steps: t.questions.flatMap(group => group.items.map(question => {
        const n = q++;
        return step(`question-${n}`, {
          kicker: group.heading, title: question,
          fields: [toggle(`question.${n}.asked`, 'Asked'), toggle(`question.${n}.followup`, 'Follow-up needed'),
            long(`question.${n}.verbatim`, 'Gordon’s words (verbatim)', 'Write what was said, in their words.'),
            long(`question.${n}.interpretation`, 'Greatstone note / interpretation', 'What does this tell us? Mark it as our view.')],
          done: () => f[`question.${n}.asked`] === 'Yes' || filled(f[`question.${n}.verbatim`]),
        });
      })),
    },
    {
      id: 'futures', number: 5, title: 'Picture three futures',
      purpose: 'React to each future. Do not choose a technology yet.',
      guide: [t.futuresAsk, 'Do not choose an implementation architecture in this session.'],
      steps: t.futures.map((future, i) => step(`future-${i}`, {
        kicker: 'Future', title: future.name, purpose: future.provocation, detail: `Evidence required: ${future.evidence}`,
        fields: [long(`future.${i}.excites`, 'What excites?', 'The part of this future people leaned into.'),
          long(`future.${i}.value`, 'Durable value', 'What would still be valuable in five years?'),
          long(`future.${i}.plausible`, 'What is plausible?', 'What could really happen, given today?'),
          long(`future.${i}.combination`, 'Combination note', 'Anything to borrow from the other futures?')],
        done: () => any(['excites', 'value', 'plausible', 'combination'].map(key => `future.${i}.${key}`)),
      })),
    },
    {
      id: 'draft', number: 6, title: 'Shape the North Star sentence',
      purpose: 'Fill in the blanks. The sentence builds itself as you go.',
      guide: [t.sentenceAid],
      steps: [
        step('draft-who', { title: 'Who and by when', preview: true,
          fields: [text('draft.horizon', 'Horizon', 'For example: 2031'), text('draft.identity', 'Strategic identity', 'What Indago will be'),
            text('draft.market', 'Customer / market', 'Who it is for')],
          done: () => ['horizon', 'identity', 'market'].every(key => filled(f[`draft.${key}`])) }),
        step('draft-value', { title: 'Value and advantage', preview: true,
          fields: [text('draft.outcome', 'Valuable customer outcome', 'What customers can now do'), text('draft.advantage', 'Distinctive advantage', 'Why Indago, not others')],
          done: () => ['outcome', 'advantage'].every(key => filled(f[`draft.${key}`])) }),
        step('draft-measures', { title: 'Measures and principles', preview: true,
          fields: [text('draft.measures', 'Measurable business outcomes', 'Two or three numbers'), text('draft.principles', 'Principles', 'What must not be compromised')],
          done: () => ['measures', 'principles'].every(key => filled(f[`draft.${key}`])) }),
        step('draft-words', { title: 'Agree the wording', purpose: 'Keep Gordon’s words, our challenge and the agreed text apart.', history: true,
          fields: [long('draft.verbatim', 'Gordon’s original words (verbatim)', 'Write the sentence as Gordon said it.'),
            long('draft.challenge', 'Greatstone challenge / alternative (hypothesis)', 'A sharper or bolder version to test.'),
            long('draft.agreed', 'Candidate North Star — agreed in session', 'The wording everyone in the room accepted.')],
          done: () => filled(f['draft.agreed']) }),
      ],
    },
    {
      id: 'dimensions', number: 6, title: 'Set the outcome measures',
      purpose: 'For each measure, note where we start and where we aim to be.',
      steps: t.dimensions.map((dimension, i) => step(`dimension-${i}`, {
        kicker: 'Outcome dimension', title: dimension,
        fields: [text(`dimension.${i}.baseline`, 'Baseline', 'Where it is today'), choice(`dimension.${i}.verified`, 'Baseline status', ['Verified', 'Unknown']),
          text(`dimension.${i}.target`, 'Target and horizon', 'For example: 40% by 2029'), text(`dimension.${i}.evidence`, 'Evidence / owner', 'Who will prove it')],
        done: () => filled(f[`dimension.${i}.target`]),
      })),
    },
    {
      id: 'boundary', number: 7, title: 'Draw the boundaries',
      purpose: 'Decide what is in, what is out, and what is still open.',
      steps: t.boundary.map((question, i) => step(`boundary-${i}`, {
        kicker: 'Boundary', title: question,
        fields: [choice(`boundary.${i}.decision`, 'Decision / unresolved', ['Decision', 'Unresolved']), long(`boundary.${i}.note`, 'Note', 'What was decided, or what is still open.')],
        done: () => filled(f[`boundary.${i}.decision`]),
      })),
    },
    {
      id: 'convergence', number: 8, title: 'Test the draft',
      purpose: 'Seven quick checks before the wording goes for approval.',
      steps: t.convergence.map((check, i) => step(`convergence-${i}`, {
        kicker: 'Check', title: check,
        fields: [choice(`convergence.${i}.answer`, 'Answer', ['Yes', 'No', 'Partly']), long(`convergence.${i}.note`, 'Note', 'Why, in a line.')],
        done: () => filled(f[`convergence.${i}.answer`]),
      })),
    },
    {
      id: 'handoff', number: 9, title: 'Hand off the evidence needs',
      purpose: 'List what must be checked, who checks it, and by when.',
      hypotheses: true,
      steps: hypothesisIdsOf(t, f).map(id => step(`hypothesis-${id}`, {
        kicker: 'Hypothesis', title: id, hypothesis: id,
        fields: [long(`hypothesis.${id}.fact`, 'Hypothesis / fact to verify', 'One claim we need to prove or disprove.'),
          long(`hypothesis.${id}.evidence`, 'Evidence required', 'The data or document that would settle it.'),
          text(`hypothesis.${id}.owner`, 'Owner'), date(`hypothesis.${id}.due`, 'Due'), text(`hypothesis.${id}.link`, 'GDXP linkage')],
        done: () => filled(f[`hypothesis.${id}.fact`]),
      })),
    },
    {
      id: 'approval', number: 10, title: 'Confirm and approve',
      purpose: 'Record who agreed to what, and when.',
      guide: [t.important],
      steps: [
        step('approval-status', { title: 'Record status', approval: true,
          fields: [choice('approval.status', 'Record status', APPROVAL_STATUSES), text('approval.version', 'Version', 'For example: v1.0'), date('approval.date', 'Version date')],
          done: () => filled(f['approval.status']) }),
        step('approval-confirmation', { title: 'Gordon’s confirmation',
          fields: [text('approval.confirmationName', 'Gordon confirmation name'), date('approval.confirmationDate', 'Gordon confirmation date'),
            long('approval.confirmationText', 'Exact approved text', 'Paste the exact wording Gordon approved.')],
          done: () => filled(f['approval.confirmationName']) && filled(f['approval.confirmationText']) }),
        step('approval-people', { title: 'Who signed off',
          fields: [text('approval.otherDecisionMaker', 'Other decision-maker (if required)'), text('approval.facilitator', 'Greatstone facilitator'), text('approval.reviewer', 'Greatstone reviewer')],
          done: () => filled(f['approval.facilitator']) && filled(f['approval.reviewer']) }),
        step('approval-open', { title: 'Open points', purpose: 'Leave these empty if there are none.',
          fields: [long('approval.questions', 'Open strategic questions', 'Questions still to answer after approval.'), long('approval.exceptions', 'Exceptions', 'Any part approved with conditions.')],
          done: () => any(['approval.questions', 'approval.exceptions']) || ['Approved', 'Approved with exceptions'].includes(f['approval.status']) }),
      ],
    },
  ];
  return sections.map((section, index) => {
    const done = section.steps.filter(item => item.done).length;
    return { ...section, index, done, total: section.steps.length, complete: section.steps.length > 0 && done === section.steps.length };
  });
}

export function northStarProgress(sections) {
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  const done = sections.reduce((sum, section) => sum + section.done, 0);
  return { done, total, percent: total ? Math.round(done / total * 100) : 0 };
}

// Where to land: the saved place if it still exists, otherwise the first open step.
export function startPosition(sections, saved) {
  const [sectionId, stepIndex] = String(saved || '').split(':');
  const section = sections.find(item => item.id === sectionId);
  if (section && Number(stepIndex) >= 0 && Number(stepIndex) < section.total) return { section: section.index, step: Number(stepIndex) };
  return firstOpen(sections) || { section: 0, step: 0 };
}

export function firstOpen(sections, from = { section: 0, step: -1 }) {
  for (const section of sections.slice(from.section)) {
    const start = section.index === from.section ? from.step + 1 : 0;
    const step = section.steps.findIndex((item, index) => index >= start && !item.done);
    if (step >= 0) return { section: section.index, step };
  }
  return null;
}
