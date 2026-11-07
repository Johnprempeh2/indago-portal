import test from 'node:test';
import assert from 'node:assert/strict';
import { draftHandler } from './indago-draft-background.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const request = (method = 'POST', query = `?id=${id}`) => new Request(`https://example.test/.netlify/functions/indago-draft-background${query}`, { method });
const signedIn = async () => ({ user: { id: 'client-one', email: 'one@example.test' } });

test('background draft runs only for a signed-in participant with a valid session id', async () => {
  const calls = [];
  const write = async (...args) => { calls.push(args); return 'done'; };
  assert.equal(await draftHandler(request('GET'), { getSession: signedIn, member: async () => null, write }), 'rejected');
  assert.equal(await draftHandler(request('POST', '?id=../x'), { getSession: signedIn, member: async () => null, write }), 'rejected');
  assert.equal(await draftHandler(request(), { getSession: async () => null, member: async () => null, write }), 'rejected');
  assert.equal(calls.length, 0);
  assert.equal(await draftHandler(request(), { getSession: signedIn, member: async () => null, write }), 'done');
  assert.equal(calls[0][0], id);
  assert.equal(calls[0][1], 'client-one');
});

test('a database error in the background draft is reported as a fixed failure', async () => {
  const member = async () => new Response('{}', { status: 500 });
  const write = async (sessionId, userId, transaction) => transaction(async () => 'never');
  assert.equal(await draftHandler(request(), { getSession: signedIn, member, write }), 'failed');
});
