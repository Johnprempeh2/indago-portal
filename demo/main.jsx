// Demo page: the screens on MADE-UP data, with no sign-in and no database.
// Add ?viewer to the address to see the read-only Viewer role.
import React, { useMemo, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import IndagoApp from '../src/IndagoApp.jsx';
import { demoState } from '../src/fixture/demo-state.mjs';
import { reduce, bindActions } from '../src/model/local-store.mjs';

function Demo() {
  const [state, dispatch] = useReducer((s, a) => reduce(s, a), undefined, demoState);
  const actions = useMemo(() => bindActions(dispatch), []);
  const canEdit = !new URLSearchParams(location.search).has('viewer');
  return <IndagoApp store={{ state, canEdit, actions }} status={<span className="badge">Demo data</span>} />;
}

createRoot(document.getElementById('root')).render(<Demo />);
