import React from 'react';
import { heatGrid } from '../model/indago-model.mjs';
import { EditSelect, EditText, Governs } from './ui.jsx';

export default function Risks({ state, canEdit, actions }) {
  const grid = heatGrid(state.risks);
  return (
    <>
      <Governs>Master Project Plan · Risks &amp; Issues</Governs>
      <h2 className="section-title">Risks and issues</h2>
      <p className="lead">Reviewed weekly by the sponsor with gates, timetable and client burden (Toolkit §11).</p>

      <div className="grid g2 mb">
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
          <p className="hint">Rows: likelihood. Darker cells need action first.</p>
        </section>
        <section className="card" aria-labelledby="add-risk-h">
          <h3 id="add-risk-h">Add a risk or issue</h3>
          {canEdit ? (
            <>
              <p className="hint">New rows get the next R-number. Edit any field in the table below.</p>
              <button type="button" className="btn" onClick={actions.addRisk}>Add risk</button>
            </>
          ) : <p className="hint">You can view risks. Ask an Editor to add or change one.</p>}
        </section>
      </div>

      <div className="table-wrap">
        <table className="gs-table stack">
          <thead><tr><th scope="col">ID</th><th scope="col">Risk / issue</th><th scope="col">Likelihood</th><th scope="col">Impact</th><th scope="col">Owner</th><th scope="col">Response / mitigation</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {!state.risks.length && <tr><td colSpan={7} className="empty">No risks yet.</td></tr>}
            {state.risks.map((r) => {
              const edit = (field) => (value) => actions.updateRisk(r.id, field, value);
              const lbl = (c) => `${c} for ${r.id}`;
              return (
                <tr key={r.id}>
                  <td className="id" data-label="ID">{r.id}</td>
                  <td className="wide" data-label="Risk / issue"><EditText canEdit={canEdit} multiline value={r.risk} onCommit={edit('risk')} label={lbl('Risk or issue')} /></td>
                  <td data-label="Likelihood"><EditSelect canEdit={canEdit} options="lmh" value={r.l} onCommit={edit('l')} label={lbl('Likelihood')} /></td>
                  <td data-label="Impact"><EditSelect canEdit={canEdit} options="lmh" value={r.i} onCommit={edit('i')} label={lbl('Impact')} /></td>
                  <td data-label="Owner"><EditText canEdit={canEdit} value={r.owner} onCommit={edit('owner')} label={lbl('Owner')} /></td>
                  <td className="wide" data-label="Response"><EditText canEdit={canEdit} multiline value={r.resp} onCommit={edit('resp')} label={lbl('Response or mitigation')} /></td>
                  <td data-label="Status"><EditSelect canEdit={canEdit} options="riskStatus" value={r.status} onCommit={edit('status')} label={lbl('Status')} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
