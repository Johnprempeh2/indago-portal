export function makeIndagoApi(supabase) {
  const db = supabase.schema('indago');
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };
  return {
    async membership() {
      const { data, error } = await db.from('members').select('role').maybeSingle();
      if (error) throw error;
      return data;
    },
    async snapshot() {
      const [sheets, records] = await Promise.all([
        db.from('sheets').select('*').order('position').then(unwrap),
        db.from('records').select('*').order('sheet_id').order('position').then(unwrap),
      ]);
      return { sheets, records };
    },
    async history(recordId) {
      return db.from('history').select('*').eq('record_id', recordId).order('id', { ascending: false }).then(unwrap);
    },
    async recentHistory() {
      return db.from('history').select('*').order('id', { ascending: false }).limit(50).then(unwrap);
    },
    async add(record) {
      return db.from('records').insert(record).select('*').single().then(unwrap);
    },
    async save(record, edits) {
      const { data, error } = await db.from('records').update({ edits })
        .eq('id', record.id).eq('version', record.version).select('*').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This record changed in another browser. Reload it before saving.');
      return data;
    },
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
