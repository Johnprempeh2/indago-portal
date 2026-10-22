import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAuthRequest, previewLoginAllowed, previewUsers } from './preview-login.mjs';

const previewHost = 'https://greatstone-indago-preview.netlify.app';
const env = { INDAGO_TEST_LOGIN: '1', INDAGO_TEST_LOGIN_HOST: 'greatstone-indago-preview.netlify.app' };
const auth = { handler: async () => new Response('auth reached') };
const request = (host, path, body) => new Request(`${host}/api/auth/${path}`, {
  method: body ? 'POST' : 'GET',
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
});

test('preview sign-in is off by default and rejects the production alias', async () => {
  assert.equal(previewLoginAllowed(request(previewHost, 'preview-config'), {}), false);
  assert.equal(previewLoginAllowed(request('https://indago.greatstoneint.com', 'preview-config'), env), false);
  assert.equal(previewLoginAllowed(request('https://greatstone-indago-portal.netlify.app', 'preview-config'), env), false);
  assert.equal(previewLoginAllowed(request(previewHost.replace('https:', 'http:'), 'preview-config'), env), false);
  assert.equal((await handleAuthRequest(request(previewHost, 'sign-in/email', { email: previewUsers.editor }), auth, {})).status, 404);
  assert.equal((await handleAuthRequest(request('https://indago.greatstoneint.com', 'sign-in/email', { email: previewUsers.editor }), auth, env)).status, 404);
});

test('only seeded identities reach Better Auth on the preview host', async () => {
  assert.equal((await handleAuthRequest(request(previewHost, 'sign-in/email', { email: previewUsers.editor }), auth, env)).status, 200);
  assert.equal((await handleAuthRequest(request(previewHost, 'sign-in/email', { email: previewUsers.viewer }), auth, env)).status, 200);
  assert.equal((await handleAuthRequest(request(previewHost, 'sign-in/email', { email: 'other@example.test' }), auth, env)).status, 403);
  assert.equal((await handleAuthRequest(request(previewHost, 'sign-in/email', { email: 12 }), auth, env)).status, 403);
  assert.equal((await handleAuthRequest(request(previewHost, 'sign-up/email', { email: previewUsers.editor }), auth, env)).status, 404);
  assert.equal((await handleAuthRequest(request(previewHost, 'request-password-reset', { email: previewUsers.editor }), auth, env)).status, 404);
});

test('preview config exposes accounts only when active and leaves magic links available', async () => {
  const on = await handleAuthRequest(request(previewHost, 'preview-config'), auth, env);
  assert.deepEqual(await on.json(), { enabled: true, users: previewUsers });
  const off = await handleAuthRequest(request(previewHost, 'preview-config'), auth, {});
  assert.deepEqual(await off.json(), { enabled: false });
  assert.equal((await handleAuthRequest(request(previewHost, 'sign-in/magic-link', {}), auth, {})).status, 200);
});
