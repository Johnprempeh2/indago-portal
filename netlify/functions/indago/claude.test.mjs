import test from 'node:test';
import assert from 'node:assert/strict';
import { askClaude, singleQuestion } from './claude.mjs';

test('AI is off without a server key, feature flag, and approved instructions', async () => {
  const fetcher = () => { throw new Error('should not call provider'); };
  assert.equal(await askClaude({ system: 'Approved', input: {} }, { enabled: false, key: 'test', fetcher }), null);
  assert.equal(await askClaude({ system: 'Approved', input: {} }, { enabled: true, key: '', fetcher }), null);
  assert.equal(await askClaude({ system: '', input: {} }, { enabled: true, key: 'test', fetcher }), null);
});

test('AI sends data and key only from server and accepts one complete question', async () => {
  let sent;
  const fetcher = async (url, options) => {
    sent = { url, options };
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'What evidence supports that view?' }] }));
  };
  const answer = await askClaude({ system: 'Approved', input: { answer: 'A client statement' } }, { enabled: true, key: 'test-key', fetcher });
  assert.equal(singleQuestion(answer), 'What evidence supports that view?');
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.options.headers['x-api-key'], 'test-key');
  assert.equal(JSON.parse(sent.options.body).model, 'claude-sonnet-5');
  assert.equal(JSON.parse(sent.options.body).messages[0].content, '{"answer":"A client statement"}');
});

test('invalid or incomplete model output falls back', async () => {
  assert.throws(() => singleQuestion('What first? What second?'));
  assert.throws(() => singleQuestion('Use the portal.'));
  assert.throws(() => singleQuestion('Should this be a portal?'));
  await assert.rejects(askClaude({ system: 'Approved', input: {} }, {
    enabled: true, key: 'test', fetcher: async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Partial?' }] })),
  }), /incomplete/);
});
