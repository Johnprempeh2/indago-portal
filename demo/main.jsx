// Demo page: the screens on MADE-UP data, with no sign-in and no database.
// Add ?viewer to the address to see the read-only Viewer role.
import React, { useMemo, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import IndagoApp from '../src/indago/IndagoApp.jsx';
import { demoState } from '../src/indago/fixture/demo-state.mjs';
import { reduce, bindActions } from '../src/indago/model/local-store.mjs';

function Demo() {
  const sample = 'id,note\nDEMO-1,Invented sample\n';
  const [state, dispatch] = useReducer((s, a) => reduce(s, a), undefined, demoState);
  const [files, setFiles] = useState([{
    id: 'demo-file-1', work_package_id: '1.01', file_name: 'Demo access note.csv',
    byte_size: new TextEncoder().encode(sample).length, chunk_count: 1,
    uploaded_by: 'Demo Person', uploaded_at: '2026-10-20T09:00:00Z',
  }]);
  const actions = useMemo(() => bindActions(dispatch), []);
  const canEdit = !new URLSearchParams(location.search).has('viewer');
  const save = (name, data) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const fileActions = {
    upload: async (id, file) => {
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose a file under 50 MB.');
      setFiles(current => [...current, { id: crypto.randomUUID(), work_package_id: id,
        file_name: file.name, byte_size: file.size, chunk_count: 1,
        uploaded_by: 'Demo editor', uploaded_at: new Date().toISOString(), data: file }]);
    },
    remove: async id => setFiles(current => current.filter(file => file.id !== id)),
    download: async file => save(file.file_name, file.data || sample),
  };
  return <IndagoApp store={{ state, canEdit, actions, files, fileActions }} status={<span className="badge">Demo data</span>} />;
}

createRoot(document.getElementById('root')).render(<Demo />);
