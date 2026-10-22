import React from 'react';
import { gateProgress } from '../model/indago-model.mjs';
import { Bar, EditSelect, EditText, Governs, Pill } from './ui.jsx';

export default function Gates({ state, canEdit, actions, northStar, onOpen }) {
  const stages = state.toolkit?.stages || [];
  return (
    <>
      <Governs>Master Project Plan · Stage Gates &amp; Milestones · criteria from the Toolkit</Governs>
      <h2 className="section-title">Gates and milestones</h2>
      <p className="lead">Gates control <b>reliance on findings</b>, not whether parallel work may start (Toolkit §3). Open evidence may stay open if it is disclosed and no material recommendation depends on it.</p>

      {state.gates.map((g, i) => {
        const st = stages.find((s) => s.g === g.id) || stages[i] || {};
        const p = gateProgress(state, g.id);
        const edit = (field) => (value) => actions.updateGate(g.id, field, value);
        return (
          <section key={g.id} id={`gate-card-${g.id}`} className={`card mb gate-card${g.status.startsWith('Approved') ? ' ok' : ''}`} aria-labelledby={`gate-${g.id}`}>
            <div className="gate-main">
              <div className="section-label">{g.id}{st.n && ` · Stage ${st.n}`}</div>
              <h3 id={`gate-${g.id}`} className="gate-title">{g.stage}</h3>
              <p className="muted"><b>Acceptance evidence:</b> {g.accept}</p>
              {g.id === 'G2' && ['Approved', 'Approved with exceptions'].includes(northStar?.fields?.['approval.status']) &&
                <p className="muted"><b>North Star evidence:</b> <button className="link-button" onClick={() => onOpen('north-star')}>IND-NS-001</button>. Gate decision remains a separate human action.</p>}
              {st.o && <p className="muted"><b>Toolkit output:</b> {st.o}</p>}
              <p className="small faint">Owner: {g.owner} · {p.count} work packages:{' '}
                {p.workPackages.map((w) => <Pill key={w.id} status={w.status}>{w.id}</Pill>)}
              </p>
              <div className="gate-bar"><Bar percent={p.percent} label={`${g.id} work packages complete`} /><span className="small faint">{p.percent}%</span></div>
            </div>
            <div className="gate-form">
              <label>Gate decision <EditSelect canEdit={canEdit} options="gateStatus" value={g.status} onCommit={edit('status')} label={`Gate decision for ${g.id}`} /></label>
              <label>Decision date <EditText canEdit={canEdit} type="date" value={g.date} onCommit={edit('date')} label={`Decision date for ${g.id}`} /></label>
              <label>Exception / approval note <EditText canEdit={canEdit} multiline value={g.exc} onCommit={edit('exc')} label={`Exception or approval note for ${g.id}`} /></label>
            </div>
          </section>
        );
      })}

      <h3 className="mt-lg">Milestones</h3>
      <div className="table-wrap">
        <table className="gs-table stack">
          <thead><tr><th scope="col">Milestone</th><th scope="col">Period</th><th scope="col">Prerequisite</th><th scope="col">Client decision / output</th><th scope="col">Status</th><th scope="col">Actual date</th></tr></thead>
          <tbody>
            {state.ms.map((m) => {
              const edit = (field) => (value) => actions.updateMilestone(m.name, field, value);
              return (
                <tr key={m.name}>
                  <td className="id" data-label="Milestone">{m.name}</td>
                  <td data-label="Period">{m.period}</td>
                  <td data-label="Prerequisite">{m.pre}</td>
                  <td data-label="Output">{m.out}</td>
                  <td data-label="Status"><EditSelect canEdit={canEdit} options="msStatus" value={m.status} onCommit={edit('status')} label={`Status for ${m.name}`} /></td>
                  <td data-label="Actual date"><EditText canEdit={canEdit} type="date" value={m.date} onCommit={edit('date')} label={`Actual date for ${m.name}`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
