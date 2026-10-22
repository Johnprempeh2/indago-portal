// "What is next" on the Control centre (GRE-1891): a short list of the next
// actions, each pointing at the screen where it is done. `jump` says where on
// that screen to land: a filter to apply, the element id to focus, and what
// to bring to the top of the screen (default: the focused element). Pure, so it is tested
// with node --test; the screen only renders it.

import { controlSummary } from './indago-model.mjs';
import { northStarSections, northStarProgress, startPosition } from './north-star-steps.mjs';

export const MAX_NEXT = 3;

// Where the North Star guide will reopen, and how far it has come.
export function northStarStatus(northStar, savedPlace = '') {
  if (!northStar?.template) return null;
  const sections = northStarSections(northStar.template, northStar.fields || {});
  const progress = northStarProgress(sections);
  const pos = startPosition(sections, savedPlace);
  const approved = String(northStar.fields?.['approval.status'] || '').startsWith('Approved');
  return { ...progress, approved, part: pos.section + 1, parts: sections.length, partTitle: sections[pos.section]?.title || '' };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Ordered: set the baseline, carry on with the North Star session, clear
// blockers, then the next gate and the work that can start now.
export function nextSteps(state, { northStar, savedPlace, hideNorthStar = false } = {}) {
  const s = controlSummary(state);
  const steps = [];
  if (!state.kickoff) {
    steps.push({ id: 'baseline', tab: 'plan', jump: { focus: 'kickoff' }, kicker: 'Set up', go: 'Open the Work plan',
      title: 'Set the agreed W1 start date', detail: 'W1–W4 are planning assumptions until the date is set after kick-off.' });
  }
  const ns = hideNorthStar ? null : northStarStatus(northStar, savedPlace);
  if (ns && !ns.approved) {
    steps.push(ns.done === 0
      ? { id: 'north-star', tab: 'north-star', kicker: 'North Star', go: 'Start North Star', title: 'Start the North Star session', detail: `${ns.parts} short parts, one step at a time.` }
      : { id: 'north-star', tab: 'north-star', kicker: 'North Star', go: 'Continue North Star', title: `Part ${ns.part} of ${ns.parts}: ${ns.partTitle}`, detail: `${ns.done} of ${ns.total} steps recorded.` });
  }
  if (s.blocked) {
    const first = state.wbs.find((w) => w.status === 'Blocked');
    steps.push({ id: 'blocked', tab: 'plan', jump: { filter: { status: 'Blocked' }, focus: `wbs-${first.id}`, show: 'wbs-toolbar' }, kicker: 'Unblock', go: 'See blocked work',
      title: `Clear ${plural(s.blocked, 'blocked work package')}`, detail: `${first.id} ${first.task}${first.blocker ? ` — ${first.blocker}` : ''}` });
  }
  if (s.nextGate) {
    const g = s.gates.find((x) => x.id === s.nextGate.id);
    const left = g.workPackages.filter((w) => w.status !== 'Complete').length;
    steps.push({ id: 'gate', tab: 'gates', jump: { focus: `gate-card-${g.id}` }, kicker: `Gate ${g.id}`, go: 'Open Gates',
      title: left ? `Get ${g.id} ${g.stage} ready for review` : `Review and approve ${g.id} ${g.stage}`,
      detail: left ? `${plural(left, 'work package')} still open · ${g.percent}% complete.` : 'Every work package for this gate is complete.' });
  }
  if (s.ready.length) {
    const w = s.ready[0];
    steps.push({ id: 'ready', tab: 'plan', jump: { focus: `wbs-${w.id}` }, kicker: 'Ready to start', go: 'Open the Work plan',
      title: `${w.id} ${w.task}`, detail: s.ready.length > 1 ? `And ${plural(s.ready.length - 1, 'more work package')} ready now.` : 'Every dependency is complete.' });
  }
  return steps.slice(0, MAX_NEXT);
}
