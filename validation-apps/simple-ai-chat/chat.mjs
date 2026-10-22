import { actionPath, parseInput, validateInput } from '../shared/client.mjs';

export function resolveEndpoint(value, runtime, action) {
  if (value.startsWith('http')) {
    const url = new URL(value);
    if (url.origin !== new URL(runtime).origin) throw Error('The endpoint must use the configured runtime: ' + runtime);
  }
  const path = actionPath(value || `/v1/actions/${action}/versions/1/runs`);
  if (path !== `/v1/actions/${action}/versions/1/runs`) throw Error('This endpoint does not match the workflow authorized by the key.');
  return path;
}

export function messageFields(contract) {
  return Object.entries(contract.input_schema?.properties ?? {}).filter(([, rule]) => rule.type === 'string').map(([name]) => name);
}

export function buildInput(message, field, extra, schema) {
  if (!message.trim()) throw Error('Write a message first.');
  if (!field || schema?.properties?.[field]?.type !== 'string') throw Error('Choose a string input for your message.');
  return validateInput({ ...parseInput(extra), [field]: message.trim() }, schema);
}

export function replyText(result, field) {
  const value = field ? result?.[field] : result;
  if (value === undefined || value === null) throw Error('The selected reply output is missing. Inspect the raw response and select another output.');
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
