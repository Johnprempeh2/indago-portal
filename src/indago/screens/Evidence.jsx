import React, { useEffect, useState } from 'react';
import { REG } from '../model/options.mjs';
import { calcCell, filterRegRows, regCardLayout, regFilterOptions, regProgress } from '../model/indago-model.mjs';
import { Bar, EditSelect, EditText, FilterSelect, Governs, Pill, TabList } from './ui.jsx';

const CLASS_TONE = { differ: 'warn', confirm: 'prog' };
const PAGE = 10;

// One register value: read-only for the client's locked columns and the
// calculated ones, otherwise the input that fits the column.
function Field({ sheet, cfg, row, ci, col, canEdit, onCommit, onOpen }) {
  const v = row[ci] || '';
  const label = `${col} for ${row[0]}`;
  if (ci === 6 && sheet === 'North Star Requests') return <button type="button" className="link-button" onClick={() => onOpen('north-star')}>{v}</button>;
  if (cfg.calc && cfg.calc[ci]) return <span className="calc">{calcCell(cfg.calc[ci], row) || <span className="empty">auto</span>}</span>;
  if ((cfg.lock || []).includes(ci)) {
    if (ci === 2 && sheet === 'Client Findings') return <Pill tone={CLASS_TONE[v] || 'mute'}>{v}</Pill>;
    return <span className="locked">{v || <span className="empty">—</span>}</span>;
  }
  if (cfg.sel && cfg.sel[ci]) return <EditSelect canEdit={canEdit} options={cfg.sel[ci]} value={v} onCommit={onCommit} label={label} />;
  if ((cfg.date || []).includes(ci)) return <EditText canEdit={canEdit} type="date" value={v} onCommit={onCommit} label={label} />;
  if ((cfg.wide || []).includes(ci)) return <EditText canEdit={canEdit} multiline value={v} onCommit={onCommit} label={label} />;
  return <EditText canEdit={canEdit} value={v} onCommit={onCommit} label={label} inputMode={(cfg.num || []).includes(ci) ? 'decimal' : undefined} />;
}

// One register row as a card: the client's record on top, up to three
// choices on the main path, every other column behind "Details" (GRE-1891).
function RegCard({ sheet, cfg, cols, row, layout, canEdit, onCommit, onOpen, open }) {
  const field = (ci) => <Field sheet={sheet} cfg={cfg} row={row} ci={ci} col={cols[ci]} canEdit={canEdit} onCommit={(v) => onCommit(ci, v)} onOpen={onOpen} />;
  const meta = layout.facts.length ? layout.facts : layout.title !== 1 && row[1] ? [1] : [];
  return (
    <li id={`evidence-${row[0]}`} className="ev">
      <div className="ev-title"><span className="id">{row[0]}</span> {row[layout.title] || <span className="empty">New row: add the details below.</span>}</div>
      {meta.length > 0 && <div className="ev-meta">{meta.map((ci) => <span key={ci}>{field(ci)}</span>)}</div>}
      {layout.quick.length > 0 && (
        <div className="rk-fields ev-fields">
          {layout.quick.map((ci) => <label key={ci}><span>{cols[ci]}</span>{field(ci)}</label>)}
        </div>
      )}
      {layout.details.length > 0 && (
        <details className="ns-more" open={open || undefined}>
          <summary>Details</summary>
          <dl className="wp-fields">
            {layout.details.map((ci) => (
              <div key={ci} className={(cfg.wide || []).includes(ci) ? 'wide' : ''}><dt>{cols[ci]}</dt><dd>{field(ci)}</dd></div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

export default function Evidence({ state, canEdit, actions, evidenceJump, onOpen }) {
  const sheets = Object.keys(REG).filter((k) => state.reg[k]);
  const [cur, setCur] = useState(sheets[0]);
  const [filters, setFilters] = useState({});
  const [shown, setShown] = useState(PAGE);
  const [added, setAdded] = useState(false);
  const cfg = REG[cur];
  const R = state.reg[cur];
  const cols = R.cols || [];
  const F = filters[cur] || { q: '' };
  const setF = (patch) => { setFilters((x) => ({ ...x, [cur]: { ...F, ...patch } })); setShown(PAGE); };
  const select = (k) => { setCur(k); setShown(PAGE); setAdded(false); };
  const rows = filterRegRows(cur, R.rows, F);
  const layout = regCardLayout(cur, cols);
  const progress = regProgress(cur, R.rows);
  const tabs = sheets.map((k) => ({ id: k, label: REG[k].label, count: state.reg[k].rows.length }));
  // A jump from another screen must land on a row that is shown.
  const jumpAt = evidenceJump ? rows.findIndex(({ row }) => row[0] === evidenceJump) : -1;
  const limit = added ? rows.length : Math.max(shown, jumpAt + 1);
  useEffect(() => {
    if (!evidenceJump) return;
    const found = sheets.find(name => state.reg[name].rows.some(row => row[0] === evidenceJump));
    if (found) setCur(found);
  }, [evidenceJump]);
  useEffect(() => {
    if (!evidenceJump) return;
    const target = document.getElementById(`evidence-${evidenceJump}`);
    target?.scrollIntoView({ block: 'center' });
  }, [evidenceJump, cur]);

  return (
    <>
      <Governs>Evidence &amp; Transformation Control Register · governs factual traceability</Governs>
      <h2 className="section-title">Evidence register</h2>
      <p className="lead">One register at a time. Record the answer and how it was checked. Open <b>Details</b> for the rest of the row.</p>
      <details className="ns-more mb">
        <summary>Rules for the client's IDs</summary>
        <p>IND-EV-001…140 and IND-RQ-01…31 are the client's IDs: never renumber them, and never change the original statement or classification. A client answer is an attestation, not proof: record the client answer and the verification status separately. Do not enter inferred figures as verified.</p>
      </details>

      <TabList tabs={tabs} current={cur} onSelect={select} label="Register sheets" className="subtabs" tabClass="subtab" idPrefix="reg" />

      <div id="reg-panel" role="tabpanel" aria-labelledby={`reg-tab-${cur}`}>
        {progress && progress.total > 0 && (
          <div className="wp-progress ev-progress" aria-label={`${cfg.label} progress`}>
            <span className="ns-progress-text">
              {progress.answered != null && <><b>{progress.answered} of {progress.total}</b> answered · </>}
              <b>{progress.done} of {progress.total}</b> {progress.word}
              {progress.done === progress.total && <span className="ok-text"> ✓</span>}
            </span>
            <Bar percent={progress.percent} label={`${cfg.label} ${progress.word}`} />
          </div>
        )}
        {cfg.lock && <p className="hint">The title of each row and the facts under it are the client's source record and cannot be edited.{cur === 'Client Findings' && " The client's answer and Greatstone's verification are separate fields on purpose."}</p>}
        <div className="toolbar">
          <input type="search" value={F.q} onChange={(e) => setF({ q: e.target.value })} placeholder={`Search ${cfg.label.toLowerCase()}`} aria-label={`Search ${cfg.label.toLowerCase()}`} />
          {(cfg.filters || []).map((ci) => (
            <FilterSelect key={ci} value={F[ci] || ''} onChange={(v) => setF({ [ci]: v })} all={`${cols[ci]}: all`} options={regFilterOptions(cur, R.rows, ci)} label={cols[ci]} />
          ))}
          {canEdit && !cfg.noAdd && <button type="button" className="btn small" onClick={() => { setF({ q: '' }); setAdded(true); actions.addRegRow(cur); }}>Add row</button>}
          <span className="count" aria-live="polite">{rows.length} of {R.rows.length} rows</span>
        </div>

        {!rows.length && (
          <p className="empty">{R.rows.length ? 'No rows match the filter.' : canEdit && !cfg.noAdd ? 'No rows yet. Use “Add row” when the first record arrives.' : 'No rows yet.'}</p>
        )}
        <ol className="rk-list ev-list">
          {rows.slice(0, limit).map(({ row }, n) => (
            <RegCard key={row[0]} sheet={cur} cfg={cfg} cols={cols} row={row} layout={layout} canEdit={canEdit} onOpen={onOpen}
              open={(added && n === rows.length - 1) || !row[layout.title]}
              onCommit={(ci, v) => actions.updateRegCell(cur, row[0], ci, v)} />
          ))}
        </ol>
        {rows.length > limit && (
          <div className="ev-more">
            <button type="button" className="cc-go" onClick={() => setShown(limit + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>
            <span className="small faint">{limit} of {rows.length} shown</span>
          </div>
        )}
      </div>
    </>
  );
}
