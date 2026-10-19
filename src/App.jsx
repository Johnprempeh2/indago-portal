import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.mjs';
import { makeIndagoApi, displayValues, toCsv } from './lib/indago.mjs';

const VIEWS = ['Control centre', 'Work plan', 'Gates', 'Risks', 'Investigation', 'Evidence', 'Traceability'];
const VIEW_SHEETS = {
  'Work plan': ['Work Breakdown', 'Milestones'],
  Gates: ['Stage Gates'],
  Risks: ['Risks & Issues'],
  Investigation: ['Delivery Toolkit', 'Service Processes', 'Commercial Baseline'],
  Evidence: ['Client Findings', 'Information Requests', 'New Deep Dive Evidence'],
  Traceability: ['Findings', 'Opportunities', 'Decisions', 'GDXP Traceability', 'Validation Log'],
};

function download(name, body) {
  const url = URL.createObjectURL(new Blob(['\ufeff', body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!supabase) return <main className="state"><h1>Portal setup is incomplete</h1><p>Set the Supabase public URL and publishable key for this site.</p></main>;
  if (session === undefined) return <main className="state" aria-busy="true">Checking access…</main>;
  if (!session) return <SignIn />;
  return <Workspace key={session.user.id} session={session} />;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');
  async function submit(event) {
    event.preventDefault();
    setState('Sending your sign-in link…');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}/portal/indago` } });
    setState(error ? 'We could not send the link. Try again or contact your portal administrator.' : 'Check your email for the sign-in link.');
  }
  return <main className="state">
    <p className="eyebrow">Greatstone International</p>
    <h1>Indago project portal</h1>
    <p>Sign in with the email address invited to this workspace.</p>
    <form onSubmit={submit}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><button>Send sign-in link</button></form>
    {state && <p role="status">{state}</p>}
  </main>;
}

function Workspace({ session }) {
  const api = useMemo(() => makeIndagoApi(supabase), []);
  const [role, setRole] = useState(undefined);
  const [snapshot, setSnapshot] = useState(null);
  const [view, setView] = useState('Control centre');
  const [sheetId, setSheetId] = useState('');
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api.membership().then(m => { if (active) setRole(m?.role ?? null); }).catch(() => { if (active) setMessage('Access could not be checked. Try reloading.'); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (!role) return;
    let active = true;
    const load = () => api.snapshot().then(data => { if (active) setSnapshot(data); }).catch(() => { if (active) setMessage('Data could not be loaded. Your last saved change remains in the database.'); });
    load();
    const timer = setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [api, role]);
  useEffect(() => {
    if (!selected) return;
    api.history(selected.id).then(setHistory).catch(() => setMessage('History could not be loaded.'));
  }, [api, selected]);
  if (message && role === undefined) return <main className="state" role="alert">{message}</main>;
  if (role === undefined) return <main className="state" aria-busy="true">Checking invitation…</main>;
  if (!role) return <main className="state"><h1>No Indago invitation</h1><p>This account is signed in, but it is not invited to this workspace.</p><button onClick={() => supabase.auth.signOut()}>Sign out</button></main>;
  const sheets = snapshot?.sheets.filter(s => (VIEW_SHEETS[view] ?? []).includes(s.title)) ?? [];
  const activeSheet = sheets.find(s => s.id === sheetId) ?? sheets[0];
  const rows = snapshot?.records.filter(r => r.sheet_id === activeSheet?.id) ?? [];
  return <div className="shell">
    <header><div><p className="eyebrow">Greatstone International</p><h1>Indago project portal</h1></div><div><span>{role === 'editor' ? 'Editor' : 'Viewer'}</span><button className="quiet" onClick={() => supabase.auth.signOut()}>Sign out</button></div></header>
    <nav aria-label="Portal sections">{VIEWS.map(item => <button key={item} aria-current={view === item ? 'page' : undefined} onClick={() => { setView(item); setSheetId(''); setSelected(null); }}>{item}</button>)}</nav>
    <main id="content">
      <h2>{view}</h2>
      {message && <p role="alert">{message} <button className="quiet" onClick={() => setMessage('')}>Dismiss</button></p>}
      {!snapshot ? <p aria-busy="true">Loading shared records…</p> : view === 'Control centre' ? <dl className="totals">{[['Work packages','Work Breakdown'],['Gates','Stage Gates'],['Findings','Client Findings'],['Requests','Information Requests']].map(([label,title]) => <div key={title}><dt>{label}</dt><dd>{snapshot.records.filter(r => snapshot.sheets.find(s => s.id === r.sheet_id)?.title === title).length}</dd></div>)}</dl> : <>
        <label htmlFor="sheet">Register</label>
        <select id="sheet" value={activeSheet?.id ?? ''} onChange={e => { setSheetId(e.target.value); setSelected(null); }}>{sheets.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
        {activeSheet && <button onClick={() => download(`${activeSheet.title.toLowerCase().replaceAll(' ', '-')}.csv`, toCsv(activeSheet.columns, rows))}>Export CSV</button>}
        <div className="table-wrap"><table><thead><tr>{activeSheet?.columns.map((col, i) => <th key={i} scope="col">{col}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{displayValues(row).map((value, i) => <td key={i}>{i === 0 ? <button className="record-link" onClick={() => setSelected(row)} aria-label={`Open record ${value || row.position}`}>{value || `Record ${row.position}`}</button> : value}</td>)}</tr>)}</tbody></table></div>
        {rows.length === 0 && <p>No records in this register yet.</p>}
      </>}
    </main>
    {selected && <RecordPanel key={selected.id} record={selected} sheet={snapshot.sheets.find(s => s.id === selected.sheet_id)} role={role} history={history} api={api} onClose={() => setSelected(null)} onSaved={async () => { setSnapshot(await api.snapshot()); setHistory(await api.history(selected.id)); setSelected(null); }} />}
  </div>;
}

function RecordPanel({ record, sheet, role, history, api, onClose, onSaved }) {
  const [edits, setEdits] = useState({ ...record.edits });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await api.save(record, edits); await onSaved(); }
    catch (e) { setError(e.message || 'The change could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  return <aside className="panel" aria-label="Record details"><button className="quiet" onClick={onClose}>Close</button><h2>Record details</h2>
    {sheet.columns.map((column, i) => <label key={i}>{column}<textarea value={edits[String(i)] ?? record.source_values[i] ?? ''} readOnly={role !== 'editor' || sheet.locked_columns.includes(i)} onChange={e => setEdits({ ...edits, [String(i)]: e.target.value })} /></label>)}
    {role === 'editor' && <button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save change'}</button>}
    {error && <p role="alert">{error}</p>}
    <h3>Change history</h3><ol>{history.map(item => <li key={item.id}>{new Date(item.changed_at).toLocaleString()} · version {item.version}</li>)}</ol>
  </aside>;
}
