// Mounts the real screens in a DOM (happy-dom), on the made-up demo data.
// Checks what the model tests cannot see: every screen renders, a Viewer gets
// no inputs, locked client columns have no inputs, edits save on blur, and the
// tabs work from the keyboard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

// The app shell imports a PNG and CSS, so the test mounts the screens and the TabList directly.
const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { demoState } from '${join(here, '../fixture/demo-state.mjs')}';
import { TabList } from '${join(here, 'ui.jsx')}';
import ControlCentre from '${join(here, 'ControlCentre.jsx')}';
import WorkPlan from '${join(here, 'WorkPlan.jsx')}';
import Gates from '${join(here, 'Gates.jsx')}';
import Risks from '${join(here, 'Risks.jsx')}';
import Investigation from '${join(here, 'Investigation.jsx')}';
import Evidence from '${join(here, 'Evidence.jsx')}';
import Traceability from '${join(here, 'Traceability.jsx')}';
import NorthStar from '${join(here, 'NorthStar.jsx')}';
import { demoNorthStar } from '${join(here, '../fixture/demo-north-star.mjs')}';
export { demoNorthStar };
export const SCREENS = { ControlCentre, WorkPlan, Gates, Risks, Investigation, Evidence, Traceability };
export { demoState };
export function mount(el, node) {
  const root = createRoot(el);
  flushSync(() => root.render(node));
  return root;
}
export function Tabs(props) {
  const [cur, setCur] = React.useState('a');
  return React.createElement(TabList, { ...props, current: cur, onSelect: setCur });
}
export { React, flushSync };
// North Star with an in-memory store that applies the IND-NS-001 approval rule like the server.
export function NorthStarHost({ canEdit = true, calls = [], initial = {} }) {
  const [fields, setFields] = React.useState(initial);
  const actions = {
    save: async (key, value) => {
      calls.push([key, value]);
      if (key === 'approval.status' && value.startsWith('Approved') && fields['convergence.6.answer'] !== 'Yes') throw new Error('Record participant acceptance as Yes before approval.');
      setFields(current => ({ ...current, [key]: value }));
    },
    addHypothesis: async () => ({ id: 'NS-H-07' }), sendHypothesis: async () => {}, history: async () => [],
  };
  return React.createElement(NorthStar, { state: demoState(), canEdit, northStar: { template: demoNorthStar, fields }, northStarActions: actions,
    onOpen: () => {}, onEvidence: () => {}, files: [] });
}
`;

let lib;
let win;
let dir;
const errors = [];
const realError = console.error;

before(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'FocusEvent', 'location', 'history', 'localStorage']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? win : win[k], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 240)); };
  dir = mkdtempSync(join(tmpdir(), 'indago-dom-'));
  const out = join(dir, 'bundle.mjs');
  await build({ stdin: { contents: ENTRY, resolveDir: here, loader: 'jsx' }, bundle: true, format: 'esm', platform: 'browser', outfile: out, jsx: 'automatic', loader: { '.jsx': 'jsx' }, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } });
  lib = await import(pathToFileURL(out).href);
});

after(() => {
  console.error = realError;
  rmSync(dir, { recursive: true, force: true });
  win.happyDOM.close();
});

function render(Screen, { canEdit = true, state = lib.demoState(), actions = {}, files = [], fileActions } = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const calls = [];
  const spy = new Proxy(actions, { get: (t, k) => t[k] || ((...a) => calls.push([k, ...a])) });
  const root = lib.mount(el, lib.React.createElement(Screen, { state, canEdit, actions: spy, files, fileActions, onOpen: () => {} }));
  return { el, calls, unmount: () => { root.unmount(); el.remove(); } };
}

test('every screen renders text for Editor and Viewer without React warnings', () => {
  for (const [name, Screen] of Object.entries(lib.SCREENS)) {
    for (const canEdit of [true, false]) {
      const before = errors.length;
      const { el, unmount } = render(Screen, { canEdit });
      assert.ok(el.textContent.length > 200, `${name} rendered ${el.textContent.length} characters`);
      assert.deepEqual(errors.slice(before), [], `${name} logged errors`);
      unmount();
    }
  }
});

test('work package shows file count, metadata and Viewer download without upload or remove', () => {
  const files = [{ id: 'demo-1', work_package_id: '1.01', file_name: 'Invented sample.csv',
    byte_size: 1200000, uploaded_by: 'Demo Person', uploaded_at: '2026-10-20T09:00:00Z' }];
  const fileActions = { download: async () => {}, upload: async () => {}, remove: async () => {} };
  const { el, unmount } = render(lib.SCREENS.WorkPlan, { canEdit: false, files, fileActions });
  const row = el.querySelector('tbody tr:not(.group)');
  assert.match(row.textContent, /1\.01\s*1/);
  const details = el.querySelector('.deliverables');
  assert.match(details.textContent, /Invented sample\.csv/);
  assert.match(details.textContent, /Demo Person/);
  assert.equal(details.querySelector('input[type=file]'), null);
  assert.equal([...details.querySelectorAll('button')].map(button => button.textContent).join(','), 'Download');
  unmount();
});

test('a Viewer gets no editable fields on any screen', () => {
  for (const [name, Screen] of Object.entries(lib.SCREENS)) {
    const { el, unmount } = render(Screen, { canEdit: false });
    // Search boxes and filter menus in the toolbars do not change data, so they stay.
    const editable = [...el.querySelectorAll('textarea, select, input:not([type=search]):not([type=checkbox])')].filter((x) => !x.closest('.toolbar'));
    const boxes = [...el.querySelectorAll('input[type=checkbox]')].filter((c) => !c.disabled);
    assert.equal(editable.length + boxes.length, 0, `${name} has ${editable.length + boxes.length} editable fields for a Viewer`);
    assert.equal(el.querySelector('button.btn'), null, `${name} shows an add button to a Viewer`);
    unmount();
  }
});

test('locked client columns render without inputs; open columns are editable', () => {
  const { el, unmount } = render(lib.SCREENS.Evidence);
  const first = el.querySelector('tbody tr');
  const cells = [...first.children];
  for (const ci of [0, 1, 2, 3, 4]) assert.equal(cells[ci].querySelector('input, select, textarea'), null, `column ${ci} is editable`);
  assert.ok(cells[5].querySelector('select'), 'client answer is a select');
  assert.ok(cells[6].querySelector('textarea'), 'client correction is editable');
  assert.equal(el.querySelector('button.btn'), null, 'client findings has no Add row');
  unmount();
});

test('editing a risk owner saves on blur with the risk ID', () => {
  const { el, calls, unmount } = render(lib.SCREENS.Risks);
  const input = el.querySelector('input[aria-label="Owner for R01"]');
  input.value = 'New owner';
  // React listens for focusout, which is what a real blur also fires.
  lib.flushSync(() => input.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true })));
  assert.deepEqual(calls.filter((c) => c[0] === 'updateRisk'), [['updateRisk', 'R01', 'owner', 'New owner']]);
  unmount();
});

test('arrow keys, Home and End move between tabs', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const tabs = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  const root = lib.mount(el, lib.React.createElement(lib.Tabs, { tabs, label: 'T', idPrefix: 't' }));
  const selected = () => el.querySelector('[aria-selected="true"]').dataset.tab;
  const key = (k) => lib.flushSync(() => el.querySelector('[aria-selected="true"]').dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true })));
  assert.equal(selected(), 'a');
  key('ArrowRight'); assert.equal(selected(), 'b');
  key('End'); assert.equal(selected(), 'c');
  key('ArrowRight'); assert.equal(selected(), 'a');
  key('ArrowLeft'); assert.equal(selected(), 'c');
  key('Home'); assert.equal(selected(), 'a');
  assert.equal([...el.querySelectorAll('[role=tab]')].filter((t) => t.tabIndex === 0).length, 1, 'one tab stop');
  root.unmount();
  el.remove();
});

function renderNorthStar(props = {}) {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const calls = [];
  const root = lib.mount(el, lib.React.createElement(lib.NorthStarHost, { calls, ...props }));
  const click = node => lib.flushSync(() => node.click());
  const button = text => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  // A choice group counts as one input, like a select.
  const inputs = () => el.querySelectorAll('.ns-card .ns-field, .ns-card .ns-add, .ns-card > .ns-chips > .ns-chip').length;
  return { el, calls, click, button, inputs, unmount: () => { root.unmount(); el.remove(); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('North Star opens as a guided path, one small step at a time', async () => {
  const before = errors.length;
  const ns = renderNorthStar();
  assert.equal(ns.el.querySelectorAll('.ns-card').length, 1, 'one step card');
  assert.match(ns.el.querySelector('.ns-progress-text').textContent, /^Step 1 of 7 · 0 recorded/);
  assert.equal(ns.el.querySelector('.ns-head .lead'), null, 'guided keeps the header to one line');
  assert.ok(ns.button('Print or save PDF') && ns.button('Change history'), 'print and history stay available under Tools');
  assert.equal(ns.el.querySelectorAll('.ns-rail li').length, 10, 'ten parts in the journey');
  // Walk every step: none shows more than five inputs.
  for (let guard = 0; guard < 120 && (ns.button('Next') || ns.button('Finish this part')); guard++) {
    assert.ok(ns.inputs() <= 5, `${ns.el.querySelector('.ns-card h4').textContent} shows ${ns.inputs()} inputs`);
    const next = ns.button('Next') || ns.button('Finish this part');
    ns.click(next);
    const onward = [...ns.el.querySelectorAll('.ns-finish button')].find(b => b.textContent.startsWith('Next: '));
    if (onward) ns.click(onward);
    else if (ns.el.querySelector('.ns-finish')) break;
  }
  assert.match(ns.el.querySelector('.ns-finish').textContent, /Read the full record/);
  assert.deepEqual(errors.slice(before), [], 'North Star logged errors');
  ns.unmount();
});

test('choosing a chip saves and ticks the step; finishing a part says so', async () => {
  const ns = renderNorthStar();
  for (let i = 0; i < 7; i++) {
    ns.click(ns.el.querySelector('.ns-card .ns-chip'));
    await settle();
    ns.click(ns.button(i < 6 ? 'Next' : 'Finish this part'));
  }
  assert.deepEqual(ns.calls.map(c => c[0]), Array.from({ length: 7 }, (_, i) => `baseline.${i}.status`));
  assert.ok(ns.calls.every(c => c[1] === 'Confirmed'));
  assert.match(ns.el.querySelector('.ns-finish').textContent, /done/);
  assert.ok(ns.el.querySelector('.ns-rail button.complete'), 'the part is ticked in the journey');
  assert.match(ns.el.querySelector('.ns-overall-text').textContent, /^7 of \d+ steps recorded/);
  assert.match(ns.el.querySelector('.ns-rail-count').textContent, /^7\/7/);
  ns.unmount();
});

test('IND-NS-001: Approved stays unavailable until acceptance is Yes', async () => {
  const approve = (props) => {
    const ns = renderNorthStar(props);
    ns.click([...ns.el.querySelectorAll('.ns-rail button')].at(-1));
    const chip = [...ns.el.querySelectorAll('.ns-card .ns-chip')].find(b => b.textContent === 'Approved');
    return { ns, chip };
  };
  let { ns, chip } = approve();
  assert.equal(chip.disabled, true);
  assert.match(ns.el.querySelector('.ns-card .note').textContent, /acceptance recorded as Yes/);
  ns.unmount();
  ({ ns, chip } = approve({ initial: { 'convergence.6.answer': 'Yes' } }));
  assert.equal(chip.disabled, false);
  ns.click(chip);
  await settle();
  assert.deepEqual(ns.calls, [['approval.status', 'Approved']]);
  ns.unmount();
});

test('North Star guided view gives a Viewer no inputs, and the full record still shows every section', () => {
  const ns = renderNorthStar({ canEdit: false });
  assert.equal(ns.el.querySelectorAll('.ns-guide textarea, .ns-guide select, .ns-guide input, .ns-card button.ns-chip, .ns-add').length, 0);
  ns.click(ns.button('Full record'));
  assert.equal(ns.el.querySelector('.ns-guide'), null);
  assert.equal(ns.el.querySelectorAll('.ns-section').length, 10);
  assert.ok(ns.el.querySelector('.ns-guardrails'));
  ns.unmount();
});

test('Control centre leads with what is next and keeps the full dashboard behind toggles', () => {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const opened = [];
  const northStar = { template: lib.demoNorthStar, fields: { 'baseline.0.status': 'Confirmed' } };
  const root = lib.mount(el, lib.React.createElement(lib.SCREENS.ControlCentre, { state: lib.demoState(), canEdit: false, northStar, onOpen: id => opened.push(id) }));
  const items = [...el.querySelectorAll('.cc-next li')];
  assert.equal(items.length, 3, 'three next steps');
  assert.match(items[0].textContent, /Set the agreed W1 start date/);
  assert.match(items[1].textContent, /1 of \d+ steps recorded/);
  lib.flushSync(() => items[1].querySelector('button').click());
  assert.deepEqual(opened, ['north-star']);
  assert.equal(el.querySelectorAll('.cc-journey .gate').length, 6, 'six gates in the journey');
  assert.equal(el.querySelectorAll('.cc-journey [aria-current="step"]').length, 1, 'one next gate');
  assert.equal(el.querySelectorAll(':scope > .kpis .kpi').length, 4, 'four headline measures');
  // Workstreams, ready work and milestones are still there, folded.
  for (const id of ['ctl-ws-h', 'ctl-ready-h', 'ctl-ms-h']) assert.ok(el.querySelector(`details:not([open]) #${id}`), `${id} is behind a toggle`);
  assert.equal(el.querySelectorAll('details .kpi').length, 9, 'all measures one click away');
  assert.equal(el.querySelectorAll('[aria-labelledby="ctl-attn-h"] > .list li').length, 3, 'three attention items on the main path');
  assert.match(el.querySelector('[aria-labelledby="ctl-attn-h"] summary').textContent, /^Show \d+ more$/);
  root.unmount();
  el.remove();
});

test('"See blocked work" lands on the Work plan filtered to blocked packages', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const state = lib.demoState();
  const opened = [];
  let root = lib.mount(el, lib.React.createElement(lib.SCREENS.ControlCentre, { state, canEdit: false, onOpen: (id, jump) => opened.push([id, jump]) }));
  const button = [...el.querySelectorAll('.cc-go')].find(b => b.textContent === 'See blocked work');
  lib.flushSync(() => button.click());
  const [[tab, jump]] = opened;
  assert.equal(tab, 'plan');
  root.unmount();
  root = lib.mount(el, lib.React.createElement(lib.SCREENS.WorkPlan, { state, canEdit: false, actions: {}, files: [], onOpen: () => {}, jump }));
  const blocked = state.wbs.filter(w => w.status === 'Blocked');
  const rows = [...el.querySelectorAll('tbody tr[id^="wbs-"]')];
  assert.ok(blocked.length > 0);
  assert.deepEqual(rows.map(r => r.id), blocked.map(w => `wbs-${w.id}`), 'only blocked packages are listed');
  assert.equal(el.querySelector('select[aria-label="Status"]').value, 'Blocked', 'the filter shows why');
  assert.ok(el.querySelector(`[id="${jump.focus}"]`), 'the focus target is on the screen');
  root.unmount();
  el.remove();
});
