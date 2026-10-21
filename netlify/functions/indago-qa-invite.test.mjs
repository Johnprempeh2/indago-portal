import assert from 'node:assert/strict';
import test from 'node:test';
import { handleQaInvite } from './indago-qa-invite.mjs';
import { captureQaLink, captureQaLinks } from './lib/qa-links.mjs';

const url = 'https://indago.greatstoneint.com/api/indago-qa-invite';
const env = { INDAGO_QA_INVITE_ENABLED: '1', INDAGO_QA_INVITE_TOKEN: 'a'.repeat(48) };
const emails = ['editor@indago-test.invalid', 'viewer@indago-test.invalid', 'uninvited@indago-test.invalid'];
const request = (action = 'invite', token = env.INDAGO_QA_INVITE_TOKEN, target = url) =>
  new Request(target, { method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action }) });
function database(accounts = [], members = []) {
  const calls = [];
  const client = { release() {}, async query(sql, args = []) {
    calls.push([sql, args]);
    if (sql.startsWith('SELECT') && sql.includes('"user"')) return { rows: accounts };
    if (sql.startsWith('SELECT') && sql.includes('indago.members')) return { rows: members };
    return { rows: [] };
  } };
  return { calls, load: async () => ({ pool: { connect: async () => client } }) };
}

test('QA route hides itself without exact host, switch and secret', async () => {
  const load = async () => { throw new Error('must not load database'); };
  for (const [req, settings] of [
    [request('links', 'wrong'), env],
    [request('links'), { ...env, INDAGO_QA_INVITE_ENABLED: '0' }],
    [request('links', undefined, 'https://greatstone-indago-portal.netlify.app/api/indago-qa-invite'), env],
  ]) assert.equal((await handleQaInvite(req, settings, load)).status, 404);
});

test('invite creates three reserved users and two members only', async () => {
  const db = database();
  assert.equal((await handleQaInvite(request(), env, db.load)).status, 200);
  const inserts = db.calls.filter(([sql]) => sql.startsWith('INSERT'));
  assert.deepEqual(inserts.filter(([sql]) => sql.includes('"user"')).map(([, args]) => args[2]), emails);
  assert.deepEqual(inserts.filter(([sql]) => sql.includes('indago.members')).map(([, args]) => args.slice(0, 2)),
    [[emails[0], 'editor'], [emails[1], 'viewer']]);
  assert.equal(db.calls.at(-1)[0], 'COMMIT');
});

test('invite refuses an existing account', async () => {
  const db = database([{ id: 'existing', email: emails[0] }]);
  assert.equal((await handleQaInvite(request(), env, db.load)).status, 409);
  assert.equal(db.calls.some(([sql]) => sql.startsWith('INSERT')), false);
});

test('links return only when third identity remains uninvited', async () => {
  const accounts = emails.map((email, i) => ({ id: `id-${i}`, email }));
  const members = accounts.slice(0, 2).map((account, i) =>
    ({ email: account.email, role: i ? 'viewer' : 'editor', user_id: account.id }));
  const db = database(accounts, members);
  const links = Object.fromEntries(emails.map(email => [email, `https://test.invalid/${email}`]));
  const response = await handleQaInvite(request('links'), env, db.load, async () => links);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).links, links);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const wrong = database(accounts, [...members, { email: emails[2], role: 'viewer' }]);
  assert.equal((await handleQaInvite(request('links'), env, wrong.load,
    async () => { throw new Error('must not issue'); })).status, 409);
});

test('synthetic links cannot be captured outside gated call', async () => {
  assert.throws(() => captureQaLink(emails[0], 'secret'), /outside the gated route/);
  assert.equal(captureQaLink('person@greatstoneint.com', 'secret'), false);
  const { links } = await captureQaLinks(async () => captureQaLink(emails[0], 'private-link'));
  assert.equal(links.get(emails[0]), 'private-link');
});

test('teardown deletes matching synthetic users and memberships', async () => {
  const accounts = emails.map((email, i) => ({ id: `id-${i}`, email }));
  const members = accounts.slice(0, 2).map((account, i) =>
    ({ email: account.email, role: i ? 'viewer' : 'editor', user_id: account.id }));
  const db = database(accounts, members);
  assert.equal((await handleQaInvite(request('remove-users'), env, db.load)).status, 200);
  assert.deepEqual(db.calls.filter(([sql]) => sql.startsWith('DELETE')).map(([, args]) => args[0]),
    [emails.slice(0, 2), emails]);
  assert.equal(db.calls.at(-1)[0], 'COMMIT');
});

test('seed adds one labelled synthetic risk with the sheet width', async () => {
  const calls = [];
  const client = { release() {}, async query(sql, args = []) {
    calls.push([sql, args]);
    if (sql.startsWith('SELECT id, columns')) return { rows: [{ columns: Array(7).fill('') }] };
    if (sql.startsWith('SELECT id FROM')) return { rows: [] };
    if (sql.startsWith('SELECT coalesce')) return { rows: [{ next: 42 }] };
    return { rows: [] };
  } };
  const load = async () => ({ pool: { connect: async () => client } });
  assert.equal((await handleQaInvite(request('seed-risk'), env, load)).status, 200);
  const insert = calls.find(([sql]) => sql.startsWith('INSERT INTO indago.records'));
  assert.equal(insert[1][0], 'qa:cross-user-risk');
  assert.deepEqual(JSON.parse(insert[1][3]).slice(0, 2), ['QA-ONLY', 'Synthetic QA row; safe to edit']);
  assert.equal(JSON.parse(insert[1][3]).length, 7);
});

test('remove-risk deletes history and only the labelled row', async () => {
  const calls = [];
  const client = { release() {}, async query(sql, args = []) {
    calls.push([sql, args]);
    if (sql.startsWith('SELECT sheet_id')) return { rows: [{ sheet_id: 'plan:Risks & Issues',
      source_values: ['QA-ONLY', 'Synthetic QA row; safe to edit'] }] };
    return { rows: [] };
  } };
  const load = async () => ({ pool: { connect: async () => client } });
  assert.equal((await handleQaInvite(request('remove-risk'), env, load)).status, 200);
  assert.deepEqual(calls.filter(([sql]) => sql.startsWith('DELETE')).map(([, args]) => args),
    [['qa:cross-user-risk'], ['qa:cross-user-risk']]);
});

test('changed synthetic source refuses cleanup', async () => {
  const calls = [];
  const client = { release() {}, async query(sql, args = []) {
    calls.push([sql, args]);
    if (sql.startsWith('SELECT sheet_id')) return { rows: [{ sheet_id: 'plan:Risks & Issues',
      source_values: ['QA-ONLY', 'other'] }] };
    return { rows: [] };
  } };
  const load = async () => ({ pool: { connect: async () => client } });
  assert.equal((await handleQaInvite(request('remove-risk'), env, load)).status, 409);
  assert.equal(calls.some(([sql]) => sql.startsWith('DELETE')), false);
});
