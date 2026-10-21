import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { REG, TABS } from './model/options.mjs';
import { EXPORT_SHEETS, sheetRows, toCsv } from './model/indago-model.mjs';
import { TabList } from './screens/ui.jsx';
import { panelScrollDelta } from './screens/panel-scroll.mjs';
import ControlCentre from './screens/ControlCentre.jsx';
import WorkPlan from './screens/WorkPlan.jsx';
import Gates from './screens/Gates.jsx';
import Risks from './screens/Risks.jsx';
import Investigation from './screens/Investigation.jsx';
import Evidence from './screens/Evidence.jsx';
import Traceability from './screens/Traceability.jsx';
import logo from '../assets/greatstone-logo-web.png';
import GreatstoneFooter from './GreatstoneFooter.jsx';
import './indago.css';

const SCREENS = { control: ControlCentre, plan: WorkPlan, gates: Gates, risks: Risks, investigation: Investigation, evidence: Evidence, trace: Traceability };

const tabFromHash = () => {
  const h = (typeof location !== 'undefined' ? location.hash : '').slice(1);
  return SCREENS[h] ? h : 'control';
};

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function ExportCsv({ state }) {
  const [sheet, setSheet] = useState(EXPORT_SHEETS[0]);
  const run = () => download(`indago-${sheet.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, toCsv(sheetRows(state, sheet)));
  return (
    <div className="export">
      <select value={sheet} onChange={(e) => setSheet(e.target.value)} aria-label="Sheet to export">
        {EXPORT_SHEETS.filter((k) => !REG[k] || state.reg[k]).map((k) => <option key={k}>{k}</option>)}
      </select>
      <button type="button" className="btn small" onClick={run}>Export CSV</button>
    </div>
  );
}

const GOV = [
  { role: 'Primary management instrument', name: 'Master Project Plan', what: 'Work packages, owners, periods, dependencies, gates G1–G6, milestones and risks. Status changes here drive the dashboard.', primary: true },
  { role: 'Governs the investigation', name: 'Delivery Toolkit v3.0', what: 'Stages 01–06, operating rules, North Star workshop, B1–B3 sessions, instruments and gate criteria.' },
  { role: 'Governs factual & design traceability', name: 'Evidence & Transformation Control Register', what: 'Client findings, information requests and the registers from new evidence to GDXP™ traceability.' },
];

// The Indago portal. `store` comes from the data layer:
// { state, canEdit, actions } — see README "Data contract".
// `headerSlot` lets the host add sign-out, history or live-status controls.
export default function IndagoApp({ store, headerSlot, status }) {
  const { state, canEdit, actions } = store;
  const [tab, setTab] = useState(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (id) => {
    setTab(id);
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  };

  // On every tab change (click, keys, hash), put the new panel's heading
  // fully below the sticky tab bar instead of keeping the old scroll position.
  const navRef = useRef(null);
  const panelRef = useRef(null);
  const firstRender = useRef(true);
  useLayoutEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const nav = navRef.current;
    const panel = panelRef.current;
    if (!nav || !panel) return;
    const n = nav.getBoundingClientRect();
    const dy = panelScrollDelta({
      navTop: n.top,
      navBottom: n.bottom,
      panelTop: panel.getBoundingClientRect().top,
      gap: parseFloat(getComputedStyle(nav).marginBottom) || 0,
    });
    if (dy) window.scrollBy({ top: dy, behavior: 'instant' });
  }, [tab]);

  const Screen = SCREENS[tab];
  return (
    <div className="indago">
      <a className="skip" href="#indago-panel">Skip to content</a>
      <div className="container">
        <header className="top">
          <div className="brand">
            <img className="gs-logo" src={logo} alt="Greatstone International" width="160" height="32" />
            <span className="app-name">Indago Deep Dive™ <span className="faint">· Project portal</span></span>
          </div>
          <div className="top-actions">
            {status}
            <span className={`badge${canEdit ? ' edit' : ''}`}>{canEdit ? 'Editor' : 'Viewer · read only'}</span>
            <ExportCsv state={state} />
            {headerSlot}
          </div>
        </header>

        {tab === 'control' && (
          <section className="cover-band" aria-labelledby="cover-h">
            <div className="kicker">Indago Deep Dive™ · Project portal</div>
            <h1 id="cover-h">One place to <span className="accent">run, evidence and trace</span> the Indago Deep Dive.</h1>
            <div className="gov">
              {GOV.map((g) => (
                <div key={g.name} className={`g${g.primary ? ' primary' : ''}`}>
                  <div className="role">{g.role}</div>
                  <div className="name">{g.name}</div>
                  <div className="what">{g.what}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <nav ref={navRef} className="tabs-bar" aria-label="Portal sections">
          <TabList tabs={TABS} current={tab} onSelect={open} label="Portal sections" idPrefix="indago" />
        </nav>

        <main ref={panelRef} id="indago-panel" className="panel" role="tabpanel" aria-labelledby={`indago-tab-${tab}`} tabIndex={-1}>
          <Screen state={state} canEdit={canEdit} actions={actions} onOpen={open} />
        </main>

        <GreatstoneFooter />
      </div>
    </div>
  );
}
