import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEndpoint, messageFields, buildInput, replyText } from '../simple-ai-chat/chat.mjs';

const schema = { type: 'object', properties: { prompt: { type: 'string', maxLength: 100 }, temperature: { type: 'number', minimum: 0, maximum: 2 } }, required: ['prompt', 'temperature'], additionalProperties: false };
test('chat maps a message and typed extra inputs to the published workflow contract', () => {
  assert.deepEqual(messageFields({ input_schema: schema }), ['prompt']);
  assert.deepEqual(buildInput(' Hello ', 'prompt', '{"temperature":0.5,"prompt":"overridden"}', schema), { temperature: 0.5, prompt: 'Hello' });
  for (const extra of ['[]', 'oops', '{}', '{"temperature":"hot"}', '{"temperature":3}', '{"temperature":1,"unknown":true}']) assert.throws(() => buildInput('Hi', 'prompt', extra, schema));
  assert.throws(() => buildInput(' ', 'prompt', '{"temperature":1}', schema));
  assert.throws(() => buildInput('Hi', 'temperature', '{}', schema));
});
test('chat endpoint auto-detection and supplied endpoints stay bound to the scoped action and runtime', () => {
  const path = '/v1/actions/ai.chat/versions/1/runs';
  assert.equal(resolveEndpoint('', 'http://127.0.0.1:4317', 'ai.chat'), path);
  assert.equal(resolveEndpoint('http://127.0.0.1:4317' + path, 'http://127.0.0.1:4317', 'ai.chat'), path);
  for (const value of ['http://127.0.0.1:4318' + path, 'https://example.com' + path, '/v1/actions/other/versions/1/runs', '/studio/export']) assert.throws(() => resolveEndpoint(value, 'http://127.0.0.1:4317', 'ai.chat'));
});
test('chat replies preserve text and structured output and never fabricate missing answers', () => {
  assert.equal(replyText({ answer: '<script>alert(1)</script>' }, 'answer'), '<script>alert(1)</script>');
  assert.equal(replyText({ answer: { text: 'Hello' } }, 'answer'), '{\n  "text": "Hello"\n}');
  assert.equal(replyText({ count: 0 }, 'count'), '0');
  assert.equal(replyText({ answer: 'Hi' }, ''), '{\n  "answer": "Hi"\n}');
  assert.throws(() => replyText({ different: 'Hi' }, 'answer'));
});
