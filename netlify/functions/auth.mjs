import { auth } from './lib/auth.mjs';
import { handleAuthRequest } from './lib/preview-login.mjs';

export default async function handler(request) {
  return handleAuthRequest(request, auth);
}

export const config = { path: '/api/auth/*' };
