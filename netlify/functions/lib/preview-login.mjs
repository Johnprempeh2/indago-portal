export const previewUsers = Object.freeze({
  editor: 'indago-preview-editor@example.test',
  viewer: 'indago-preview-viewer@example.test',
});

export function previewLoginAllowed(request, env = process.env) {
  const url = new URL(request.url);
  return env.INDAGO_TEST_LOGIN === '1' &&
    env.INDAGO_TEST_LOGIN_HOST === 'greatstone-indago-portal.netlify.app' &&
    url.protocol === 'https:' &&
    url.hostname === env.INDAGO_TEST_LOGIN_HOST;
}

export async function handleAuthRequest(request, auth, env = process.env) {
  const path = new URL(request.url).pathname;
  const allowed = previewLoginAllowed(request, env);
  if (path === '/api/auth/preview-config') {
    return Response.json({ enabled: allowed, users: allowed ? previewUsers : undefined },
      { headers: { 'Cache-Control': 'no-store' } });
  }
  if (path === '/api/auth/sign-in/email') {
    if (!allowed || request.method !== 'POST') return new Response(null, { status: 404 });
    let body;
    try { body = await request.clone().json(); } catch { return new Response(null, { status: 400 }); }
    if (typeof body?.email !== 'string' ||
        !Object.values(previewUsers).includes(body.email.toLowerCase())) {
      return new Response(null, { status: 403 });
    }
  }
  if (path === '/api/auth/sign-up/email' || path.includes('password')) {
    return new Response(null, { status: 404 });
  }
  return auth.handler(request);
}
