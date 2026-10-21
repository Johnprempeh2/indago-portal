import React, { useState } from 'react';
import { OPT } from '../model/options.mjs';
import { filterWbs, EMPTY_WBS_FILTER, ganttCells, depsOpen, pct, uniq, weekLabel, wbsById } from '../model/indago-model.mjs';
import { EditSelect, EditText, FilterSelect, Governs, Pill } from './ui.jsx';

const COLS = ['WBS', 'Task / activity', 'Accountable role', 'Named owner', 'Period', 'Depends on', 'Exit criterion', 'Gate', 'Status', '%', 'Actual finish', 'Evidence / link', 'Blocker / decision'];

function Deliverables({ id, files, canEdit, fileActions }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async work => {
    setBusy(true); setMessage('');
    try { await work(); setMessage('Done.'); }
    catch (error) { setMessage(error.message || 'File action failed. Try again.'); }
    finally { setBusy(false); }
  };
  const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  return <details className="deliverables">
    <summary>Deliverables <span className="file-count">{files.length}</span></summary>
    <div className="deliverables-body">
      {canEdit && fileActions && <label className="btn small file-upload">Upload
        <input type="file" accept=".pdf,.docx,.xlsx,.csv,.pptx,.png,.jpg,.jpeg,.gif,.webp,.zip"
          disabled={busy} aria-label={`Upload deliverable for ${id}`}
          onChange={e => { const file = e.target.files?.[0]; if (file) run(() => fileActions.upload(id, file)); e.target.value = ''; }} />
      </label>}
      {!files.length && <p className="empty">No files yet.</p>}
      {!!files.length && <ul className="file-list">{files.map(file => <li key={file.id}>
        <span className="file-name">{file.file_name}</span>
        <span>{size(file.byte_size)} · {file.uploaded_by} · {new Date(file.uploaded_at).toLocaleString('en-GB')}</span>
        {fileActions && <span className="file-actions"><button type="button" className="btn small" disabled={busy}
          onClick={() => run(() => fileActions.download(file))}>Download</button>
        {canEdit && <button type="button" className="btn small" disabled={busy}
          onClick={() => { if (window.confirm(`Remove ${file.file_name} from ${id}? It will remain in history.`)) run(() => fileActions.remove(file.id)); }}>Remove</button>}</span>}
      </li>)}</ul>}
      {busy && <p role="status">Working on file…</p>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}

export default function WorkPlan({ state, canEdit, actions, files = [], fileActions }) {
  const [f, setF] = useState(EMPTY_WBS_FILTER);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const rows = filterWbs(state, f);
  const edit = (w, field) => (value) => actions.updateWbs(w.id, field, value);
  let group = '';

  return (
    <>
      <Governs>Master Project Plan · Work Breakdown</Governs>
      <h2 className="section-title">Work plan</h2>
      <p className="lead">Each work package has a role, a period, dependencies, an exit criterion and a gate. Change the status here; progress is calculated as in the workbook (Complete = 100 %, In progress = 50 %). Add the named Greatstone owner when people are assigned.</p>

      <div className="card mb kickoff">
        <label htmlFor="kickoff">Agreed W1 start date</label>
        {canEdit
          ? <input id="kickoff" type="date" key={state.kickoff} defaultValue={state.kickoff} onBlur={(e) => e.target.value !== state.kickoff && actions.setKickoff(e.target.value)} />
          : <span className="ro">{state.kickoff || 'Not set'}</span>}
        <span className="hint">{state.kickoff ? 'Periods below show calendar weeks from this date.' : 'Not set. W1–W4 are planning assumptions until dates are agreed at kick-off.'}</span>
      </div>

      <div className="toolbar">
        <input type="search" value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search work packages" aria-label="Search work packages" />
        <FilterSelect value={f.ws} onChange={set('ws')} all="All workstreams" options={uniq(state.wbs.map((w) => w.ws))} label="Workstream" />
        <FilterSelect value={f.gate} onChange={set('gate')} all="All gates" options={state.gates.map((g) => g.id)} label="Gate" />
        <FilterSelect value={f.status} onChange={set('status')} all="All statuses" options={OPT.wbsStatus} label="Status" />
        <FilterSelect value={f.role} onChange={set('role')} all="All roles" options={uniq(state.wbs.map((w) => w.role)).sort()} label="Accountable role" />
        <span className="count" aria-live="polite">{rows.length} of {state.wbs.length} work packages</span>
      </div>

      <div className="table-wrap">
        <table className="gs-table stack">
          <thead><tr>{COLS.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={COLS.length} className="empty">No work packages match the filter.</td></tr>}
            {rows.map((w) => {
              const head = w.ws !== group ? (group = w.ws) : null;
              const open = depsOpen(state, w);
              const warn = (w.status === 'In progress' || w.status === 'Complete') && open.length;
              const lbl = (c) => `${c} for ${w.id}`;
              return (
                <React.Fragment key={w.id}>
                  {head && <tr className="group"><td colSpan={COLS.length}>{head}</td></tr>}
                  <tr>
                    <td className="id" data-label="WBS">{w.id} <span className="file-count" aria-label={`${files.filter(file => file.work_package_id === w.id).length} deliverables`}>{files.filter(file => file.work_package_id === w.id).length}</span></td>
                    <td className="mid task" data-label="Task">{w.task}</td>
                    <td data-label="Role">{w.role}</td>
                    <td data-label="Named owner"><EditText canEdit={canEdit} value={w.person} onCommit={edit(w, 'person')} label={lbl('Named owner')} placeholder="Add name" /></td>
                    <td data-label="Period" className="period">
                      <div className="gantt" title={`${weekLabel(state.kickoff, w.start)} → ${weekLabel(state.kickoff, w.finish)}`} aria-label={`${weekLabel(state.kickoff, w.start)} to ${weekLabel(state.kickoff, w.finish)}`} role="img">
                        {ganttCells(w).map((c) => <span key={c.period} className={c.on ? `on${c.done ? ' done' : ''}` : ''} />)}
                      </div>
                      <div className="gantt-h" aria-hidden="true"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>Post</span></div>
                    </td>
                    <td data-label="Depends on">
                      {w.deps.length ? w.deps.map((d) => <Pill key={d} tone={wbsById(state, d)?.status === 'Complete' ? 'ok' : 'mute'}>{d}</Pill>) : <span className="empty">none</span>}
                    </td>
                    <td className="mid" data-label="Exit criterion">{w.exit}</td>
                    <td data-label="Gate">{w.gate}</td>
                    <td data-label="Status">
                      <EditSelect canEdit={canEdit} options="wbsStatus" value={w.status} onCommit={edit(w, 'status')} label={lbl('Status')} />
                      {warn ? <span className="dep-warn">Waiting on {open.join(', ')}</span> : null}
                    </td>
                    <td className="calc" data-label="%">{Math.round(pct(w.status) * 100)}</td>
                    <td data-label="Actual finish"><EditText canEdit={canEdit} type="date" value={w.actual} onCommit={edit(w, 'actual')} label={lbl('Actual finish')} /></td>
                    <td data-label="Evidence / link"><EditText canEdit={canEdit} value={w.link} onCommit={edit(w, 'link')} label={lbl('Evidence or link')} placeholder="IDs or link" /></td>
                    <td data-label="Blocker / decision"><EditText canEdit={canEdit} multiline value={w.blocker} onCommit={edit(w, 'blocker')} label={lbl('Blocker or decision')} placeholder="—" /></td>
                  </tr>
                  <tr className="deliverables-row"><td colSpan={COLS.length}>
                    <Deliverables id={w.id} files={files.filter(file => file.work_package_id === w.id)}
                      canEdit={canEdit} fileActions={fileActions} />
                  </td></tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
