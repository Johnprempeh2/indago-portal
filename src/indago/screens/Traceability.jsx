import React, { useState } from 'react';
import { lookup, traceSummary } from '../model/indago-model.mjs';
import { Bar, Governs, Kpis, Pill } from './ui.jsx';

const CHAIN = [['North Star objective', 'NS-01 · G2'], ['Source', 'IND-EV / IND-DD'], ['Finding', 'IND-F'], ['Opportunity', 'IND-OP'], ['Design option', 'Routes A–D'], ['Commercial assumption', 'IND-CM'], ['Roadmap', 'IND-GDXP'], ['KPI', 'NS-01 / GDXP']];

// The chain, one progress line and the ID look-up on the main path; the
// measures and breakdowns behind "+" toggles (GRE-1891).
export default function Traceability({ state }) {
  const [q, setQ] = useState('');
  const t = traceSummary(state);
  const found = lookup(state, q);
  return (
    <>
      <Governs>Evidence &amp; Transformation Control Register · governs design traceability</Governs>
      <h2 className="section-title">From North Star to KPI</h2>
      <p className="lead">Every material recommendation must trace the full chain (Toolkit §2). The GDXP™ readiness gate (G6) needs this audit to pass.</p>

      <ol className="chain" aria-label="Traceability chain">
        {CHAIN.map(([name, code], i) => (
          <li key={name} className={`s${i === 0 || i === CHAIN.length - 1 ? ' k' : ''}`}><span className="chain-n" aria-hidden="true">{i + 1}</span><small>{code}</small>{name}</li>
        ))}
      </ol>
      <div className="wp-progress tr-progress" aria-label="Traceability progress">
        <span className="ns-progress-text"><b>{t.full} of {t.rows}</b> GDXP™ rows have the full chain{t.rows > 0 && t.full === t.rows && <span className="ok-text"> ✓</span>}</span>
        <Bar percent={t.rows ? Math.round(t.full / t.rows * 100) : 0} label="GDXP rows with the full chain" />
      </div>

      <section className="card mb">
        <h3><label htmlFor="lookup">Look up any ID</label></h3>
        <p className="hint">Type an ID such as IND-EV-122, IND-RQ-31, IND-F-001 or 3.08 to see where it is used.</p>
        <div className="toolbar"><input id="lookup" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="IND-EV-122" /></div>
        <div aria-live="polite">
          {found.active && (found.hits.length ? (
            <>
              <ul className="list">
                {found.hits.map((h, i) => (
                  <li key={i}>
                    <span className="id wide-id">{h.id}</span>
                    <span>{h.where}{h.field && <> · <b>{h.field}</b></>}: {h.text} {h.status && <Pill status={h.status} />}</span>
                  </li>
                ))}
              </ul>
              {found.more > 0 && <p className="hint">{found.more} more not shown.</p>}
            </>
          ) : <p className="empty">Not found.</p>)}
        </div>
      </section>

      <div className="cc-more">
        <details className="ns-more">
          <summary>All traceability measures</summary>
          <Kpis items={t.kpis} />
        </details>
        <details className="ns-more">
          <summary>Client findings by business area</summary>
          <section className="card">
            {t.areas.length ? t.areas.map((a) => (
              <div key={a.name} className="row-bar">
                <span className="n">{a.name} <span className="faint">({a.total})</span></span>
                <Bar percent={a.percent} label={`${a.name}: corroborated or client-validated`} />
                <span className="p">{a.ok}/{a.total}</span>
              </div>
            )) : <p className="empty">No client findings loaded.</p>}
            <p className="hint mt-sm">Bar = corroborated or client-validated.</p>
          </section>
        </details>
        <details className="ns-more">
          <summary>Source classification vs verification</summary>
          <section className="card">
            <div className="table-wrap auto">
              <table className="gs-table">
                <thead><tr><th scope="col">Classification</th>{t.verif.map((v) => <th key={v} scope="col">{v}</th>)}</tr></thead>
                <tbody>
                  {t.matrix.map((m) => (
                    <tr key={m.cls}>
                      <th scope="row" className="id">{m.cls}</th>
                      {m.counts.map((n, i) => <td key={i} className="calc">{n || <span className="empty">0</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </details>
      </div>
    </>
  );
}
