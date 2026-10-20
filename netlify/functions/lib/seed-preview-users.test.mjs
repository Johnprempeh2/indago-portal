import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSeedRequest } from '../seed-preview-users.mjs';

const url = 'https://greatstone-indago-portal.netlify.app/api/seed-preview-users';
const env = {
  INDAGO_SEED_MODE: '1',
  INDAGO_SEED_TOKEN: 'a-long-random-seed-token',
  INDAGO_TEST_EDITOR_PASSWORD: 'editor-password-for-test',
  INDAGO_TEST_VIEWER_PASSWORD: 'viewer-password-for-test',
};
const request = (target = url, token = env.INDAGO_SEED_TOKEN, method = 'POST') =>
  new Request(target, { method, headers: { Authorization: `Bearer ${token}` } });

test('seed route rejects absent or wrong secret, host, method and switch before database access', async () => {
  const noDb = async () => { throw new Error('Database reached'); };
  for (const [req, config] of [
    [request(url, 'wrong'), env],
    [request('https://indago.greatstoneint.com/api/seed-preview-users'), env],
    [request(url, env.INDAGO_SEED_TOKEN, 'GET'), env],
    [request(), { ...env, INDAGO_SEED_MODE: '0' }],
  ]) {
    assert.equal((await handleSeedRequest(req, config, noDb)).status, 404);
  }
});

test('seed creates only two fixed preview users and is safe to retry', async () => {
  const members = new Map();
  const users = new Set();
  const db = { pool: { query: async (sql, args) => {
    if (sql.startsWith('INSERT')) { members.set(args[0], args[1]); return { rows: [] }; }
    return { rows: users.has(args[0]) ? [{ exists: 1 }] : [] };
  } } };
  const auth = { api: { signUpEmail: async ({ body }) => { users.add(body.email); } } };
  for (let i = 0; i < 2; i++) {
    assert.equal((await handleSeedRequest(request(), env, async () => ({ db, auth }))).status, 200);
  }
  assert.deepEqual([...members.values()], ['editor', 'viewer']);
  assert.equal(users.size, 2);
});
