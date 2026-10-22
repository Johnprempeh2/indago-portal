import React, { useState } from 'react';
import { focusGate, gateProgress } from '../model/indago-model.mjs';
import { Bar, EditSelect, EditText, Governs, Pill } from './ui.jsx';

const approved = (g) => g.status.startsWith('Approved');

// One gate at a time, with the six gates as a journey above it (GRE-1891).
// A "What is next" button can ask for a gate: jump.focus = "gate-card-G3".
export default function Gates({ state, canEdit, actions, northStar, onOpen, jump }) {
  const stages = state.toolkit?.stages || [];
  const [current, setCurrent] = useState(() => focusGate(state, String(jump?.focus || '').replace('gate-card-', '')));
  const i = Math.max(0, state.gates.findIndex((g) => g.id === current));
  const g = state.gates[i];
  const prev = state.gates[i - 1];
  const next = state.gates[i + 1];
  const achieved = state.ms.filter((m) => m.status === 'Achieved').length;

  const gateCard = () => {
    if (!g) return <p className="empty">No gates yet.</p>;
    const st = stages.find((s) => s.g === g.id) || stages[i] || {};
    const p = gateProgress(state, g.id);
    const done = p.workPackages.filter((w) => w.status === 'Complete').length;
    const edit = (field) => (value) => actions.updateGate(g.id, field, value);
    return (
      <section id={`gate-card-${g.id}`} className={`card mb gate-card${approved(g) ? ' ok' : ''}`} aria-labelledby={`gate-${g.id}`}>
        <div className="gate-main">
          <div className="section-label">{g.id}{st.n && ` · Stage ${st.n}`} · Gate {i + 1} of {state.gates.length}</div>
          <h3 id={`gate-${g.id}`} className="gate-title">{g.stage}</h3>
          {approved(g)
            ? <p className="gate-state ok">✓ {g.status}{g.date && ` on ${g.date}`}. Findings from this stage can be relied on.</p>
            : <p className="gate-state">{p.count && done === p.count ? 'Every work package is complete. Ready for the gate decision.' : `${p.count - done} of ${p.count} work packages still open.`}</p>}
          <div className="gate-bar"><Bar percent={p.percent} label={`${g.id} work packages complete`} /><span className="small faint">{p.percent}%</span></div>
          <p className="small faint">{p.workPackages.map((w) => <Pill key={w.id} status={w.status}>{w.id}</Pill>)}</p>
          <p className="muted"><b>Acceptance evidence:</b> {g.accept}</p>
          {g.id === 'G2' && ['Approved', 'Approved with exceptions'].includes(northStar?.fields?.['approval.status']) &&
            <p className="muted"><b>North Star evidence:</b> <button className="link-button" onClick={() => onOpen('north-star')}>IND-NS-001</button>. Gate decision remains a separate human action.</p>}
          <details className="ns-more mt-sm">
            <summary>More about this gate</summary>
            {st.o && <p><b>Toolkit output:</b> {st.o}</p>}
            <p><b>Owner:</b> {g.owner}</p>
          </details>
        </div>
        <div className="gate-form">
          <label>Gate decision <EditSelect canEdit={canEdit} options="gateStatus" value={g.status} onCommit={edit('status')} label={`Gate decision for ${g.id}`} /></label>
          <label>Decision date <EditText canEdit={canEdit} type="date" value={g.date} onCommit={edit('date')} label={`Decision date for ${g.id}`} /></label>
          <label>Exception / approval note <EditText canEdit={canEdit} multiline value={g.exc} onCommit={edit('exc')} label={`Exception or approval note for ${g.id}`} /></label>
        </div>
        <div className="gate-nav">
          {prev ? <button type="button" className="cc-go" onClick={() => setCurrent(prev.id)}>← {prev.id}</button> : <span />}
          {next && <button type="button" className="cc-go primary" onClick={() => setCurrent(next.id)}>{next.id} {next.stage} →</button>}
        </div>
      </section>
    );
  };

  return (
    <>
      <Governs>Master Project Plan · Stage Gates &amp; Milestones · criteria from the Toolkit</Governs>
      <h2 className="section-title">Gates and milestones</h2>
      <p className="lead">Six gates, one at a time. A gate approves <b>reliance on findings</b>.</p>
      <details className="ns-more mb">
        <summary>How gates work</summary>
        <p>Gates control <b>reliance on findings</b>, not whether parallel work may start (Toolkit §3). Open evidence may stay open if it is disclosed and no material recommendation depends on it.</p>
      </details>

      <ol className="gt-steps" aria-label="Gates">
        {state.gates.map((x) => (
          <li key={x.id}>
            <button type="button" className={`gt-step${approved(x) ? ' ok' : ''}`} aria-pressed={x.id === g?.id} onClick={() => setCurrent(x.id)}>
              <span className="cc-dot" aria-hidden="true">{approved(x) ? '✓' : x.id.slice(1)}</span>
              <span className="gt-step-text"><b>{x.id}</b> <span className="gt-step-stage">{x.stage}</span></span>
              <span className="sr-only">, {x.status}</span>
            </button>
          </li>
        ))}
      </ol>

      {gateCard()}

      <details className="ns-more mt-lg gt-milestones">
        <summary>Milestones · {achieved} of {state.ms.length} achieved</summary>
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
      </details>
    </>
  );
}
