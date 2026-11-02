// Server only. The caller supplies approved instructions; participant text is data.
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export async function askClaude({ system, input, maxTokens = 700 }, {
  key = process.env.ANTHROPIC_API_KEY,
  enabled = process.env.INDAGO_AI_INTERVIEW === 'true' &&
    Boolean(process.env.INDAGO_AI_QUESTION_PROMPT && process.env.INDAGO_AI_CHALLENGE_PROMPT && process.env.INDAGO_AI_DRAFT_PROMPT),
  fetcher = fetch,
} = {}) {
  if (!enabled || !key || !system) return null;
  const response = await fetcher(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5', max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('AI service unavailable.');
  const data = await response.json();
  if (data.stop_reason !== 'end_turn') throw new Error('AI response incomplete.');
  const content = data.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
  if (!content) throw new Error('AI response empty.');
  return content;
}

export function singleQuestion(text) {
  const question = text?.trim();
  if (!question || question.length > 500 || !question.endsWith('?') || question.split('?').length !== 2 ||
    /[\r\n]/.test(question) || /\bportal\b|\bAI (?:product|platform)\b/i.test(question)) {
    throw new Error('AI question invalid.');
  }
  return question;
}
