// Server only. The caller supplies approved instructions; participant text is data.
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// The preview site stores the key as `Anthropic_API_Key`. Read it first: when the standard name is not
// set on the site, Netlify fills `ANTHROPIC_API_KEY` with its AI Gateway token, which Anthropic rejects.
export const anthropicKey = (env = process.env) => env.Anthropic_API_Key || env.ANTHROPIC_API_KEY || '';

// Describes the key without revealing it, so a rejected key can be traced to its setting.
export function keyShape(env = process.env) {
  const name = env.Anthropic_API_Key ? 'Anthropic_API_Key' : env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : null;
  const value = name ? env[name] : '';
  return { name, length: value.length, prefix: value.startsWith('sk-ant-'), trimmed: value === value.trim(), quoted: /^["']|["']$/.test(value) };
}

export async function askClaude({ system, input, maxTokens = 400 }, {
  key = anthropicKey(),
  enabled = process.env.INDAGO_AI_INTERVIEW === 'true' &&
    Boolean(process.env.INDAGO_AI_QUESTION_PROMPT && process.env.INDAGO_AI_CHALLENGE_PROMPT && process.env.INDAGO_AI_DRAFT_PROMPT),
  fetcher = fetch,
} = {}) {
  if (!enabled || !key || !system) {
    console.info('Indago AI off', JSON.stringify({ enabled, key: Boolean(key), prompt: Boolean(system) }));
    return null;
  }
  const response = await fetcher(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      // No temperature: claude-sonnet-5 rejects it as deprecated (400).
      model: 'claude-sonnet-5', max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) console.warn('Indago AI key shape', JSON.stringify(keyShape()));
  if (!response.ok) throw new Error(`AI service unavailable (${response.status}).`);
  const data = await response.json();
  if (data.stop_reason !== 'end_turn') throw new Error('AI response incomplete.');
  const content = data.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
  if (!content) throw new Error('AI response empty.');
  return content;
}

// Logs only our own fixed messages or the error class, never model or participant text.
export function aiFallbackReason(error) {
  const message = String(error?.message || '');
  return /^AI [a-z ]+(?: \(\d{3}\))?\.$/.test(message) ? message : String(error?.name || 'Error');
}

export const logAiFallback = (step, error) => console.warn('Indago AI fallback', step, aiFallbackReason(error));

export function parseAiJson(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI response invalid.');
  return value;
}

export function singleQuestion(question, participantText = '', allowBoundaryAi = false) {
  const value = question?.trim();
  if (!value || value.length > 300 || !value.endsWith('?') || value.split('?').length !== 2 || /[\r\n]/.test(value)) {
    throw new Error('AI question invalid.');
  }
  const banned = /\b(?:portal|platform|artificial intelligence|app|dashboard|software|automation tools?)s?\b|\bAI\b/gi;
  for (const match of value.matchAll(banned)) {
    const term = match[0];
    if (term.toUpperCase() === 'AI' && term !== 'AI') continue;
    if (allowBoundaryAi && term === 'AI' && /^Which uses of AI should be rejected\?$/i.test(value)) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${escaped}\\b`, 'i').test(participantText)) throw new Error('AI question leads the participant.');
  }
  return value;
}

export const escapeParticipant = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function interviewTranscript(answers) {
  return answers.flatMap(answer => [
    `<participant_answer id="${answer.id}" move="${answer.move}">${escapeParticipant(answer.original)}</participant_answer>`,
    ...(answer.challenges || []).filter(challenge => challenge.reply).map((challenge, index) =>
      `<participant_answer id="${answer.id}" move="${answer.move}" challenge="${index + 1}">${escapeParticipant(challenge.reply)}</participant_answer>`),
  ]).join('\n');
}
