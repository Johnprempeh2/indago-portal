export function makeIndagoApi(fetcher = fetch) {
  const call = async (path, body) => {
    const response = await fetcher(`/api/indago/${path}`, body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Portal request failed.'), { status: response.status });
    return result;
  };
  return {
    async membership() { return call('membership'); },
    async snapshot() { return call('snapshot'); },
    async recentHistory() { return call('history'); },
    async northStar() { return call('north-star'); },
    async northStarHistory() { return call('north-star/history'); },
    async saveNorthStarField(key, value) { return call('north-star/field', { key, value }); },
    async addNorthStarHypothesis() { return call('north-star/hypothesis', {}); },
    async sendNorthStarHypothesis(id) { return call('north-star/send', { id }); },
    async deliverables() { return call('deliverables'); },
    async uploadDeliverable(recordId, file) {
      if (file.size < 1 || file.size > 50 * 1024 * 1024) throw new Error('Choose a file under 50 MB.');
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      const { id, chunkSize } = await call('deliverables/init', { recordId, name: file.name, size: file.size, sha256 });
      for (let n = 0; n < Math.ceil(file.size / chunkSize); n++) {
        const response = await fetcher(`/api/indago/deliverables/${id}/chunk/${n}`, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes.slice(n * chunkSize, Math.min((n + 1) * chunkSize, file.size)),
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Upload failed. Try again.');
      }
      await call(`deliverables/${id}/finish`, {});
    },
    async removeDeliverable(id) { return call(`deliverables/${id}/remove`, {}); },
    async downloadDeliverable(file) {
      const parts = [];
      for (let n = 0; n < file.chunk_count; n++) {
        const response = await fetcher(`/api/indago/deliverables/${file.id}/download/${n}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error((await response.json()).error || 'Download failed. Try again.');
        parts.push(await response.arrayBuffer());
      }
      const blob = new Blob(parts, { type: 'application/octet-stream' });
      if (blob.size !== file.byte_size) throw new Error('Download is incomplete. Try again.');
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (sha256 !== file.sha256) throw new Error('Download did not match the stored file. Contact the portal administrator.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.file_name;
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    async add(record) { return call('add', record); },
    async save(record, edits) { return call('save', { id: record.id, version: record.version, edits }); },
  };
}

export function displayValues(record) {
  return record.source_values.map((value, index) => record.edits[String(index)] ?? value);
}

export function toCsv(columns, records) {
  const quote = value => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return [columns, ...records.map(displayValues)].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
