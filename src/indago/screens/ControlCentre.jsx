import React from 'react';
import { controlSummary, weekLabel } from '../model/indago-model.mjs';
import { nextSteps } from '../model/next-steps.mjs';
import { Bar, Governs, Kpis, Pill } from './ui.jsx';

const longDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const savedNorthStarPlace = (northStar) => { try { return localStorage.getItem(`indago-ns-step:${northStar?.template?.id}`) || ''; } catch { return ''; } };
// The four measures on the main path; the rest sit under "All measures".
const HEADLINE = ['Overall completion', 'Work packages complete', 'Gates approved', 'Client findings answered'];
const ATTENTION_SHOWN = 3;

const AttentionList = ({ items }) => (
  <ul className="list">
    {items.map((a, i) => (
      <li key={`${a.id}-${i}`}>
        <span className="id">{a.id}</span>
        <span><Pill status={a.tone} /> {a.text}{a.note && <> — <i>{a.note}</i></>}</span>
      </li>
    ))}
  </ul>
);

// The Control centre leads with what to do next and the gate journey (GRE-1891).
// The full dashboard stays one click away, behind "more" toggles.
export default function ControlCentre({ state, onOpen, northStar, hideNorthStar }) {
  const s = controlSummary(state);
  const next = nextSteps(state, { northStar, savedPlace: savedNorthStarPlace(northStar), hideNorthStar });
  return (
    <>
      <Governs>Master Project Plan · live view</Governs>
      <h2 className="section-title">Where the Deep Dive stands</h2>
      {/* The next actions come before the long summary, so on a phone the first one shows without scrolling. */}
      <section className="card mb cc-next" aria-labelledby="ctl-next-h">
        <h3 id="ctl-next-h">What is next</h3>
        {next.length ? (
          <ol>
            {next.map((n, i) => (
              <li key={n.id} className={i === 0 ? 'first' : ''}>
                <span className="cc-num" aria-hidden="true">{i + 1}</span>
                <div className="cc-what">
                  <div className="cc-kicker">{n.kicker}</div>
                  <div className="cc-title">{n.title}</div>
                  <div className="cc-detail">{n.detail}</div>
                </div>
                <button type="button" className={`cc-go${i === 0 ? ' primary' : ''}`} onClick={() => onOpen(n.tab, n.jump)}>{n.go}</button>
              </li>
            ))}
          </ol>
        ) : <p className="empty">Nothing waiting. Every gate is approved.</p>}
      </section>

      <p className="lead">
        {s.done} of {s.total} work packages complete, {s.inProgress} in progress, {s.blocked} blocked. {s.gatesApproved} of {state.gates.length} gates approved
        {s.nextGate && <>; next gate is <b>{s.nextGate.id} {s.nextGate.stage}</b></>}. {s.answered} of {s.cfTotal} client findings answered.
      </p>
      {state.kickoff && <div className="note"><b>Baseline set.</b> W1 starts {longDate(state.kickoff)}. Periods now show calendar weeks.</div>}

      <section className="card mb" aria-labelledby="ctl-gates-h">
        <div className="cc-head">
          <h3 id="ctl-gates-h">Deep Dive journey</h3>
          <span className="faint small">{s.gatesApproved} of {state.gates.length} gates approved</span>
        </div>
        <ol className="gates cc-journey">
          {s.gates.map((g) => (
            <li key={g.id} className={`gate${g.approved ? ' ok' : ''}`} aria-current={s.nextGate?.id === g.id ? 'step' : undefined}>
              <div className="cc-gate-top">
                <span className="cc-dot" aria-hidden="true">{g.approved ? '✓' : g.id.slice(1)}</span>
                <span className="id">{g.id}</span>
                {s.nextGate?.id === g.id && <span className="cc-now">Next</span>}
              </div>
              <div className="st">{g.stage}</div>
              <Bar percent={g.percent} label={`${g.id} work packages complete`} />
              <div className="gate-meta">{g.count} WPs · {g.percent}%</div>
              <Pill status={g.status} />
            </li>
          ))}
        </ol>
      </section>

      <Kpis items={s.kpis.filter((k) => HEADLINE.includes(k.label))} />

      {s.attention.length > 0 && (
        <section className="card mb" aria-labelledby="ctl-attn-h">
          <h3 id="ctl-attn-h">Needs attention <span className="faint">({s.attention.length})</span></h3>
          <AttentionList items={s.attention.slice(0, ATTENTION_SHOWN)} />
          {s.attention.length > ATTENTION_SHOWN && (
            <details className="ns-more mt-sm">
              <summary>Show {s.attention.length - ATTENTION_SHOWN} more</summary>
              <AttentionList items={s.attention.slice(ATTENTION_SHOWN)} />
            </details>
          )}
        </section>
      )}

      <div className="cc-more">
        <details className="ns-more">
          <summary>All {s.kpis.length} measures</summary>
          <Kpis items={s.kpis} />
        </details>
        <details className="ns-more">
          <summary>Progress by workstream</summary>
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
        </details>
        <details className="ns-more">
          <summary>Ready to start now ({s.ready.length})</summary>
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
        </details>
        <details className="ns-more">
          <summary>Milestones ({state.ms.length})</summary>
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
        </details>
      </div>
    </>
  );
}
