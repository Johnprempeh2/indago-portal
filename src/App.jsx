import React, { useEffect, useMemo, useState } from 'react';
import { authClient } from './lib/auth-client.mjs';
import { makeIndagoApi } from './lib/indago.mjs';
import { makeRecordStore, recordsToState } from './data/record-store.mjs';
import IndagoApp from './IndagoApp.jsx';

export default function App() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <main className="state" aria-busy="true">Checking access…</main>;
  if (!session) return <SignIn />;
  return <Workspace key={session.user.id} />;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event) {
    event.preventDefault();
    setMessage('Sending your sign-in link…');
    const { error } = await authClient.signIn.magicLink({ email: email.trim(), callbackURL: '/portal/indago' });
    setMessage(error ? 'We could not send the link. Try again or contact your portal administrator.' : 'Check your email for the sign-in link.');
  }
  return <main className="state">
    <p className="eyebrow">Greatstone International</p><h1>Indago project portal</h1>
    <p>Sign in with the email address invited to this workspace.</p>
    <form onSubmit={submit}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><button>Send sign-in link</button></form>
    {message && <p role="status">{message}</p>}
  </main>;
}

function Workspace() {
  const api = useMemo(() => makeIndagoApi(), []);
  const [role, setRole] = useState(undefined);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const store = useMemo(() => makeRecordStore(api, data => { setSnapshot(data); setLastSync(new Date()); }, setError), [api]);
  useEffect(() => {
    let active = true;
    api.membership().then(member => { if (active) setRole(member?.role ?? null); }).catch(() => { if (active) setError('Access could not be checked. Reload and try again.'); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (!role) return;
    store.refresh().catch(e => setError(e.message || 'Data could not be loaded. Reload and try again.'));
    const timer = setInterval(() => {
      if (!document.hidden) store.refresh().catch(e => setError(e.message || 'Live update failed. Reload and try again.'));
    }, 5000);
    return () => clearInterval(timer);
  }, [role, store]);
  const showHistory = async () => {
    if (history) { setHistory(null); return; }
    try { setHistory(await api.recentHistory()); } catch (e) { setError(e.message || 'History could not be loaded.'); }
  };
  if (error && role === undefined) return <main className="state" role="alert">{error}</main>;
  if (role === undefined) return <main className="state" aria-busy="true">Checking invitation…</main>;
  if (!role) return <main className="state"><h1>No Indago invitation</h1><p>This account is signed in, but is not invited to this workspace.</p><button onClick={() => authClient.signOut()}>Sign out</button></main>;
  if (!snapshot) return <main className="state" aria-busy="true">Loading shared records…</main>;
  const state = recordsToState(snapshot);
  if (!state.toolkit) return <main className="state" role="alert">The approved toolkit data is missing. Ask the portal administrator to complete the private source import.</main>;
  const changeLabel = item => {
    const record = snapshot.records.find(row => row.id === item.record_id);
    const sheet = snapshot.sheets.find(row => row.id === record?.sheet_id);
    const keys = new Set([...Object.keys(item.before_edits || {}), ...Object.keys(item.after_edits || {})]);
    const fields = [...keys].filter(key => item.before_edits?.[key] !== item.after_edits?.[key])
      .map(key => /^\d+$/.test(key) ? sheet?.columns[Number(key)] || `Column ${key}` : key);
    return `${sheet?.title || 'Record'} ${record?.source_values[0] || item.record_id}: ${fields.length ? fields.join(', ') : 'new row'}`;
  };
  return <>
    {error && <p className="save-alert" role="alert">{error} <button onClick={() => setError('')}>Dismiss</button></p>}
    <IndagoApp store={{ state, canEdit: role === 'editor', actions: store.actions }}
      status={<span role="status" className="sync-status">{lastSync ? `Updated ${lastSync.toLocaleTimeString('en-GB')}` : 'Connecting…'}</span>}
      headerSlot={<><button type="button" className="btn small" onClick={showHistory}>History</button><button type="button" className="btn small" onClick={() => authClient.signOut()}>Sign out</button></>} />
    {history && <aside className="history-panel" aria-label="Change history"><button onClick={() => setHistory(null)}>Close history</button><h2>Recent changes</h2><ol>{history.map(item => <li key={item.id}>{changeLabel(item)}, {new Date(item.changed_at).toLocaleString('en-GB')}, {item.actor_email || 'Unknown user'}</li>)}</ol></aside>}
  </>;
}
