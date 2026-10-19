import React from 'react';
import { controlSummary, weekLabel } from '../model/indago-model.mjs';
import { Bar, Governs, Kpis, Pill } from './ui.jsx';

const longDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

export default function ControlCentre({ state, onOpen }) {
  const s = controlSummary(state);
  return (
    <>
      <Governs>Master Project Plan · live view</Governs>
      <h2 className="section-title">Where the Deep Dive stands</h2>
      <p className="lead">
        {s.done} of {s.total} work packages complete, {s.inProgress} in progress, {s.blocked} blocked. {s.gatesApproved} of {state.gates.length} gates approved
        {s.nextGate && <>; next gate is <b>{s.nextGate.id} {s.nextGate.stage}</b></>}. {s.answered} of {s.cfTotal} client findings answered.
      </p>
      {state.kickoff ? (
        <div className="note"><b>Baseline set.</b> W1 starts {longDate(state.kickoff)}. Periods now show calendar weeks.</div>
      ) : (
        <div className="note warn">
          <b>No baseline dates yet.</b> W1–W4 are planning assumptions, not commitments.{' '}
          <button type="button" className="linkish" onClick={() => onOpen('plan')}>Set the agreed W1 start date in the Work plan</button> after kick-off.
        </div>
      )}
      <Kpis items={s.kpis} />

      <section className="card mb" aria-labelledby="ctl-gates-h">
        <h3 id="ctl-gates-h">Approval gates</h3>
        <ul className="gates">
          {s.gates.map((g) => (
            <li key={g.id} className={`gate${g.approved ? ' ok' : ''}`}>
              <div className="id">{g.id}</div>
              <div className="st">{g.stage}</div>
              <Bar percent={g.percent} label={`${g.id} work packages complete`} />
              <div className="gate-meta">{g.count} WPs · {g.percent}%</div>
              <Pill status={g.status} />
            </li>
          ))}
        </ul>
      </section>

      <div className="grid g2 mb">
        <section className="card" aria-labelledby="ctl-ws-h">
          <h3 id="ctl-ws-h">Progress by workstream</h3>
          {s.workstreams.map((w) => (
            <div key={w.name} className="row-bar">
              <span className="n">{w.name} <span className="faint">({w.count})</span></span>
              <Bar percent={w.percent} label={`${w.name} progress`} />
              <span className="p">{w.percent}%</span>
            </div>
          ))}
        </section>
        <section className="card" aria-labelledby="ctl-attn-h">
          <h3 id="ctl-attn-h">Needs attention</h3>
          {s.attention.length ? (
            <ul className="list">
              {s.attention.map((a, i) => (
                <li key={`${a.id}-${i}`}>
                  <span className="id">{a.id}</span>
                  <span><Pill status={a.tone} /> {a.text}{a.note && <> — <i>{a.note}</i></>}</span>
                </li>
              ))}
            </ul>
          ) : <p className="empty">Nothing blocked or at risk.</p>}
        </section>
      </div>

      <div className="grid g2">
        <section className="card" aria-labelledby="ctl-ready-h">
          <h3 id="ctl-ready-h">Ready to start now</h3>
          <p className="hint">Not started, and every dependency is complete.</p>
          <ul className="list">
            {s.ready.length ? s.ready.map((w) => (
              <li key={w.id}>
                <span className="id">{w.id}</span>
                <span>{w.task} <span className="faint">· {w.person || w.role} · {weekLabel(state.kickoff, w.start)}</span></span>
              </li>
            )) : <li className="empty">No work package is ready.</li>}
          </ul>
        </section>
        <section className="card" aria-labelledby="ctl-ms-h">
          <h3 id="ctl-ms-h">Milestones</h3>
          <ul className="list">
            {state.ms.map((m) => (
              <li key={m.name}>
                <span className="id wide-id">{state.kickoff ? weekLabel(state.kickoff, m.period.split('–')[0]) : m.period}</span>
                <span className="grow">{m.name}<br /><span className="small faint">{m.out}</span></span>
                <Pill status={m.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
