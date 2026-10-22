import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSteps, northStarStatus, MAX_NEXT } from './next-steps.mjs';
import { demoState } from '../fixture/demo-state.mjs';
import { demoNorthStar } from '../fixture/demo-north-star.mjs';

const northStar = (fields = {}) => ({ template: demoNorthStar, fields });

test('with no baseline, setting the W1 date comes first, then the North Star', () => {
  const steps = nextSteps(demoState(), { northStar: northStar() });
  assert.deepEqual(steps.map(s => s.id), ['baseline', 'north-star', 'blocked']);
  assert.equal(steps[1].go, 'Start North Star');
  assert.ok(steps.length <= MAX_NEXT);
});

test('a started North Star resumes at the saved part', () => {
  const ns = northStar({ 'baseline.0.status': 'Confirmed' });
  const status = northStarStatus(ns, 'futures:0');
  assert.equal(status.done, 1);
  const step = nextSteps({ ...demoState(), kickoff: '2026-10-26' }, { northStar: ns, savedPlace: 'futures:0' })[0];
  assert.equal(step.id, 'north-star');
  assert.equal(step.go, 'Continue North Star');
  assert.match(step.title, new RegExp(`^Part ${status.part} of 10: `));
  assert.match(step.detail, /^1 of \d+ steps recorded/);
});

test('no North Star step when it is hidden, missing or approved', () => {
  const state = { ...demoState(), kickoff: '2026-10-26' };
  for (const options of [{ northStar: northStar(), hideNorthStar: true }, {}, { northStar: northStar({ 'approval.status': 'Approved' }) }]) {
    assert.ok(!nextSteps(state, options).some(s => s.id === 'north-star'));
  }
});

test('the next gate and ready work fill in once the baseline and blockers are clear', () => {
  const state = demoState();
  state.kickoff = '2026-10-26';
  state.wbs = state.wbs.map(w => (w.status === 'Blocked' ? { ...w, status: 'In progress', blocker: '' } : w));
  const steps = nextSteps(state, {});
  assert.deepEqual(steps.map(s => s.id), ['gate', 'ready']);
  assert.match(steps[0].title, /^Get G2 North Star ready for review/);
  assert.equal(steps[0].tab, 'gates');
});

test('nothing is next when every gate is approved and nothing is ready or blocked', () => {
  const state = demoState();
  state.kickoff = '2026-10-26';
  state.wbs = state.wbs.map(w => ({ ...w, status: 'Complete', blocker: '' }));
  state.gates = state.gates.map(g => ({ ...g, status: 'Approved' }));
  assert.deepEqual(nextSteps(state, {}), []);
});
