import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { northStarSections, northStarProgress, startPosition, firstOpen, approvalBlocked, MAX_INPUTS } from './north-star-steps.mjs';
import { demoNorthStar } from '../fixture/demo-north-star.mjs';

const seed = JSON.parse(readFileSync(new URL('../north-star-seed.json', import.meta.url)));
const questionCount = seed.questions.reduce((sum, group) => sum + group.items.length, 0);

test('no guided step shows more than five inputs', () => {
  for (const template of [seed, demoNorthStar]) {
    for (const section of northStarSections(template, {})) {
      for (const step of section.steps) assert.ok(step.fields.length <= MAX_INPUTS, `${step.id} has ${step.fields.length} inputs`);
    }
  }
});

test('the guided path covers every NS-01 field the full record edits', () => {
  const keys = new Set(northStarSections(seed, {}).flatMap(section => section.steps.flatMap(step => step.fields.map(field => field.key))));
  const expected = [
    ...seed.baseline.flatMap((_, i) => [`baseline.${i}.status`, `baseline.${i}.outcome`]),
    ...seed.runOfShow.map((_, i) => `show.${i}.notes`),
    ...Array.from({ length: questionCount }, (_, n) => ['asked', 'followup', 'verbatim', 'interpretation'].map(k => `question.${n}.${k}`)).flat(),
    ...seed.futures.flatMap((_, i) => ['excites', 'value', 'plausible', 'combination'].map(k => `future.${i}.${k}`)),
    ...['horizon', 'identity', 'market', 'outcome', 'advantage', 'measures', 'principles', 'verbatim', 'challenge', 'agreed'].map(k => `draft.${k}`),
    ...seed.dimensions.flatMap((_, i) => ['baseline', 'verified', 'target', 'evidence'].map(k => `dimension.${i}.${k}`)),
    ...seed.boundary.flatMap((_, i) => [`boundary.${i}.decision`, `boundary.${i}.note`]),
    ...seed.convergence.flatMap((_, i) => [`convergence.${i}.answer`, `convergence.${i}.note`]),
    ...seed.hypotheses.flatMap(id => ['fact', 'evidence', 'owner', 'due', 'link'].map(k => `hypothesis.${id}.${k}`)),
    ...['status', 'version', 'date', 'confirmationName', 'confirmationDate', 'confirmationText', 'otherDecisionMaker', 'facilitator', 'reviewer', 'questions', 'exceptions'].map(k => `approval.${k}`),
  ];
  for (const key of expected) assert.ok(keys.has(key), `${key} is missing from the guided path`);
  assert.equal(keys.size, expected.length);
});

test('progress counts recorded steps and ticks off a finished section', () => {
  const fields = Object.fromEntries(seed.baseline.map((_, i) => [`baseline.${i}.status`, 'Confirmed']));
  fields['question.0.asked'] = 'Yes';
  const sections = northStarSections(seed, fields);
  assert.equal(sections[0].complete, true);
  assert.equal(sections[0].done, seed.baseline.length);
  const progress = northStarProgress(sections);
  assert.equal(progress.done, seed.baseline.length + 1);
  assert.equal(progress.total, sections.reduce((sum, s) => sum + s.total, 0));
});

test('resume returns to the saved step, or to the first open step', () => {
  const fields = Object.fromEntries(seed.baseline.map((_, i) => [`baseline.${i}.status`, 'Confirmed']));
  const sections = northStarSections(seed, fields);
  assert.deepEqual(startPosition(sections, 'questions:3'), { section: 2, step: 3 });
  assert.deepEqual(startPosition(sections, 'questions:999'), { section: 1, step: 0 });
  assert.deepEqual(startPosition(sections, ''), { section: 1, step: 0 });
  assert.deepEqual(firstOpen(sections, { section: 2, step: 0 }), { section: 2, step: 1 });
});

test('IND-NS-001: approval stays blocked until acceptance is Yes', () => {
  assert.equal(approvalBlocked({}), true);
  assert.equal(approvalBlocked({ 'convergence.6.answer': 'Partly' }), true);
  assert.equal(approvalBlocked({ 'convergence.6.answer': 'Yes' }), false);
});

test('added hypothesis rows appear as extra steps', () => {
  const handoff = northStarSections(seed, { 'hypothesis.NS-H-07.created': '' }).find(s => s.id === 'handoff');
  assert.equal(handoff.total, seed.hypotheses.length + 1);
  assert.equal(handoff.steps.at(-1).title, 'NS-H-07');
});
