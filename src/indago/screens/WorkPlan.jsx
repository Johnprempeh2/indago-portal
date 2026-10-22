import React, { useState } from 'react';
import { OPT } from '../model/options.mjs';
import { filterWbs, EMPTY_WBS_FILTER, ganttCells, depsOpen, pct, uniq, weekLabel, wbsById, wbsGroups, controlSummary } from '../model/indago-model.mjs';
import { Bar, EditSelect, EditText, FilterSelect, Governs, Pill } from './ui.jsx';

export function Deliverables({ id, files, canEdit, fileActions }) {
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

// One work package: what it is and its status on the main path; owner,
// dates, evidence, blocker and files behind "Details" (GRE-1891).
function WorkPackage({ w, state, canEdit, edit, files, fileActions, onOpen, hideNorthStar }) {
  const open = depsOpen(state, w);
  const warn = (w.status === 'In progress' || w.status === 'Complete') && open.length;
  const lbl = (c) => `${c} for ${w.id}`;
  const period = w.start === w.finish ? weekLabel(state.kickoff, w.start) : `${weekLabel(state.kickoff, w.start)} → ${weekLabel(state.kickoff, w.finish)}`;
  return (
    <li id={`wbs-${w.id}`} className={`wp${w.status === 'Complete' ? ' done' : ''}${w.status === 'Blocked' ? ' blocked' : ''}`}>
      <div className="wp-head">
        <span className="wp-tick" aria-hidden="true">{w.status === 'Complete' ? '✓' : ''}</span>
        <div className="wp-what">
          <div className="wp-title"><span className="id">{w.id}</span> {w.task}</div>
          <div className="wp-meta">{w.person || w.role} · {period} · {w.gate}
            {!!files.length && <> · <span className="file-count" aria-label={`${files.length} deliverables`}>{files.length}</span> {files.length === 1 ? 'file' : 'files'}</>}
          </div>
          {!hideNorthStar && (w.gate === 'G2' || /north star/i.test(`${w.task} ${w.ws}`)) && <button type="button" className="link-button small" onClick={() => onOpen('north-star')}>Open North Star instrument</button>}
          {warn ? <div className="dep-warn">Waiting on {open.join(', ')}</div> : null}
          {w.status === 'Blocked' && w.blocker && <div className="wp-blocker"><b>Blocker:</b> {w.blocker}</div>}
        </div>
        <div className="wp-status"><EditSelect canEdit={canEdit} options="wbsStatus" value={w.status} onCommit={edit('status')} label={lbl('Status')} /></div>
      </div>
      <details className="ns-more wp-more">
        <summary>Details</summary>
        <dl className="wp-fields">
          <div><dt>Done when</dt><dd>{w.exit}</dd></div>
          <div><dt>Accountable role</dt><dd>{w.role}</dd></div>
          <div><dt>Named owner</dt><dd><EditText canEdit={canEdit} value={w.person} onCommit={edit('person')} label={lbl('Named owner')} placeholder="Add name" /></dd></div>
          <div><dt>Period</dt><dd>
            <div className="gantt" aria-label={period} role="img">
              {ganttCells(w).map((c) => <span key={c.period} className={c.on ? `on${c.done ? ' done' : ''}` : ''} />)}
            </div>
            <div className="gantt-h" aria-hidden="true"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>Post</span></div>
          </dd></div>
          <div><dt>Depends on</dt><dd>{w.deps.length ? w.deps.map((d) => <Pill key={d} tone={wbsById(state, d)?.status === 'Complete' ? 'ok' : 'mute'}>{d}</Pill>) : <span className="empty">none</span>}</dd></div>
          <div><dt>Progress</dt><dd className="calc">{Math.round(pct(w.status) * 100)}%</dd></div>
          <div><dt>Actual finish</dt><dd><EditText canEdit={canEdit} type="date" value={w.actual} onCommit={edit('actual')} label={lbl('Actual finish')} /></dd></div>
          <div><dt>Evidence / link</dt><dd><EditText canEdit={canEdit} value={w.link} onCommit={edit('link')} label={lbl('Evidence or link')} placeholder="IDs or link" /></dd></div>
          <div className="wide"><dt>Blocker / decision</dt><dd><EditText canEdit={canEdit} multiline value={w.blocker} onCommit={edit('blocker')} label={lbl('Blocker or decision')} placeholder="—" /></dd></div>
        </dl>
        <Deliverables id={w.id} files={files} canEdit={canEdit} fileActions={fileActions} />
      </details>
    </li>
  );
}

// The Work plan as a short list per workstream, each with its own progress (GRE-1891).
export default function WorkPlan({ state, canEdit, actions, files = [], fileActions, onOpen, hideNorthStar = false, jump }) {
  const [f, setF] = useState(() => ({ ...EMPTY_WBS_FILTER, ...jump?.filter }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const rows = filterWbs(state, f);
  const s = controlSummary(state);
  const more = ['ws', 'gate', 'role'].filter((k) => f[k]).length;

  return (
    <>
      <Governs>Master Project Plan · Work Breakdown</Governs>
      <h2 className="section-title">Work plan</h2>
      <p className="lead">Change a status as the work moves. Open <b>Details</b> for the owner, dates, evidence and files.</p>

      <div className="wp-progress" aria-label="Plan progress">
        <span className="ns-progress-text"><b>{s.done} of {s.total}</b> complete · {s.inProgress} in progress{s.blocked ? <> · <span className="warn-text">{s.blocked} blocked</span></> : null}</span>
        <Bar percent={s.total ? Math.round(s.done / s.total * 100) : 0} label="Work packages complete" />
        <details className="ns-more">
          <summary>How progress is counted</summary>
          <p>Each work package has a role, a period, dependencies, an exit criterion and a gate. Progress is calculated as in the workbook (Complete = 100 %, In progress = 50 %). Add the named Greatstone owner when people are assigned.</p>
        </details>
      </div>

      <div className="card mb kickoff">
        <label htmlFor="kickoff">Agreed W1 start date</label>
        {canEdit
          ? <input id="kickoff" type="date" key={state.kickoff} defaultValue={state.kickoff} onBlur={(e) => e.target.value !== state.kickoff && actions.setKickoff(e.target.value)} />
          : <span id="kickoff" className="ro">{state.kickoff || 'Not set'}</span>}
        <span className="hint">{state.kickoff ? 'Periods show calendar weeks from this date.' : 'Not set. W1–W4 are planning assumptions until dates are agreed at kick-off.'}</span>
      </div>

      <div id="wbs-toolbar" className="toolbar">
        <input type="search" value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search work packages" aria-label="Search work packages" />
        <FilterSelect value={f.status} onChange={set('status')} all="All statuses" options={OPT.wbsStatus} label="Status" />
        <details className="ns-more wp-filters" open={more > 0 || undefined}>
          <summary>More filters{more ? ` (${more})` : ''}</summary>
          <div className="wp-filter-row">
            <FilterSelect value={f.ws} onChange={set('ws')} all="All workstreams" options={uniq(state.wbs.map((w) => w.ws))} label="Workstream" />
            <FilterSelect value={f.gate} onChange={set('gate')} all="All gates" options={state.gates.map((g) => g.id)} label="Gate" />
            <FilterSelect value={f.role} onChange={set('role')} all="All roles" options={uniq(state.wbs.map((w) => w.role)).sort()} label="Accountable role" />
          </div>
        </details>
        <span className="count" aria-live="polite">{rows.length} of {state.wbs.length} work packages</span>
      </div>

      {!rows.length && <p className="empty">No work packages match the filter.</p>}
      {wbsGroups(state, rows).map((g) => (
        <section key={g.name} className={`wp-group${g.done === g.total ? ' done' : ''}`} aria-label={g.name}>
          <div className="wp-group-head">
            <h3>{g.name}</h3>
            <span className="small faint">{g.done === g.total ? 'All complete ✓' : `${g.done} of ${g.total} complete`}</span>
            <Bar percent={g.total ? Math.round(g.done / g.total * 100) : 0} label={`${g.name} complete`} />
          </div>
          <ol className="wp-list">
            {g.items.map((w) => (
              <WorkPackage key={w.id} w={w} state={state} canEdit={canEdit} edit={(field) => (value) => actions.updateWbs(w.id, field, value)}
                files={files.filter((file) => file.work_package_id === w.id)} fileActions={fileActions} onOpen={onOpen} hideNorthStar={hideNorthStar} />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
