// MADE-UP DEMO DATA for tests, screenshots and the local demo page.
// It has the same shape as the real portal state but no client data:
// every task, finding, request and name here is invented.

import { REG } from '../model/options.mjs';

const WS = [
  ['Evidence confirmation', 'G1', 'Evidence controller'],
  ['North Star', 'G2', 'Engagement lead'],
  ['Service operations', 'G3', 'Process lead'],
  ['Commercial economics', 'G4', 'Commercial lead'],
  ['Data, AI & technology', 'G5', 'Data/technology lead'],
  ['GDXP readiness', 'G6', 'Engagement lead'],
];
const TASKS = [
  ['Agree demo data access route', 'Demo access note'],
  ['Import demo findings with original IDs', 'Demo register'],
  ['Triage demo information requests', 'Demo request tracker'],
  ['Review demo contradictions', 'Demo exceptions list'],
];
const STATUS = ['Complete', 'Complete', 'In progress', 'Not started', 'Blocked', 'Not started', 'In progress', 'Not started'];
const PER = [['W1', 'W1'], ['W1', 'W2'], ['W2', 'W3'], ['W3', 'W4'], ['W4', 'Post-playback']];

function buildWbs() {
  const out = [];
  let k = 0;
  WS.forEach(([ws, gate, role], wi) => {
    const n = wi === 2 ? 4 : wi === 5 ? 2 : 3;
    for (let t = 0; t < n; t++) {
      const id = `${wi + 1}.0${t + 1}`;
      const status = STATUS[k % STATUS.length];
      const [start, finish] = PER[(wi + t) % PER.length];
      out.push({
        id, ws, task: `${TASKS[t % TASKS.length][0]} (${ws.toLowerCase()})`, role, person: wi === 0 && t === 0 ? 'Demo Person' : '',
        start, finish, deps: t > 0 ? [`${wi + 1}.0${t}`] : wi > 0 ? [`${wi}.01`] : [],
        exit: TASKS[t % TASKS.length][1], gate, status,
        actual: status === 'Complete' ? '2026-10-20' : '', link: '',
        blocker: status === 'Blocked' ? 'Waiting for a demo decision' : '',
      });
      k++;
    }
  });
  return out;
}

const GATES = [
  ['G1', 'Evidence confirmation', 'Approved'], ['G2', 'North Star', 'Ready for review'], ['G3', 'Current state', 'Open'],
  ['G4', 'Economics', 'Open'], ['G5', 'Transformation options', 'Open'], ['G6', 'Playback readiness', 'Open'],
].map(([id, stage, status]) => ({ id, stage, accept: `Demo acceptance evidence for ${stage.toLowerCase()}`, owner: 'Engagement lead', status, date: status === 'Approved' ? '2026-10-24' : '', exc: '' }));

const MS = [
  ['Kick-off held', 'W1', 'Access agreed', 'Demo kick-off record', 'Achieved'],
  ['Baseline approved', 'W2–W3', 'G1 evidence', 'Demo baseline decision', 'At risk'],
  ['Playback', 'W4', 'G1–G5', 'Demo playback decision', 'Pending'],
].map(([name, period, pre, out, status]) => ({ name, period, pre, out, status, date: status === 'Achieved' ? '2026-10-20' : '' }));

const RISKS = [
  ['R01', 'Demo risk: source files arrive late', 'High', 'High', 'Engagement lead', 'Agree a demo transfer date', 'Open'],
  ['R02', 'Demo risk: sample project not available', 'Medium', 'High', 'Process lead', 'Pick a second demo project', 'Mitigating'],
  ['R03', 'Demo risk: cost data in two currencies', 'Low', 'Medium', 'Commercial lead', 'Record the currency per row', 'Open'],
  ['R04', 'Demo issue: workshop moved', 'Medium', 'Low', 'Engagement lead', 'New date agreed', 'Closed'],
].map(([id, risk, l, i, owner, resp, status]) => ({ id, risk, l, i, owner, resp, status }));

const AREAS = ['Demo area A', 'Demo area B', 'Demo area C'];
const CLS = ['stated', 'confirm', 'differ'];
const ANS = ['Confirmed', 'Partly correct', '', 'Not correct', 'Not answered', ''];
const VER = ['Corroborated', 'Not assessed', 'Source checked', 'Contradicted', 'Client-validated', 'Not assessed'];

function buildReg() {
  const blank = (k) => ({ cols: COLS[k], rows: [] });
  const reg = Object.fromEntries(Object.keys(REG).map((k) => [k, blank(k)]));
  reg['Client Findings'].rows = Array.from({ length: 12 }, (_, i) => {
    const id = `DEMO-EV-${String(i + 1).padStart(3, '0')}`;
    return [id, AREAS[i % 3], CLS[i % 3], `Demo statement ${i + 1}: a made-up fact used to test the screens.`, 'Demo source',
      ANS[i % ANS.length], i % 4 === 0 ? 'Demo correction text' : '', i % 5 === 0 ? 'DEMO-DD-001' : '', VER[i % VER.length],
      ['', 'Low', 'Medium', 'High'][i % 4], '', '', '', i === 2 ? 'DEMO-F-001' : '', ''];
  });
  reg['Information Requests'].rows = Array.from({ length: 6 }, (_, i) => [
    `DEMO-RQ-${String(i + 1).padStart(2, '0')}`, `Demo request ${i + 1} for a made-up document`, `Demo section ${i % 2 + 1}`,
    ['Yes', 'Partly', '', 'No'][i % 4], '', '', ['High', 'Medium', 'Low'][i % 3], ['Requested', 'Complete', 'Not requested'][i % 3], '', '', '']);
  reg['New Deep Dive Evidence'].rows = [['DEMO-DD-001', 'Demo service', 'Fieldwork', 'Observation', '2026-10-21', 'Demo observation of a made-up process step', '', 'Received', 'Process lead', 'DEMO-EV-001', '', '']];
  reg['Findings'].rows = [['DEMO-F-001', 'Demo area A', 'Demo root cause', 'DEMO-EV-003', 'Demo impact', 'Partly corroborated', '', 'Process lead', 'Medium', 'Draft']];
  reg['Opportunities'].rows = [['DEMO-OP-001', 'Demo objective', 'DEMO-F-001', 'Demo option', 'Demo KPI', 'Medium', '', '', 'DEMO-EV-003', 'Hypothesis']];
  reg['Commercial Baseline'].rows = [['DEMO-CM-001', 'Demo service', 'FY demo', 'Demo Ltd / GBP', '100000', '60000', '15000', '', '', '', '', 'Unverified']];
  reg['GDXP Traceability'].rows = [['DEMO-GDXP-001', 'Demo KPI', 'DEMO-EV-003', '', 'DEMO-F-001', 'DEMO-OP-001', '', '', '', 'Draft']];
  return reg;
}

// Column headings are the workbook's structure, not client data.
export const COLS = {
  'Client Findings': ['Client ID', 'Business area', 'Original classification', 'Original statement', 'Source attribution', 'Client answer', 'Client correction / comment', 'Supporting evidence ID', 'Verification status', 'Materiality', 'Indago owner', 'Greatstone reviewer', 'Date reviewed', 'Related finding ID', 'Exception / follow-up'],
  'Information Requests': ['Request ID', 'Original request', 'Source / section', 'Indago will provide?', 'Client comment / owner', 'Greatstone owner', 'Priority', 'Status', 'Due', 'Received location', 'Adequacy / next action'],
  'New Deep Dive Evidence': ['Evidence ID', 'Service / function', 'Process step', 'Source type', 'Date', 'Factual observation', 'Secure artefact link', 'Verification', 'Owner', 'Linked client ID', 'Related finding', 'Restrictions'],
  'Service Processes': ['Process ID', 'Service', 'Stage', 'Trigger / input', 'Output / customer value', 'Owner', 'System / data', 'Active minutes', 'Elapsed hours', 'Volume', 'Rework / exception', 'Direct cost', 'Evidence IDs', 'Status'],
  'Commercial Baseline': ['Commercial ID', 'Service / process', 'Period', 'Entity / currency', 'Revenue', 'Direct cost', 'Allocated cost', 'Contribution', 'Margin %', 'Evidence ID', 'Assumptions / reconciliation', 'Status'],
  'Findings': ['Finding ID', 'Business area', 'Finding / root cause', 'Evidence IDs', 'Impact / baseline', 'Corroboration', 'Indago validation', 'Owner', 'Severity', 'Status'],
  'Opportunities': ['Opportunity ID', 'North Star objective', 'Problem / finding IDs', 'Option / hypothesis', 'Expected value / KPI', 'Feasibility', 'Investment assumptions', 'Dependencies / risks', 'Evidence IDs', 'Decision status'],
  'Decisions': ['Decision ID', 'Decision / options', 'Authority', 'Date', 'Rationale', 'Evidence / opportunity IDs', 'Conditions / exceptions', 'Status'],
  'GDXP Traceability': ['GDXP ID', 'North Star ID / KPI', 'Client IND-EV IDs', 'New IND-DD IDs', 'Finding IDs', 'Opportunity IDs', 'Target design / roadmap', 'Benefit / KPI', 'Assumption / risk', 'Gate status'],
  'Validation Log': ['Record ID', 'Type', 'Indago confirmer / role', 'Decision', 'Correction / exception', 'Date', 'Evidence link', 'Greatstone reviewer'],
};

const TOOLKIT = {
  rules: ['Demo rule: a client answer is an attestation, not proof.', 'Demo rule: keep corrected versions with dates and sources.', 'Demo rule: every recommendation traces back to evidence.'],
  authority: [['Demo register', 'Demo authority: the client-facing ID set.'], ['Demo plan', 'Demo authority: controls the work breakdown.']],
  stages: WS.map(([ws, gate], i) => ({
    n: `0${i + 1}`, g: gate, ws, t: `Demo stage ${i + 1}: ${ws}`, o: `Demo output for ${ws.toLowerCase()}`,
    intro: `Demo introduction to the ${ws.toLowerCase()} stage.`, steps: i === 0 ? ['Demo step one.', 'Demo step two.'] : [], inst: i === 0 ? ['ED-01'] : [],
  })),
  agenda: [['0–10', 'Demo opening', 'Demo record'], ['10–30', 'Demo discussion', 'Demo notes']],
  nsq: ['Demo question one?', 'Demo question two?'],
  interviews: [['Demo role', 'Demo focus']],
  instruments: [{ c: 'ED-01', n: 'Demo instrument', f: 'Demo fields · ID · status', home: 'Client Findings', g: 'G1' }],
  rhythm: [['Daily', 'Demo intake check.'], ['Weekly', 'Demo sponsor review.']],
  checklist: ['Demo checklist item one.', 'Demo checklist item two.', 'Demo checklist item three.'],
};

export function demoState() {
  return {
    kickoff: '', wbs: buildWbs(), gates: GATES.map((g) => ({ ...g })), ms: MS.map((m) => ({ ...m })),
    risks: RISKS.map((r) => ({ ...r })), reg: buildReg(), check: [true, false, false], toolkit: TOOLKIT,
  };
}
