import React from 'react';
import { Governs, Pill } from './ui.jsx';

const SimpleTable = ({ head, rows }) => (
  <div className="table-wrap auto">
    <table className="gs-table">
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, ci) => <td key={ci} className={ci === 0 ? 'id wrap' : ''}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

export default function Investigation({ state, canEdit, actions }) {
  const tk = state.toolkit;
  if (!tk) return <p className="empty">The Delivery Toolkit content has not loaded yet.</p>;
  return (
    <>
      <Governs>Delivery Toolkit v3.0 · governs the investigation</Governs>
      <h2 className="section-title">How the investigation runs</h2>
      <div className="note"><b>Mandate.</b> Validate the strategic and factual baseline; investigate all five services and their operating economics; evaluate alternative future business models, advanced technology and AI; and produce traceable, decision-grade evidence for a credible GDXP™.</div>

      <div className="grid g2 mb">
        <section className="card">
          <h3>Operating rules</h3>
          <ul className="rules">{tk.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
        <section className="card">
          <h3>Document authority and evidence hierarchy</h3>
          <SimpleTable head={['Artefact', 'Authority and use']} rows={tk.authority} />
          <p className="hint mt">The internal v2.0 register had 142 consolidated records. It is <b>not</b> the 140-record client register. Keep a separate crosswalk; never merge them or treat the 142 as the sign-off population.</p>
        </section>
      </div>

      <h3>Stages 01–06, with live work-package status</h3>
      <div className="stages">
        {tk.stages.map((s) => {
          const names = [s.ws, ...(s.extra || [])];
          const ws = state.wbs.filter((w) => names.includes(w.ws));
          const gate = state.gates.find((g) => g.id === s.g);
          return (
            <details key={s.n} className="stage">
              <summary>
                <span className="num">{s.n}</span>
                <span><span className="t">{s.t}</span><br /><span className="o">{s.o}</span></span>
                <span className="stage-gate">{s.g} {gate && <Pill status={gate.status} />}</span>
              </summary>
              <div className="body">
                <p>{s.intro}</p>
                {s.steps.length > 0 && <ul>{s.steps.map((x) => <li key={x}>{x}</li>)}</ul>}
                {s.inst.length > 0 && <p><b>Instruments:</b> {s.inst.join(', ')}</p>}
                <p className="mt-sm"><b>Work packages ({names.join(', ')}):</b></p>
                <ul className="list">
                  {ws.map((w) => <li key={w.id}><span className="id">{w.id}</span><span className="grow">{w.task}</span><Pill status={w.status} /></li>)}
                </ul>
              </div>
            </details>
          );
        })}
      </div>

      <div className="dot-divider" aria-hidden="true" />
      <div className="grid g2 mb">
        <section className="card">
          <h3>North Star workshop · 90 minutes</h3>
          <SimpleTable head={['Minutes', 'Activity', 'Record']} rows={tk.agenda} />
          <h3 className="mt">Questions to ask</h3>
          <ul className="rules">{tk.nsq.map((q) => <li key={q}>{q}</li>)}</ul>
        </section>
        <section className="card">
          <h3>AI-assisted role interviews · about 20 minutes</h3>
          <p className="hint">Context 2 min · recent real project 6 · tools and handoffs 5 · quality, time and cost 4 · exceptions and ideas 3. Get consent, confirm AI use and retention, collect no unnecessary respondent data, and send disputed or sensitive facts to human review.</p>
          <SimpleTable head={['Role', 'Focus']} rows={tk.interviews} />
        </section>
      </div>

      <h3>Instruments</h3>
      <p className="lead small-lead">Each instrument has a home in the Evidence Register, so the record of the investigation and the proof sit in one place.</p>
      <div className="inst mb">
        {tk.instruments.map((i) => (
          <div key={i.c} className="card">
            <div className="code">{i.c} · {i.g}</div>
            <div className="nm">{i.n}</div>
            <div className="f">{i.f}</div>
            <div className="meta">Recorded in: {i.home}</div>
          </div>
        ))}
      </div>

      <div className="grid g2">
        <section className="card">
          <h3>Control rhythm</h3>
          <ul className="list">{tk.rhythm.map((r) => <li key={r[0]}><span className="id wide-id">{r[0]}</span><span>{r[1]}</span></li>)}</ul>
        </section>
        <section className="card">
          <h3>First-week mobilisation checklist</h3>
          <ul className="chk">
            {tk.checklist.map((c, i) => (
              <li key={c} className={state.check[i] ? 'done' : ''}>
                <input type="checkbox" id={`ck${i}`} checked={!!state.check[i]} disabled={!canEdit} onChange={(e) => actions.setCheck(i, e.target.checked)} />
                <label htmlFor={`ck${i}`}>{c}</label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
