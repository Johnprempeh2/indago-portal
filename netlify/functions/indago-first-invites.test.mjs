import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFirstInvites } from './indago-first-invites.mjs';

const env = {
  INDAGO_FIRST_INVITES_ENABLED: '1',
  INDAGO_FIRST_INVITES_TOKEN: 'a'.repeat(32),
  INDAGO_FIRST_EDITOR_EMAIL: 'editor@example.test',
  INDAGO_FIRST_VIEWER_EMAIL: 'viewer@example.test',
};
const request = (token = env.INDAGO_FIRST_INVITES_TOKEN, host = 'indago.greatstoneint.com') =>
  new Request(`https://${host}/api/indago-first-invites`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });

function database(total = 0) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT count')) return { rows: [{ total }] };
      return { rows: [] };
    },
    release() { calls.push({ sql: 'release' }); },
  };
  return { calls, load: async () => ({ pool: { connect: async () => client } }) };
}

test('requires the enabled production host and token', async () => {
  const db = database();
  for (const [req, config] of [
    [request(), { ...env, INDAGO_FIRST_INVITES_ENABLED: '0' }],
    [request('wrong'), env],
    [request(env.INDAGO_FIRST_INVITES_TOKEN, 'other.example.test'), env],
  ]) assert.equal((await handleFirstInvites(req, config, db.load)).status, 404);
  assert.deepEqual(db.calls, []);
});

test('inserts only the two configured roles when the list is empty', async () => {
  const db = database();
  const response = await handleFirstInvites(request(), env, db.load);
  assert.equal(response.status, 200);
  assert.deepEqual(db.calls.map(call => call.sql), [
    'BEGIN', 'SELECT count(*)::int AS total FROM indago.members',
    'INSERT INTO indago.members(email, role) VALUES ($1, $2), ($3, $4)', 'COMMIT', 'release',
  ]);
  assert.deepEqual(db.calls[2].values,
    ['editor@example.test', 'editor', 'viewer@example.test', 'viewer']);
});

test('rejects a changed membership list without writing', async () => {
  const db = database(1);
  assert.equal((await handleFirstInvites(request(), env, db.load)).status, 409);
  assert.deepEqual(db.calls.map(call => call.sql), [
    'BEGIN', 'SELECT count(*)::int AS total FROM indago.members', 'ROLLBACK', 'release',
  ]);
});

test('rejects duplicate or missing invite configuration', async () => {
  const db = database();
  const config = { ...env, INDAGO_FIRST_VIEWER_EMAIL: env.INDAGO_FIRST_EDITOR_EMAIL };
  assert.equal((await handleFirstInvites(request(), config, db.load)).status, 503);
  assert.deepEqual(db.calls, []);
});
