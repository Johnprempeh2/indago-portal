import assert from 'node:assert/strict';
import test from 'node:test';
import { handleQaInvite } from './indago-qa-invite.mjs';

const url = 'https://indago.greatstoneint.com/api/indago-qa-invite';
const env = {
  INDAGO_QA_INVITE_ENABLED: '1',
  INDAGO_QA_INVITE_TOKEN: 'a'.repeat(48),
  INDAGO_QA_EDITOR_EMAIL: 'editor@example.test',
  INDAGO_QA_VIEWER_EMAIL: 'viewer@example.test',
  INDAGO_QA_UNINVITED_EMAIL: 'uninvited@example.test',
};
const request = (token = env.INDAGO_QA_INVITE_TOKEN, target = url, action = 'invite') =>
  new Request(target, { method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action }) });

test('invite route is hidden without the exact host, switch and token', async () => {
  const load = async () => { throw new Error('database must stay untouched'); };
  for (const [req, settings] of [
    [request('wrong'), env],
    [request(), { ...env, INDAGO_QA_INVITE_ENABLED: '0' }],
    [request(undefined, 'https://greatstone-indago-portal.netlify.app/api/indago-qa-invite'), env],
  ]) assert.equal((await handleQaInvite(req, settings, load)).status, 404);
});

test('invite route refuses missing or duplicate email configuration', async () => {
  const load = async () => { throw new Error('database must stay untouched'); };
  assert.equal((await handleQaInvite(request(), { ...env, INDAGO_QA_VIEWER_EMAIL: '' }, load)).status, 503);
  assert.equal((await handleQaInvite(request(), { ...env, INDAGO_QA_VIEWER_EMAIL: env.INDAGO_QA_EDITOR_EMAIL }, load)).status, 503);
  assert.equal((await handleQaInvite(request(), { ...env, INDAGO_QA_UNINVITED_EMAIL: '' }, load)).status, 503);
});

test('invite route inserts only the three configured test roles in one transaction', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql, args = []) {
      calls.push([sql, args]);
      return { rows: [] };
    },
  };
  const response = await handleQaInvite(request(), env, async () => ({ pool: { connect: async () => client } }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.filter(([sql]) => sql.startsWith('INSERT')).map(([, args]) => args),
    [['editor@example.test', 'editor'], ['viewer@example.test', 'viewer'],
      ['uninvited@example.test', 'viewer']]);
  assert.equal(calls[0][0], 'BEGIN');
  assert.equal(calls.at(-1)[0], 'COMMIT');
});

test('invite route never changes an existing membership', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT')) return { rows: [{ email: 'editor@example.test', role: 'viewer' }] };
      return { rows: [] };
    },
  };
  const response = await handleQaInvite(request(), env, async () => ({ pool: { connect: async () => client } }));
  assert.equal(response.status, 409);
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some(sql => sql.startsWith('INSERT')), false);
});

test('revoke action removes only the third test membership after sign-in', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql, args = []) {
      calls.push([sql, args]);
      if (sql.startsWith('SELECT')) return { rows: [{ email: 'uninvited@example.test', role: 'viewer' }] };
      return { rows: [] };
    },
  };
  const response = await handleQaInvite(request(undefined, url, 'revoke-uninvited'), env,
    async () => ({ pool: { connect: async () => client } }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.filter(([sql]) => sql.startsWith('DELETE')).map(([, args]) => args),
    [['uninvited@example.test', 'viewer']]);
  assert.equal(calls.at(-1)[0], 'COMMIT');
});

test('a failed invite rolls back without exposing the database error', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT')) return { rows: [] };
      if (sql.startsWith('INSERT')) throw new Error('private database detail');
      return { rows: [] };
    },
  };
  const response = await handleQaInvite(request(), env,
    async () => ({ pool: { connect: async () => client } }));
  assert.equal(response.status, 500);
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal((await response.text()).includes('private database detail'), false);
});

test('seed action adds one labelled synthetic risk with the sheet width', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql, args = []) {
      calls.push([sql, args]);
      if (sql.startsWith('SELECT id, columns')) return { rows: [{ id: 'plan:Risks & Issues', columns: Array(7).fill('') }] };
      if (sql.startsWith('SELECT id FROM')) return { rows: [] };
      if (sql.startsWith('SELECT coalesce')) return { rows: [{ next: 42 }] };
      return { rows: [] };
    },
  };
  const response = await handleQaInvite(request(undefined, url, 'seed-risk'), env,
    async () => ({ pool: { connect: async () => client } }));
  assert.equal(response.status, 200);
  const insert = calls.find(([sql]) => sql.startsWith('INSERT INTO indago.records'));
  assert.equal(insert[1][0], 'qa:cross-user-risk');
  assert.equal(insert[1][2], 42);
  assert.deepEqual(JSON.parse(insert[1][3]).slice(0, 2), ['QA-ONLY', 'Synthetic QA row; safe to edit']);
  assert.equal(JSON.parse(insert[1][3]).length, 7);
  assert.equal(calls.at(-1)[0], 'COMMIT');
});

test('remove action deletes history and only the labelled synthetic risk', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql, args = []) {
      calls.push([sql, args]);
      if (sql.startsWith('SELECT sheet_id')) return { rows: [{
        sheet_id: 'plan:Risks & Issues', source_values: ['QA-ONLY', 'Synthetic QA row; safe to edit'],
      }] };
      return { rows: [] };
    },
  };
  const response = await handleQaInvite(request(undefined, url, 'remove-risk'), env,
    async () => ({ pool: { connect: async () => client } }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.filter(([sql]) => sql.startsWith('DELETE')).map(([, args]) => args),
    [['qa:cross-user-risk'], ['qa:cross-user-risk']]);
  assert.equal(calls.at(-1)[0], 'COMMIT');
});

test('remove action refuses a changed source row before any delete', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT sheet_id')) return { rows: [{
        sheet_id: 'plan:Risks & Issues', source_values: ['QA-ONLY', 'unexpected source'],
      }] };
      return { rows: [] };
    },
  };
  const response = await handleQaInvite(request(undefined, url, 'remove-risk'), env,
    async () => ({ pool: { connect: async () => client } }));
  assert.equal(response.status, 409);
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some(sql => sql.startsWith('DELETE')), false);
});
