import React, { useState } from 'react';
import { REG } from '../model/options.mjs';
import { calcCell, filterRegRows, regFilterOptions } from '../model/indago-model.mjs';
import { EditSelect, EditText, FilterSelect, Governs, Pill, TabList } from './ui.jsx';

const CLASS_TONE = { differ: 'warn', confirm: 'prog' };

function Cell({ sheet, cfg, row, ci, col, canEdit, onCommit }) {
  const v = row[ci] || '';
  const label = `${col} for ${row[0]}`;
  const wide = (cfg.wide || []).includes(ci);
  if (ci === 0) return <td className="id" data-label={col}>{v}</td>;
  if (cfg.calc && cfg.calc[ci]) return <td className="calc" data-label={col}>{calcCell(cfg.calc[ci], row) || <span className="empty">auto</span>}</td>;
  if ((cfg.lock || []).includes(ci)) {
    const body = ci === 2 && sheet === 'Client Findings' ? <Pill tone={CLASS_TONE[v] || 'mute'}>{v}</Pill> : v;
    return <td className={`locked${wide ? ' wide' : ''}`} data-label={col}>{body}</td>;
  }
  if (cfg.sel && cfg.sel[ci]) return <td data-label={col}><EditSelect canEdit={canEdit} options={cfg.sel[ci]} value={v} onCommit={onCommit} label={label} /></td>;
  if ((cfg.date || []).includes(ci)) return <td data-label={col}><EditText canEdit={canEdit} type="date" value={v} onCommit={onCommit} label={label} /></td>;
  if (wide) return <td className="wide" data-label={col}><EditText canEdit={canEdit} multiline value={v} onCommit={onCommit} label={label} /></td>;
  return <td className="mid" data-label={col}><EditText canEdit={canEdit} value={v} onCommit={onCommit} label={label} inputMode={(cfg.num || []).includes(ci) ? 'decimal' : undefined} /></td>;
}

export default function Evidence({ state, canEdit, actions }) {
  const sheets = Object.keys(REG).filter((k) => state.reg[k]);
  const [cur, setCur] = useState(sheets[0]);
  const [filters, setFilters] = useState({});
  const cfg = REG[cur];
  const R = state.reg[cur];
  const F = filters[cur] || { q: '' };
  const setF = (patch) => setFilters((x) => ({ ...x, [cur]: { ...F, ...patch } }));
  const rows = filterRegRows(cur, R.rows, F);
  const tabs = sheets.map((k) => ({ id: k, label: REG[k].label, count: state.reg[k].rows.length }));

  return (
    <>
      <Governs>Evidence &amp; Transformation Control Register · governs factual traceability</Governs>
      <h2 className="section-title">Evidence register</h2>
      <div className="note"><b>Rules.</b> IND-EV-001…140 and IND-RQ-01…31 are the client's IDs: never renumber them, and never change the original statement or classification. A client answer is an attestation, not proof: record the client answer and the verification status separately. Do not enter inferred figures as verified.</div>

      <TabList tabs={tabs} current={cur} onSelect={setCur} label="Register sheets" className="subtabs" tabClass="subtab" idPrefix="reg" />

      <div id="reg-panel" role="tabpanel" aria-labelledby={`reg-tab-${cur}`}>
        {cfg.lock && <p className="hint"><span className="lock-key" aria-hidden="true" /> Shaded columns are the client's source record and cannot be edited.{cur === 'Client Findings' && " The client's answer and Greatstone's verification are separate fields on purpose."}</p>}
        <div className="toolbar">
          <input type="search" value={F.q} onChange={(e) => setF({ q: e.target.value })} placeholder={`Search ${cfg.label.toLowerCase()}`} aria-label={`Search ${cfg.label.toLowerCase()}`} />
          {(cfg.filters || []).map((ci) => (
            <FilterSelect key={ci} value={F[ci] || ''} onChange={(v) => setF({ [ci]: v })} all={`${R.cols[ci]}: all`} options={regFilterOptions(cur, R.rows, ci)} label={R.cols[ci]} />
          ))}
          {canEdit && !cfg.noAdd && <button type="button" className="btn small" onClick={() => { setF({ q: '' }); actions.addRegRow(cur); }}>Add row</button>}
          <span className="count" aria-live="polite">{rows.length} of {R.rows.length} rows</span>
        </div>
        <div className="table-wrap">
          <table className="gs-table stack">
            <thead><tr>{R.cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>
              {!rows.length && (
                <tr><td colSpan={R.cols.length} className="empty">
                  {R.rows.length ? 'No rows match the filter.' : canEdit && !cfg.noAdd ? 'No rows yet. Use “Add row” when the first record arrives.' : 'No rows yet.'}
                </td></tr>
              )}
              {rows.map(({ row }) => (
                <tr key={row[0]}>
                  {R.cols.map((col, ci) => (
                    <Cell key={ci} sheet={cur} cfg={cfg} row={row} ci={ci} col={col} canEdit={canEdit} onCommit={(v) => actions.updateRegCell(cur, row[0], ci, v)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
