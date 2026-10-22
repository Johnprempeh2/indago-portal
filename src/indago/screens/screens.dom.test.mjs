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
export function NorthStarHost({ canEdit = true, facilitator = false, calls = [], initial = {}, history = [] }) {
  const [fields, setFields] = React.useState(initial);
  const actions = {
    save: async (key, value) => {
      calls.push([key, value]);
      if (key === 'approval.status' && value.startsWith('Approved') && fields['convergence.6.answer'] !== 'Yes') throw new Error('Record participant acceptance as Yes before approval.');
      setFields(current => ({ ...current, [key]: value }));
    },
    addHypothesis: async () => ({ id: 'NS-H-07' }), sendHypothesis: async () => {}, history: async () => history,
  };
  return React.createElement(NorthStar, { state: demoState(), canEdit, facilitator, northStar: { template: demoNorthStar, fields }, northStarActions: actions,
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

function render(Screen, { canEdit = true, facilitator = false, state = lib.demoState(), actions = {}, files = [], fileActions } = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const calls = [];
  const spy = new Proxy(actions, { get: (t, k) => t[k] || ((...a) => calls.push([k, ...a])) });
  const root = lib.mount(el, lib.React.createElement(Screen, { state, canEdit, facilitator, actions: spy, files, fileActions, onOpen: () => {} }));
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
  const row = el.querySelector('#wbs-1\\.01');
  assert.equal(row.querySelector('.file-count').textContent, '1');
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
  const card = el.querySelector('li.ev');
  assert.equal(card.id, 'evidence-DEMO-EV-001');
  assert.equal(card.querySelector('.ev-title').querySelector('input, select, textarea'), null, 'the original statement is not editable');
  assert.equal(card.querySelector('.ev-meta').querySelector('input, select, textarea'), null, 'area, classification and source are not editable');
  assert.match(card.querySelector('.ev-title').textContent, /Demo statement 1/);
  assert.ok(card.querySelector('select[aria-label="Client answer for DEMO-EV-001"]'), 'client answer is a select');
  assert.ok(card.querySelector('textarea[aria-label="Client correction / comment for DEMO-EV-001"]'), 'client correction is editable');
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
  const ns = renderNorthStar({ canEdit: false, facilitator: true });
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
  const rows = [...el.querySelectorAll('li[id^="wbs-"]')];
  assert.ok(blocked.length > 0);
  assert.deepEqual(rows.map(r => r.id), blocked.map(w => `wbs-${w.id}`), 'only blocked packages are listed');
  assert.equal(el.querySelector('select[aria-label="Status"]').value, 'Blocked', 'the filter shows why');
  assert.ok(el.querySelector(`[id="${jump.focus}"]`), 'the focus target is on the screen');
  root.unmount();
  el.remove();
});

// Inputs a person sees without opening any "more" toggle.
const onMainPath = (root) => [...root.querySelectorAll('input:not([type=search]), select, textarea')]
  .filter((x) => !x.closest('details:not([open])') && !x.closest('.toolbar'));

test('Work plan shows one workstream at a time with status first and the rest behind Details', () => {
  const state = lib.demoState();
  const { el, calls, unmount } = render(lib.SCREENS.WorkPlan, { state });
  assert.equal(el.querySelectorAll('.ws-steps .gt-step').length, 7, 'six workstreams and All');
  assert.equal(el.querySelectorAll('.wp-group').length, 1, 'one workstream shown');
  assert.equal(el.querySelector('.wp-group').getAttribute('aria-label'), 'Evidence confirmation', 'opens on the first open workstream');
  assert.match(el.querySelector('.wp-group-head').textContent, /2 of 3 complete/);
  const cards = [...el.querySelectorAll('li.wp')];
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.deepEqual(onMainPath(card).map((x) => x.getAttribute('aria-label')), [`Status for ${card.id.slice(4)}`], `${card.id} shows only its status`);
    assert.ok(card.querySelector('details:not([open]) [aria-label^="Named owner"]'), `${card.id} keeps the owner field behind Details`);
  }
  assert.match(el.querySelector('#wbs-1\\.01 .wp-meta').textContent, /^Owner: Demo Person/, 'a named owner is labelled as the owner');
  assert.match(el.querySelector('#wbs-1\\.02 .wp-meta').textContent, /^Role: Evidence controller · no named owner/, 'a role is not passed off as an owner');
  assert.equal(el.querySelectorAll('li.wp.done .wp-tick').length, 2, 'complete work is ticked');
  const select = el.querySelector('select[aria-label="Status for 1.03"]');
  select.value = 'Complete';
  lib.flushSync(() => select.dispatchEvent(new win.Event('change', { bubbles: true })));
  assert.deepEqual(calls.filter((c) => c[0] === 'updateWbs'), [['updateWbs', '1.03', 'status', 'Complete']]);

  lib.flushSync(() => el.querySelector('.ws-nav .cc-go.primary').click());
  assert.equal(el.querySelector('.wp-group').getAttribute('aria-label'), 'North Star', 'Next goes to the next workstream');
  const blocker = el.querySelector('li.wp.blocked .wp-blocker');
  assert.match(blocker.textContent, /Blocker: Waiting for a demo decision/, 'the blocker shows without opening Details');

  lib.flushSync(() => el.querySelector('.ws-all').click());
  assert.equal(el.querySelectorAll('.wp-group').length, 6, 'All lists every workstream');
  assert.equal(el.querySelectorAll('li.wp').length, 18);
  assert.equal(el.querySelector('.ws-nav'), null, 'no Back or Next in the All view');

  lib.flushSync(() => [...el.querySelectorAll('.ws-steps .gt-step')][3].click());
  assert.equal(el.querySelector('.wp-group').getAttribute('aria-label'), 'Commercial economics');
  const status = el.querySelector('select[aria-label="Status"]');
  status.value = 'Blocked';
  lib.flushSync(() => status.dispatchEvent(new win.Event('change', { bubbles: true })));
  assert.ok(el.querySelector('.ws-all[aria-pressed="true"]'), 'a filter looks across every workstream');
  assert.deepEqual([...el.querySelectorAll('li.wp')].map((li) => li.id), ['wbs-2.02', 'wbs-4.03']);
  unmount();
});

test('Gates shows one gate at a time, opens on the next gate, and steps between gates', () => {
  const { el, unmount } = render(lib.SCREENS.Gates);
  assert.equal(el.querySelectorAll('.gate-card').length, 1, 'one gate card');
  assert.ok(el.querySelector('#gate-card-G2'), 'opens on the next gate to approve');
  assert.equal(el.querySelectorAll('.gt-step').length, 6);
  assert.equal(el.querySelector('.gt-step[aria-pressed="true"]').textContent.includes('G2'), true);
  assert.ok(onMainPath(el).length <= 5, 'no more than five inputs at once');
  lib.flushSync(() => el.querySelector('.gate-nav .cc-go.primary').click());
  assert.ok(el.querySelector('#gate-card-G3'), 'Next goes to G3');
  lib.flushSync(() => [...el.querySelectorAll('.gt-step')][0].click());
  assert.match(el.querySelector('.gate-state').textContent, /Approved/, 'an approved gate says so');
  assert.ok(el.querySelector('details:not([open]) [aria-label^="Status for"]'), 'milestones are folded');
  unmount();
});

test('a "What is next" gate button opens the Gates screen on that gate', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = lib.mount(el, lib.React.createElement(lib.SCREENS.Gates, { state: lib.demoState(), canEdit: false, actions: {}, onOpen: () => {}, jump: { focus: 'gate-card-G5' } }));
  assert.ok(el.querySelector('#gate-card-G5'));
  root.unmount();
  el.remove();
});

test('Risks lists open risks first, folds closed ones, and opens the wording of a new risk', () => {
  const state = lib.demoState();
  state.risks.push({ id: 'R05', risk: '', l: 'Medium', i: 'Medium', owner: '', resp: '', status: 'Open' });
  const { el, unmount } = render(lib.SCREENS.Risks, { state });
  const open = [...el.querySelectorAll('.rk-list')][0];
  assert.deepEqual([...open.children].map((li) => li.id), ['risk-R01', 'risk-R02', 'risk-R03', 'risk-R05']);
  assert.ok(el.querySelector('details:not([open]) #risk-R04'), 'the closed risk is folded');
  assert.match(el.querySelector('.rk-summary').textContent, /4 open · 1 high × high · 1 without an owner · 1 closed/);
  for (const li of open.children) assert.ok(onMainPath(li).length <= 6, `${li.id} has a short main path`);
  assert.ok(onMainPath(el.querySelector('#risk-R05')).some((x) => x.getAttribute('aria-label') === 'Risk or issue for R05'), 'a new risk opens its wording');
  assert.equal(onMainPath(el.querySelector('#risk-R01')).some((x) => x.tagName === 'TEXTAREA'), false, 'long text is folded for a written risk');
  unmount();
});

test('Investigation shows one stage at a time, opens on the next gate, and folds the Toolkit reference', () => {
  const { el, calls, unmount } = render(lib.SCREENS.Investigation, { facilitator: true });
  assert.equal(el.querySelectorAll('.iv-stage').length, 1, 'one stage card');
  assert.ok(el.querySelector('#stage-02'), 'opens on the stage of the next gate to approve (G2)');
  assert.match(el.querySelector('.gt-current').textContent, /^Stage 02: .+G2/, 'the chosen stage is named over the numbered buttons');
  assert.equal(el.querySelectorAll('.gt-steps .gt-step').length, 6);
  assert.match(el.querySelector('.iv-check').textContent, /1 of 3/, 'the first-week checklist shows progress');
  assert.ok(onMainPath(el).length <= 5, 'no more than five inputs at once');
  const box = el.querySelector('#ck1');
  lib.flushSync(() => box.click());
  assert.deepEqual(calls.filter((c) => c[0] === 'setCheck'), [['setCheck', 1, true]]);
  lib.flushSync(() => el.querySelector('.iv-stage .gate-nav .cc-go.primary').click());
  assert.ok(el.querySelector('#stage-03'), 'Next goes to stage 03');
  lib.flushSync(() => [...el.querySelectorAll('.gt-steps .gt-step')][0].click());
  assert.match(el.querySelector('.iv-stage .gate-state').textContent, /done/, 'a stage with an approved gate says it is done');
  for (const t of ['Mandate and operating rules', 'Document authority', 'Instruments (1)', 'Control rhythm']) {
    assert.ok([...el.querySelectorAll('details:not([open]) > summary')].some((x) => x.textContent === t), `${t} is folded`);
  }
  unmount();
});

test('Evidence shows each row as a card with at most three choices, ten at a time', () => {
  const { el, unmount } = render(lib.SCREENS.Evidence);
  assert.match(el.querySelector('.ev-progress').textContent, /6 of 12 answered · 4 of 12 verified/);
  assert.equal(el.querySelectorAll('li.ev').length, 10, 'ten rows first');
  for (const card of el.querySelectorAll('li.ev')) {
    assert.ok(onMainPath(card).length <= 3, `${card.id} has a short main path`);
    assert.ok(card.querySelector('details:not([open]) [aria-label^="Indago owner"]'), `${card.id} keeps the other columns behind Details`);
  }
  lib.flushSync(() => el.querySelector('.ev-more .cc-go').click());
  assert.equal(el.querySelectorAll('li.ev').length, 12, 'Show more lists the rest');
  assert.equal(el.querySelector('.ev-more'), null);
  unmount();
});

test('Client findings has a compact list that keeps the filter and opens a row as its card', () => {
  const { el, unmount } = render(lib.SCREENS.Evidence);
  const button = (text) => [...el.querySelectorAll('.ev-view button')].find((b) => b.textContent === text);
  assert.equal(button('Cards').getAttribute('aria-pressed'), 'true', 'cards are the default');
  const area = el.querySelector('select[aria-label="Business area"]');
  area.value = area.options[1].value;
  lib.flushSync(() => area.dispatchEvent(new win.Event('change', { bubbles: true })));
  const matching = el.querySelectorAll('li.ev').length;
  assert.ok(matching > 0 && matching < 12, 'the filter narrows the cards');
  lib.flushSync(() => button('Compact list').click());
  assert.equal(el.querySelectorAll('li.ev').length, 0, 'no cards in the list view');
  assert.equal(el.querySelectorAll('.ev-table tbody tr').length, matching, 'the list keeps the filter');
  assert.deepEqual([...el.querySelectorAll('.ev-table th')].map((th) => th.textContent), ['Client ID', 'Statement', 'Client answer', 'Verification status', 'Materiality']);
  assert.equal(el.querySelectorAll('.ev-table select, .ev-table input, .ev-table textarea').length, 0, 'the list is read-only');
  const id = el.querySelector('.ev-table tbody tr:last-child td.id').textContent;
  lib.flushSync(() => el.querySelector('.ev-table tbody tr:last-child .ev-open').click());
  assert.equal(button('Cards').getAttribute('aria-pressed'), 'true', 'opening a row goes back to cards');
  assert.ok(el.querySelector(`#evidence-${id} details[open]`), 'the opened card shows its Details');
  lib.flushSync(() => [...el.querySelectorAll('.subtabs [role=tab]')][1].click());
  assert.equal(el.querySelector('.ev-view'), null, 'other registers have no list switch');
  unmount();
});

test('an evidence jump shows the row even past the first ten', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = lib.mount(el, lib.React.createElement(lib.SCREENS.Evidence, { state: lib.demoState(), canEdit: false, actions: {}, onOpen: () => {}, evidenceJump: 'DEMO-EV-012' }));
  assert.ok(el.querySelector('#evidence-DEMO-EV-012'));
  root.unmount();
  el.remove();
});

test('Traceability leads with the chain, one progress line and the look-up; the breakdowns are folded', () => {
  const { el, unmount } = render(lib.SCREENS.Traceability);
  assert.match(el.querySelector('.tr-progress').textContent, /0 of 1 GDXP™ rows have the full chain/);
  assert.ok(el.querySelector('#lookup'));
  assert.deepEqual([...el.querySelectorAll('.chain .chain-n')].map((n) => n.textContent), ['1', '2', '3', '4', '5', '6', '7', '8'], 'the chain steps are numbered for the phone layout');
  assert.ok(el.querySelector('details:not([open]) .kpis'), 'the measures are folded');
  assert.ok(el.querySelector('details:not([open]) .row-bar'), 'the area breakdown is folded');
  assert.ok(el.querySelector('details:not([open]) table'), 'the classification table is folded');
  unmount();
});

// GRE-1942: client users see their own stages, checklist, evidence and progress;
// the facilitator guidance shows only when the host says the user is a facilitator.
const summaries = (el) => [...el.querySelectorAll('summary')].map((x) => x.textContent);

test('a client user does not see the Toolkit reference or stage method; a facilitator does', () => {
  const client = render(lib.SCREENS.Investigation);
  for (const t of ['Mandate and operating rules', 'Document authority', 'Control rhythm', 'How this stage runs']) {
    assert.ok(!summaries(client.el).includes(t), `client: ${t} is hidden`);
  }
  assert.ok(client.el.querySelector('.iv-stage') && client.el.querySelector('.iv-check #ck0'), 'client still sees the stage and the checklist');
  client.unmount();
  const fac = render(lib.SCREENS.Investigation, { facilitator: true });
  for (const t of ['Mandate and operating rules', 'How this stage runs']) assert.ok(summaries(fac.el).includes(t), `facilitator: ${t} shows`);
  fac.unmount();
});

test('a client user does not see the gate guidance or the Toolkit output; a facilitator does', () => {
  const client = render(lib.SCREENS.Gates);
  assert.ok(!summaries(client.el).includes('How gates work'));
  assert.doesNotMatch(client.el.textContent, /Toolkit output:/);
  assert.match(client.el.textContent, /Owner:/, 'the gate owner still shows');
  client.unmount();
  const fac = render(lib.SCREENS.Gates, { facilitator: true });
  assert.ok(summaries(fac.el).includes('How gates work'));
  assert.match(fac.el.textContent, /Toolkit output:/);
  fac.unmount();
});

test('a client user does not see the internal rules for the client IDs on Evidence', () => {
  const client = render(lib.SCREENS.Evidence);
  assert.ok(!summaries(client.el).includes("Rules for the client's IDs"));
  client.unmount();
  const fac = render(lib.SCREENS.Evidence, { facilitator: true });
  assert.ok(summaries(fac.el).includes("Rules for the client's IDs"));
  fac.unmount();
});

test('North Star: a client user gets no guardrails, timer or Greatstone notes in either view', () => {
  const ns = renderNorthStar();
  assert.equal(ns.el.querySelector('.ns-tools summary').textContent, 'Tools');
  assert.doesNotMatch(ns.el.textContent, /Facilitator guide|Workshop timer/);
  ns.click([...ns.el.querySelectorAll('.ns-rail button')].find((b) => b.textContent.includes('Ask the hard questions')));
  assert.match(ns.el.textContent, /Gordon’s words \(verbatim\)/, 'the client record field still shows');
  assert.doesNotMatch(ns.el.textContent, /Greatstone note|Greatstone interpretation/);
  ns.click(ns.button('Full record'));
  assert.equal(ns.el.querySelector('.ns-guardrails'), null);
  assert.equal(ns.el.querySelector('.ns-clock'), null);
  assert.doesNotMatch(ns.el.textContent, /Greatstone note|Greatstone challenge|internal facilitator edition/);
  assert.equal(ns.el.querySelectorAll('.ns-section').length, 10, 'every record section still shows');
  ns.unmount();
});

test('North Star: a facilitator sees the guardrails, timer and Greatstone notes', () => {
  const ns = renderNorthStar({ facilitator: true });
  assert.equal(ns.el.querySelector('.ns-tools summary').textContent, 'Tools and guide');
  assert.match(ns.el.textContent, /Facilitator guide/);
  ns.click(ns.button('Full record'));
  assert.ok(ns.el.querySelector('.ns-guardrails'));
  assert.match(ns.el.textContent, /Greatstone note \/ interpretation/);
  assert.match(ns.el.textContent, /Greatstone challenge/);
  ns.unmount();
});

// Mikey's review on GRE-1942: saved Greatstone notes must not reach a client through
// either History control, and North Star headings must not read as a facilitator script.
const savedNotes = [
  { id: 1, field_key: 'question.0.interpretation', old_value: '', new_value: 'Greatstone view: margin risk', actor: 'f@example.test', changed_at: '2026-10-22T10:00:00Z' },
  { id: 2, field_key: 'draft.challenge', old_value: '', new_value: 'Bolder alternative', actor: 'f@example.test', changed_at: '2026-10-22T10:01:00Z' },
  { id: 3, field_key: 'draft.agreed', old_value: '', new_value: 'Agreed wording', actor: 'c@example.test', changed_at: '2026-10-22T10:02:00Z' },
];
const openHistory = async (ns, from) => {
  if (from === 'record') ns.click(ns.button('Full record'));
  ns.click(ns.button('Change history'));
  for (let i = 0; i < 20 && !ns.el.querySelector('.ns-history'); i++) await settle();
  return ns.el.querySelector('.ns-history').textContent;
};

for (const from of ['guided', 'record']) {
  test(`North Star change history (${from}): a client does not see saved Greatstone notes; a facilitator does`, async () => {
    let ns = renderNorthStar({ history: savedNotes });
    let text = await openHistory(ns, from);
    assert.match(text, /draft\.agreed: Empty → Agreed wording/);
    assert.doesNotMatch(text, /Greatstone view|Bolder alternative|interpretation|draft\.challenge/);
    ns.unmount();
    ns = renderNorthStar({ history: savedNotes.slice(0, 2) });
    text = await openHistory(ns, from);
    assert.match(text, /No changes yet\./, 'only notes saved: the client sees an empty history');
    ns.unmount();
    ns = renderNorthStar({ facilitator: true, history: savedNotes });
    text = await openHistory(ns, from);
    assert.match(text, /Greatstone view: margin risk/);
    assert.match(text, /Bolder alternative/);
    ns.unmount();
  });
}

test('North Star: a client gets plain session headings, not the run of show or facilitator cues', () => {
  const facilitatorCues = /Ninety-minute|run of show|Planned outcome|Facilitator challenge|provocative interrogation|Minutes 0|our challenge|then your note/;
  let ns = renderNorthStar();
  const part = title => ns.click([...ns.el.querySelectorAll('.ns-rail button')].find((b) => b.textContent.includes(title)));
  part('Session notes');
  assert.match(ns.el.querySelector('.ns-card').textContent, /Part 1/);
  assert.ok(ns.el.querySelector('.ns-card textarea, .ns-card .ns-field'), 'the client still records session notes');
  assert.doesNotMatch(ns.el.textContent, facilitatorCues);
  part('Ask the hard questions');
  assert.doesNotMatch(ns.el.textContent, facilitatorCues);
  ns.click(ns.button('Full record'));
  const headings = [...ns.el.querySelectorAll('.ns-section h3')].map(h => h.textContent);
  assert.ok(headings.includes('Session notes') && headings.includes('The hard questions') && headings.includes('Test the draft'), headings.join(' | '));
  assert.doesNotMatch(ns.el.textContent, facilitatorCues);
  ns.unmount();
  ns = renderNorthStar({ facilitator: true });
  ns.click(ns.button('Full record'));
  assert.match(ns.el.textContent, /Ninety-minute workshop run of show/);
  assert.match(ns.el.textContent, /Planned outcome/);
  assert.match(ns.el.textContent, /Facilitator challenge and convergence test/);
  ns.unmount();
});
