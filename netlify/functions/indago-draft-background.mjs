// Background function: Netlify answers 202 at once and lets this run up to 15 minutes,
// so the 25-30 s AI draft no longer has to fit inside the submit request (GRE-3641).
import { writeAiDraft } from './indago/interview.mjs';

export async function draftHandler(request, { getSession, member, write = writeAiDraft }) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (request.method !== 'POST' || process.env.INDAGO_OPEN_ACCESS === 'true' || !/^[0-9a-f-]{36}$/.test(id)) return 'rejected';
  const session = await getSession(request.headers);
  if (!session?.user?.id) return 'rejected';
  const transaction = async work => {
    const result = await member(session, client => work(client));
    if (result instanceof Response) throw new Error('AI draft database step failed.');
    return result;
  };
  try { return await write(id, session.user.id, transaction); }
  catch (error) { console.warn('Indago AI draft failed', error?.message === 'AI draft database step failed.' ? error.message : error?.name); return 'failed'; }
}

export default async function handler(request) {
  // Imported here so tests can load this file without a database connection.
  const [{ auth }, { withMember }] = await Promise.all([import('./lib/auth.mjs'), import('./indago.mjs')]);
  await draftHandler(request, { getSession: headers => auth.api.getSession({ headers }), member: withMember });
}
