import { REG } from '../model/options.mjs';
import { newRisk, newRegRow } from '../model/indago-model.mjs';
import { displayValues } from '../indago.mjs';

const PLAN = {
  'Work Breakdown': ['id', 'ws', 'task', 'role', 'start', 'finish', 'deps', 'exit', 'gate', 'status', null, 'actual', 'link', 'blocker'],
  'Stage Gates': ['id', 'stage', 'accept', 'owner', 'status', 'date', 'exc'],
  'Milestones': ['name', 'period', 'pre', 'out', 'status', 'date'],
  'Risks & Issues': ['id', 'risk', 'l', 'i', 'owner', 'resp', 'status'],
};
const EDITABLE = {
  'Work Breakdown': ['person', 'status', 'actual', 'link', 'blocker'],
  'Stage Gates': ['status', 'date', 'exc'],
  Milestones: ['status', 'date'],
  'Risks & Issues': ['risk', 'l', 'i', 'owner', 'resp', 'status'],
};

export function recordsToState(snapshot) {
  const byTitle = new Map(snapshot.sheets.map(sheet => [sheet.title, {
    sheet, rows: snapshot.records.filter(record => record.sheet_id === sheet.id).sort((a, b) => a.position - b.position),
  }]));
  const rows = title => byTitle.get(title)?.rows ?? [];
  const objects = title => rows(title).map(record => {
    const values = displayValues(record);
    const item = Object.fromEntries(PLAN[title].flatMap((field, i) => field ? [[field, values[i] ?? '']] : []));
    if (title === 'Work Breakdown') {
      item.person = record.edits.person ?? '';
      item.deps = item.deps ? item.deps.split(';').map(x => x.trim()).filter(Boolean) : [];
    }
    return item;
  });
  const settings = rows('Portal Settings')[0];
  const toolkit = rows('Delivery Toolkit')[0];
  const reg = Object.fromEntries(Object.keys(REG).map(title => {
    const item = byTitle.get(title);
    return [title, { cols: item?.sheet.columns ?? [], rows: item?.rows.map(displayValues) ?? [] }];
  }));
  const parsedToolkit = toolkit?.source_values?.[0] ? JSON.parse(toolkit.source_values[0]) : null;
  return {
    kickoff: settings?.edits.kickoff ?? '',
    check: parsedToolkit?.checklist?.map((_, i) => settings?.edits[`check${i}`] === 'true') ?? [],
    toolkit: parsedToolkit,
    wbs: objects('Work Breakdown'), gates: objects('Stage Gates'), ms: objects('Milestones'),
    risks: objects('Risks & Issues'), reg,
  };
}

export function makeRecordStore(api, onSnapshot, onError) {
  let snapshot = null;
  const find = (title, key) => {
    const sheet = snapshot?.sheets.find(s => s.title === title);
    const record = snapshot?.records.find(r => r.sheet_id === sheet?.id && (key === undefined || displayValues(r)[0] === key));
    if (!sheet || !record) throw new Error(`Record unavailable in ${title}. Reload the portal.`);
    return { sheet, record };
  };
  const refresh = async () => { snapshot = await api.snapshot(); onSnapshot(snapshot); return snapshot; };
  const run = work => Promise.resolve().then(work).catch(error => onError(error.message || 'Save failed. Reload and try again.'));
  const save = async (title, key, field, value) => {
    const { sheet, record } = find(title, key);
    const index = PLAN[title]?.indexOf(field) ?? -1;
    if (EDITABLE[title] && !EDITABLE[title].includes(field)) throw new Error('This field is read only.');
    if (index < 0 && !(title === 'Work Breakdown' && field === 'person') && title !== 'Portal Settings') throw new Error('Unknown field.');
    const editKey = index >= 0 ? String(index) : field;
    const edits = { ...record.edits, [editKey]: String(value) };
    const values = displayValues(record);
    if (title === 'Work Breakdown' && field === 'status' && value === 'Complete' && !values[11]) edits['11'] = new Date().toISOString().slice(0, 10);
    if (title === 'Stage Gates' && field === 'status' && String(value).startsWith('Approved') && !values[5]) edits['5'] = new Date().toISOString().slice(0, 10);
    await api.save(record, edits);
    await refresh();
  };
  const add = async (title, values) => {
    const sheet = snapshot?.sheets.find(s => s.title === title);
    if (!sheet) throw new Error(`Register unavailable: ${title}`);
    const position = Math.max(0, ...snapshot.records.filter(r => r.sheet_id === sheet.id).map(r => r.position)) + 1;
    await api.add({ id: `${sheet.id}:${position}`, sheet_id: sheet.id, position, source_values: values });
    await refresh();
  };
  return {
    refresh,
    actions: {
      updateWbs: (id, field, value) => run(() => save('Work Breakdown', id, field, value)),
      updateGate: (id, field, value) => run(() => save('Stage Gates', id, field, value)),
      updateMilestone: (name, field, value) => run(() => save('Milestones', name, field, value)),
      updateRisk: (id, field, value) => run(() => save('Risks & Issues', id, field, value)),
      addRisk: () => run(() => add('Risks & Issues', Object.values(newRisk(recordsToState(snapshot).risks)))),
      updateRegCell: (title, rowId, col, value) => run(async () => {
        if (col === 0 || REG[title]?.lock?.includes(col)) throw new Error('This source field is locked.');
        const { record } = find(title, rowId);
        await api.save(record, { ...record.edits, [String(col)]: String(value) });
        await refresh();
      }),
      addRegRow: title => run(() => {
        if (REG[title]?.noAdd) throw new Error('This source register cannot accept new rows.');
        const R = recordsToState(snapshot).reg[title];
        return add(title, newRegRow(title, R.cols, R.rows));
      }),
      setKickoff: date => run(() => save('Portal Settings', 'settings', 'kickoff', date)),
      setCheck: (index, done) => run(() => save('Portal Settings', 'settings', `check${index}`, done)),
    },
  };
}
