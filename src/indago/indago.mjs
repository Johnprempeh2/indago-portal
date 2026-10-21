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
