import React, { useState } from 'react';
import { focusStage } from '../model/indago-model.mjs';
import { Bar, Governs, Pill } from './ui.jsx';

const SimpleTable = ({ head, rows }) => (
  <div className="table-wrap auto">
    <table className="gs-table">
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, ci) => <td key={ci} className={ci === 0 ? 'id wrap' : ''}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

const approved = (g) => !!g && g.status.startsWith('Approved');

// The investigation one stage at a time, with the first-week checklist
// first and the Toolkit reference behind "+" toggles (GRE-1891). The method
// detail and the Toolkit reference are for facilitators only (GRE-1942).
export default function Investigation({ state, canEdit, actions, facilitator = false }) {
  const tk = state.toolkit;
  const [current, setCurrent] = useState(() => focusStage(state));
  if (!tk) return <p className="empty">The Delivery Toolkit content has not loaded yet.</p>;
  const i = Math.max(0, tk.stages.findIndex((s) => s.n === current));
  const s = tk.stages[i];
  const prev = tk.stages[i - 1];
  const next = tk.stages[i + 1];
  const gate = s && state.gates.find((g) => g.id === s.g);
  const checked = tk.checklist.filter((_, n) => state.check[n]).length;
  const ready = checked === tk.checklist.length;

  const stageCard = () => {
    if (!s) return <p className="empty">No stages yet.</p>;
    const names = [s.ws, ...(s.extra || [])];
    const ws = state.wbs.filter((w) => names.includes(w.ws));
    const done = ws.filter((w) => w.status === 'Complete').length;
    return (
      <section id={`stage-${s.n}`} className={`card mb iv-stage${approved(gate) ? ' ok' : ''}`} aria-labelledby={`stage-h-${s.n}`}>
        <div className="section-label">Stage {s.n} · {i + 1} of {tk.stages.length} · {s.g} {gate && <Pill status={gate.status} />}</div>
        <h3 id={`stage-h-${s.n}`} className="gate-title">{s.t}</h3>
        <p className="muted">{s.o}</p>
        {approved(gate)
          ? <p className="gate-state ok">✓ {s.g} {gate.status.toLowerCase()}. This stage is done.</p>
          : <p className="gate-state">{ws.length && done === ws.length ? `Every work package is complete. ${s.g} can be decided.` : `${ws.length - done} of ${ws.length} work packages still open.`}</p>}
        <div className="gate-bar"><Bar percent={ws.length ? Math.round(done / ws.length * 100) : 0} label={`Stage ${s.n} work packages complete`} /><span className="small faint">{done} of {ws.length}</span></div>
        <ul className="list mt-sm">
          {ws.map((w) => <li key={w.id}><span className="id">{w.id}</span><span className="grow">{w.task}</span><Pill status={w.status} /></li>)}
        </ul>
        {facilitator && <details className="ns-more mt-sm">
          <summary>How this stage runs</summary>
          <p>{s.intro}</p>
          {s.steps.length > 0 && <ul className="iv-steps">{s.steps.map((x) => <li key={x}>{x}</li>)}</ul>}
          {s.inst.length > 0 && <p><b>Instruments:</b> {s.inst.join(', ')}</p>}
          <p><b>Work packages:</b> {names.join(', ')}</p>
        </details>}
        <div className="gate-nav">
          {prev ? <button type="button" className="cc-go" onClick={() => setCurrent(prev.n)}>← Stage {prev.n}</button> : <span />}
          {next && <button type="button" className="cc-go primary" onClick={() => setCurrent(next.n)}>Stage {next.n} →</button>}
        </div>
      </section>
    );
  };

  return (
    <>
      <Governs>Delivery Toolkit v3.0 · governs the investigation</Governs>
      <h2 className="section-title">How the investigation runs</h2>
      <p className="lead">Six stages, one at a time. Each stage ends at a gate.{facilitator && <> The Toolkit detail is behind the <b>+</b> buttons.</>}</p>

      <section className={`card mb iv-check${ready ? ' ok' : ''}`} aria-labelledby="iv-check-h">
        <div className="cc-head">
          <h3 id="iv-check-h">First week: mobilisation</h3>
          <span className="ns-progress-text"><b>{checked} of {tk.checklist.length}</b> done{ready && <span className="ok-text"> ✓</span>}</span>
        </div>
        <Bar percent={tk.checklist.length ? Math.round(checked / tk.checklist.length * 100) : 0} label="First-week checklist done" />
        {ready && <p className="gate-state ok mt-sm">✓ The first week is set up.</p>}
        <details className="ns-more mt-sm" open={!ready || undefined}>
          <summary>Checklist</summary>
          <ul className="chk">
            {tk.checklist.map((c, n) => (
              <li key={c} className={state.check[n] ? 'done' : ''}>
                <input type="checkbox" id={`ck${n}`} checked={!!state.check[n]} disabled={!canEdit} onChange={(e) => actions.setCheck(n, e.target.checked)} />
                <label htmlFor={`ck${n}`}>{c}</label>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {s && (
        <p className="gt-current">
          <b>Stage {s.n}: {s.t}</b>
          <span>{s.g} {gate && <Pill status={gate.status} />}</span>
        </p>
      )}
      <ol className="gt-steps" aria-label="Stages">
        {tk.stages.map((x) => {
          const ok = approved(state.gates.find((g) => g.id === x.g));
          return (
            <li key={x.n}>
              <button type="button" className={`gt-step${ok ? ' ok' : ''}`} aria-pressed={x.n === s?.n} onClick={() => setCurrent(x.n)}>
                <span className="cc-dot" aria-hidden="true">{ok ? '✓' : Number(x.n)}</span>
                <span className="gt-step-text"><b>Stage {x.n}</b> <span className="gt-step-stage">{x.g}</span></span>
                <span className="sr-only">{ok ? ', done' : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {stageCard()}

      {facilitator && <div className="cc-more mt-lg">
        <details className="ns-more">
          <summary>Mandate and operating rules</summary>
          <section className="card">
            <p className="muted"><b>Mandate.</b> Validate the strategic and factual baseline; investigate all five services and their operating economics; evaluate alternative future business models, advanced technology and AI; and produce traceable, decision-grade evidence for a credible GDXP™.</p>
            <h3 className="mt-sm">Operating rules</h3>
            <ul className="rules">{tk.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>
        </details>
        <details className="ns-more">
          <summary>Document authority</summary>
          <section className="card">
            <SimpleTable head={['Artefact', 'Authority and use']} rows={tk.authority} />
            <p className="hint mt">The internal v2.0 register had 142 consolidated records. It is <b>not</b> the 140-record client register. Keep a separate crosswalk; never merge them or treat the 142 as the sign-off population.</p>
          </section>
        </details>
        <details className="ns-more">
          <summary>North Star workshop · 90 minutes</summary>
          <section className="card">
            <SimpleTable head={['Minutes', 'Activity', 'Record']} rows={tk.agenda} />
            <h3 className="mt">Questions to ask</h3>
            <ul className="rules">{tk.nsq.map((q) => <li key={q}>{q}</li>)}</ul>
          </section>
        </details>
        <details className="ns-more">
          <summary>Role interviews · about 20 minutes</summary>
          <section className="card">
            <p className="hint">Context 2 min · recent real project 6 · tools and handoffs 5 · quality, time and cost 4 · exceptions and ideas 3. Get consent, confirm AI use and retention, collect no unnecessary respondent data, and send disputed or sensitive facts to human review.</p>
            <SimpleTable head={['Role', 'Focus']} rows={tk.interviews} />
          </section>
        </details>
        <details className="ns-more">
          <summary>Instruments ({tk.instruments.length})</summary>
          <p className="hint">Each instrument has a home in the Evidence Register, so the record of the investigation and the proof sit in one place.</p>
          <div className="inst">
            {tk.instruments.map((x) => (
              <div key={x.c} className="card">
                <div className="code">{x.c} · {x.g}</div>
                <div className="nm">{x.n}</div>
                <div className="f">{x.f}</div>
                <div className="meta">Recorded in: {x.home}</div>
              </div>
            ))}
          </div>
        </details>
        <details className="ns-more">
          <summary>Control rhythm</summary>
          <section className="card">
            <ul className="list">{tk.rhythm.map((r) => <li key={r[0]}><span className="id wide-id">{r[0]}</span><span>{r[1]}</span></li>)}</ul>
          </section>
        </details>
      </div>}
    </>
  );
}
