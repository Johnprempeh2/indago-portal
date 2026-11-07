import { db } from './lib/db.mjs';
import { deepDiveMcpRpc } from './indago/mcp-db.mjs';
import { createDeepDiveMcp, MAX_BODY_BYTES } from './indago/mcp.mjs';

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex' };

export function makeDeepDiveMcpHandler({ pool = () => db.pool, log = console.error } = {}) {
  return async (request) => {
    if (request.method === 'POST' && Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
      return Response.json({ error: 'The request is too large.' }, { status: 413, headers: HEADERS });
    }
    const server = createDeepDiveMcp({ rpc: (name, params) => deepDiveMcpRpc(pool(), name, params), log });
    try {
      const text = request.method === 'POST' ? await request.text() : '';
      const out = await server.handle({ method: request.method, headers: request.headers, text });
      return new Response(out.body, { status: out.status, headers: { ...out.headers, ...HEADERS } });
    } catch (error) {
      log('deep-dive-mcp: request failed (' + (error?.code || error?.name || 'error') + ')');
      return Response.json({ error: 'Deep Dive tools unavailable. Try again.' }, { status: 503, headers: HEADERS });
    }
  };
}

export default makeDeepDiveMcpHandler();
export const config = { path: '/api/deep-dive-mcp' };
