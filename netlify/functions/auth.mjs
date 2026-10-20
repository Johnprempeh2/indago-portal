import { auth } from './lib/auth.mjs';

export default async function handler(request) {
  return auth.handler(request);
}

export const config = { path: '/api/auth/*' };
