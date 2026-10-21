// Option lists and register column rules, ported from the v1 portal (GRE-1681).
// Structure only: no client data lives in this file.

export const OPT = {
  wbsStatus: ['Not started', 'In progress', 'Blocked', 'Complete', 'Deferred'],
  gateStatus: ['Open', 'Ready for review', 'Approved', 'Approved with exceptions', 'Not approved'],
  msStatus: ['Pending', 'At risk', 'Achieved', 'Moved'],
  lmh: ['', 'Low', 'Medium', 'High'],
  riskStatus: ['Open', 'Mitigating', 'Closed', 'Realised (issue)'],
  clientAnswer: ['', 'Confirmed', 'Partly correct', 'Not correct', 'Not answered'],
  verif: ['Not assessed', 'Source checked', 'Corroborated', 'Contradicted', 'Client-validated', 'Superseded'],
  provide: ['', 'Yes', 'Partly', 'No'],
  rqStatus: ['Not requested', 'Requested', 'Partly received', 'Received', 'Complete', 'Declined'],
  ddVerif: ['Not received', 'Received', 'Source checked', 'Corroborated', 'Contradicted'],
  prStatus: ['Not started', 'In progress', 'Mapped', 'Validated'],
  cmStatus: ['Unverified', 'Reconciled', 'Verified', 'Qualified'],
  corro: ['Unverified', 'Partly corroborated', 'Corroborated', 'Contradicted'],
  fStatus: ['Draft', 'Under challenge', 'Validated', 'Withdrawn'],
  opStatus: ['Hypothesis', 'Under assessment', 'Recommended', 'Deferred', 'Rejected'],
  decStatus: ['Pending', 'Approved', 'Approved with conditions', 'Rejected', 'Deferred'],
  gdxp: ['Draft', 'Ready for audit', 'Passed', 'Exception'],
  valDec: ['', 'Confirmed', 'Corrected', 'Rejected', 'Exception noted'],
};

// Per register sheet: locked columns (client source record), select columns,
// wide text columns, date and number columns, filters, and the ID prefix for new rows.
export const REG = {
  'Client Findings': { label: 'Client findings', lock: [0, 1, 2, 3, 4], sel: { 5: 'clientAnswer', 8: 'verif', 9: 'lmh' }, wide: [3, 6, 14], noAdd: true, filters: [1, 2, 5, 8] },
  'Information Requests': { label: 'Information requests', lock: [0, 1, 2], sel: { 3: 'provide', 6: 'lmh', 7: 'rqStatus' }, wide: [1, 10], date: [8], noAdd: true, filters: [2, 6, 7] },
  'New Deep Dive Evidence': { label: 'New evidence', prefix: 'IND-DD-', pad: 3, sel: { 7: 'ddVerif' }, wide: [5], date: [4], filters: [1, 7] },
  'Service Processes': { label: 'Service processes', prefix: 'IND-PR-', pad: 3, sel: { 13: 'prStatus' }, filters: [1, 13] },
  'Commercial Baseline': { label: 'Commercial baseline', prefix: 'IND-CM-', pad: 3, sel: { 11: 'cmStatus' }, calc: { 7: 'contrib', 8: 'margin' }, num: [4, 5, 6], filters: [11] },
  'Findings': { label: 'Findings', prefix: 'IND-F-', pad: 3, sel: { 5: 'corro', 8: 'lmh', 9: 'fStatus' }, wide: [2], filters: [1, 9] },
  'Opportunities': { label: 'Opportunities', prefix: 'IND-OP-', pad: 3, sel: { 9: 'opStatus' }, wide: [3], filters: [9] },
  'Decisions': { label: 'Decisions', prefix: 'IND-DEC-', pad: 3, sel: { 7: 'decStatus' }, wide: [1], date: [3], filters: [7] },
  'GDXP Traceability': { label: 'GDXP™ traceability', prefix: 'IND-GDXP-', pad: 3, sel: { 9: 'gdxp' }, wide: [6], filters: [9] },
  'Validation Log': { label: 'Validation log', prefix: 'VAL-', pad: 3, sel: { 3: 'valDec' }, date: [5], filters: [1, 3] },
  'North Star Requests': { label: 'North Star requests', lock: [0, 1, 6], wide: [2], date: [4], noAdd: true, filters: [] },
};

export const PERIODS = ['W1', 'W2', 'W3', 'W4', 'Post-playback'];

export const TABS = [
  { id: 'control', label: 'Control centre' },
  { id: 'plan', label: 'Work plan', src: 'Plan' },
  { id: 'north-star', label: 'North Star', src: 'NS-01' },
  { id: 'gates', label: 'Gates & milestones', src: 'Plan' },
  { id: 'risks', label: 'Risks', src: 'Plan' },
  { id: 'investigation', label: 'Investigation', src: 'Toolkit' },
  { id: 'evidence', label: 'Evidence', src: 'Register' },
  { id: 'trace', label: 'Traceability', src: 'Register' },
];

const TONE = {
  'Complete': 'ok', 'Approved': 'ok', 'Achieved': 'ok', 'Closed': 'ok', 'Validated': 'ok', 'Corroborated': 'ok', 'Passed': 'ok', 'Verified': 'ok',
  'In progress': 'prog', 'Mitigating': 'prog', 'Ready for review': 'prog', 'Requested': 'prog', 'Under assessment': 'prog',
  'Blocked': 'bad', 'Contradicted': 'bad', 'Not approved': 'bad', 'Realised (issue)': 'bad', 'High risk': 'bad',
  'At risk': 'warn', 'Approved with exceptions': 'warn',
};

export const toneFor = (status) => TONE[status] || 'mute';
