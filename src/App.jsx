import React, { useEffect, useMemo, useState } from 'react';
import { authClient } from './lib/auth-client.mjs';
import { makeIndagoApi } from './indago/indago.mjs';
import { makeRecordStore, recordsToState } from './indago/data/record-store.mjs';
import IndagoApp from './indago/IndagoApp.jsx';
import GreatstoneFooter from './indago/GreatstoneFooter.jsx';

export default function App() {
  const { data: session, isPending } = authClient.useSession();
  const [openAccess, setOpenAccess] = useState(null);
  useEffect(() => {
    let active = true;
    makeIndagoApi().membership()
      .then(member => { if (active) setOpenAccess(member.openAccess === true); })
      .catch(error => { if (active) setOpenAccess([401, 403].includes(error.status) ? false : 'error'); });
    return () => { active = false; };
  }, []);
  if (openAccess === 'error') return <main className="portal-ui state" role="alert">Access could not be checked. Reload and try again.</main>;
  if (openAccess === null) return <main className="portal-ui state" aria-busy="true">Checking access…</main>;
  if (openAccess) return <Workspace key="open-access" openAccess />;
  if (isPending) return <main className="portal-ui state" aria-busy="true">Checking access…</main>;
  if (!session) return <SignIn />;
  return <Workspace key={session.user.id} />;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewRole, setPreviewRole] = useState('editor');
  const [previewPassword, setPreviewPassword] = useState('');
  useEffect(() => {
    fetch('/api/auth/preview-config', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(config => { if (config?.enabled) setPreview(config); })
      .catch(() => {});
  }, []);
  async function submit(event) {
    event.preventDefault();
    setMessage('Sending your sign-in link…');
    const { error } = await authClient.signIn.magicLink({ email: email.trim(), callbackURL: '/portal/indago' });
    setMessage(error ? 'We could not send the link. Try again or contact your portal administrator.' : 'Check your email for the sign-in link.');
  }
  async function submitPreview(event) {
    event.preventDefault();
    setMessage('Signing in…');
    const { error } = await authClient.signIn.email({
      email: preview.users[previewRole], password: previewPassword,
    });
    setPreviewPassword('');
    setMessage(error ? 'Preview sign-in failed. Check the password and try again.' : 'Signed in.');
  }
  return <><main className="portal-ui state">
    <p className="eyebrow">Greatstone International</p><h1>Indago project portal</h1>
    <p>Sign in with the email address invited to this workspace.</p>
    <form onSubmit={submit}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><button>Send sign-in link</button></form>
    {preview && <form onSubmit={submitPreview}>
      <h2>Preview account</h2>
      <label htmlFor="preview-role">Role</label>
      <select id="preview-role" value={previewRole} onChange={e => setPreviewRole(e.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
      <label htmlFor="preview-password">Password</label>
      <input id="preview-password" type="password" autoComplete="current-password" required value={previewPassword} onChange={e => setPreviewPassword(e.target.value)} />
      <button>Sign in to preview</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </main><GreatstoneFooter /></>;
}

export function Workspace({ openAccess = false }) {
  const api = useMemo(() => makeIndagoApi(), []);
  const [role, setRole] = useState(undefined);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const store = useMemo(() => makeRecordStore(api, data => { setSnapshot(data); setLastSync(new Date()); }, setError), [api]);
  useEffect(() => {
    let active = true;
    api.membership().then(member => { if (active) setRole(member?.role ?? null); }).catch(error => {
      if (!active) return;
      if (error.status === 403) setRole(null);
      else setError('Access could not be checked. Reload and try again.');
    });
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
  if (error && role === undefined) return <main className="portal-ui state" role="alert">{error}</main>;
  if (role === undefined) return <main className="portal-ui state" aria-busy="true">Checking invitation…</main>;
  if (!role) return <main className="portal-ui state"><h1>No Indago invitation</h1><p>This account is signed in, but is not invited to this workspace.</p><button onClick={() => authClient.signOut()}>Sign out</button></main>;
  if (!snapshot) return <main className="portal-ui state" aria-busy="true">Loading shared records…</main>;
  const state = recordsToState(snapshot);
  if (!state.toolkit) return <main className="portal-ui state" role="alert">The approved toolkit data is missing. Ask the portal administrator to complete the private source import.</main>;
  const changeLabel = item => {
    const record = snapshot.records.find(row => row.id === item.record_id);
    const sheet = snapshot.sheets.find(row => row.id === record?.sheet_id);
    const keys = new Set([...Object.keys(item.before_edits || {}), ...Object.keys(item.after_edits || {})]);
    const fields = [...keys].filter(key => item.before_edits?.[key] !== item.after_edits?.[key])
      .map(key => /^\d+$/.test(key) ? sheet?.columns[Number(key)] || `Column ${key}` : key);
    return `${sheet?.title || 'Record'} ${record?.source_values[0] || item.record_id}: ${fields.length ? fields.join(', ') : 'new row'}`;
  };
  return <>
    {error && <p className="portal-ui save-alert" role="alert">{error} <button onClick={() => setError('')}>Dismiss</button></p>}
    <IndagoApp store={{ state, canEdit: role === 'editor', actions: store.actions }}
      status={<span role="status" className="portal-ui sync-status">{lastSync ? `Updated ${lastSync.toLocaleTimeString('en-GB')}` : 'Connecting…'}</span>}
      headerSlot={<><button type="button" className="btn small" onClick={showHistory}>History</button>{!openAccess && <button type="button" className="btn small" onClick={() => authClient.signOut()}>Sign out</button>}</>} />
    {history && <aside className="portal-ui history-panel" aria-label="Change history"><button onClick={() => setHistory(null)}>Close history</button><h2>Recent changes</h2><ol>{history.map(item => <li key={item.id}>{changeLabel(item)}, {new Date(item.changed_at).toLocaleString('en-GB')}, {item.actor_email || 'Unknown user'}</li>)}</ol></aside>}
  </>;
}
