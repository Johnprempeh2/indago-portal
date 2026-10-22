import React from 'react';
import { heatGrid, riskSummary } from '../model/indago-model.mjs';
import { EditSelect, EditText, Governs } from './ui.jsx';

// One risk: likelihood, impact, owner and status on the main path; the
// wording and the response behind a toggle, open for a new, empty risk (GRE-1891).
function Risk({ r, canEdit, actions }) {
  const edit = (field) => (value) => actions.updateRisk(r.id, field, value);
  const lbl = (c) => `${c} for ${r.id}`;
  const hh = r.status !== 'Closed' && r.l === 'High' && r.i === 'High';
  return (
    <li id={`risk-${r.id}`} className={`rk${hh ? ' hh' : ''}`}>
      <div className="rk-title"><span className="id">{r.id}</span> {r.risk || <span className="empty">New risk: describe it under Wording and response.</span>}</div>
      <div className="rk-fields">
        <label><span>Likelihood</span><EditSelect canEdit={canEdit} options="lmh" value={r.l} onCommit={edit('l')} label={lbl('Likelihood')} /></label>
        <label><span>Impact</span><EditSelect canEdit={canEdit} options="lmh" value={r.i} onCommit={edit('i')} label={lbl('Impact')} /></label>
        <label><span>Owner</span><EditText canEdit={canEdit} value={r.owner} onCommit={edit('owner')} label={lbl('Owner')} placeholder="Add owner" /></label>
        <label><span>Status</span><EditSelect canEdit={canEdit} options="riskStatus" value={r.status} onCommit={edit('status')} label={lbl('Status')} /></label>
      </div>
      <details className="ns-more" open={!r.risk || undefined}>
        <summary>Wording and response</summary>
        <div className="rk-text">
          <label><span>Risk / issue</span><EditText canEdit={canEdit} multiline value={r.risk} onCommit={edit('risk')} label={lbl('Risk or issue')} /></label>
          <label><span>Response / mitigation</span><EditText canEdit={canEdit} multiline value={r.resp} onCommit={edit('resp')} label={lbl('Response or mitigation')} /></label>
        </div>
      </details>
    </li>
  );
}

export default function Risks({ state, canEdit, actions }) {
  const grid = heatGrid(state.risks);
  const s = riskSummary(state.risks);
  return (
    <>
      <Governs>Master Project Plan · Risks &amp; Issues</Governs>
      <h2 className="section-title">Risks and issues</h2>
      <p className="lead">Reviewed weekly by the sponsor with gates, timetable and client burden (Toolkit §11).</p>

      <div className="rk-summary">
        <span className="ns-progress-text">
          <b>{s.open.length} open</b>
          {s.highHigh ? <> · <span className="bad-text">{s.highHigh} high × high</span></> : null}
          {s.noOwner ? <> · <span className="warn-text">{s.noOwner} without an owner</span></> : null}
          {' '}· {s.closed.length} closed
        </span>
        {canEdit
          ? <button type="button" className="btn" onClick={actions.addRisk}>Add risk</button>
          : <span className="hint">You can view risks. Ask an Editor to add or change one.</span>}
      </div>

      {!state.risks.length && <p className="empty">No risks yet.</p>}
      {s.open.length > 0 && <ol className="rk-list">{s.open.map((r) => <Risk key={r.id} r={r} canEdit={canEdit} actions={actions} />)}</ol>}
      {!s.open.length && state.risks.length > 0 && <p className="gate-state ok">✓ Every risk is closed.</p>}

      <div className="cc-more mt-sm">
        <details className="ns-more">
          <summary>Risk map: likelihood × impact</summary>
          <section className="card" aria-labelledby="heat-h">
            <h3 id="heat-h">Open risks: likelihood × impact</h3>
            <table className="heat">
              <caption className="sr-only">Open risks by likelihood (rows) and impact (columns)</caption>
              <thead><tr><td /><th scope="col">Impact low</th><th scope="col">Impact medium</th><th scope="col">Impact high</th></tr></thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.likelihood}>
                    <th scope="row">{row.likelihood}</th>
                    {row.cells.map((c) => (
                      <td key={c.impact} className={`r${c.level}`}>
                        {c.risks.map((r) => <b key={r.id} title={r.risk}>{r.id}</b>)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">Rows: likelihood. Darker cells need action first. New rows get the next R-number.</p>
          </section>
        </details>
        {s.closed.length > 0 && (
          <details className="ns-more">
            <summary>Closed ({s.closed.length})</summary>
            <ol className="rk-list">{s.closed.map((r) => <Risk key={r.id} r={r} canEdit={canEdit} actions={actions} />)}</ol>
          </details>
        )}
      </div>
    </>
  );
}
