import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { managedBrowserInstallation } from '../server/managed-profile.mjs';
import { validateOutputMappings, browserOutputMapping, usesStructuredExtraction } from '../server/output-mappings.mjs';
import { convertOutputs, validateConvertedOutputs, outputJsonSchema, validateWorkflowContract } from '../server/workflow-contract.mjs';
import { extractOutputDocument } from '../companion/browser/output-extraction.mjs';

const mapping = field => validateOutputMappings([{ name: 'result', selector: '#result', ...field }]);
const rejected = (fn, reason, path) => assert.throws(fn, error => {
  assert.equal(error.message, 'VERIFICATION_FAILED'); assert.equal(error.verification.reason, reason);
  if (path) assert.deepEqual(error.verification.path, path);
  assert.ok(!JSON.stringify(error).includes('PRIVATE_MALFORMED_VALUE')); return true;
});

test('null-only output mappings have an exact JSON null schema and never invent missing required values', () => {
  const fields = mapping({ type: 'null' });
  assert.deepEqual(outputJsonSchema(fields).properties.result, { type: 'null' });
  assert.deepEqual(convertOutputs(fields, { result: null }), { result: null });
  assert.deepEqual(convertOutputs(fields, { result: ' null ' }), { result: null });
  assert.equal(validateConvertedOutputs(fields, { result: null }).result, null);
  assert.deepEqual(convertOutputs(mapping({ type: 'null', required: false }), {}), {});
  rejected(() => convertOutputs(fields, {}), 'missing_output');
  for (const value of ['', 'none', false, 0, {}, []]) rejected(() => convertOutputs(fields, { result: value }), 'invalid_null', ['result']);
  rejected(() => validateConvertedOutputs(fields, { result: 'null' }), 'invalid_null', ['result']);
  const strict = mapping({ type: 'null', coercion: 'strict', enum: [null] });
  assert.deepEqual(outputJsonSchema(strict).properties.result, { type: 'null', enum: [null], 'x-hermo-coercion': 'strict' });
  assert.deepEqual(convertOutputs(strict, { result: null }), { result: null });
  rejected(() => convertOutputs(strict, { result: 'null' }), 'invalid_null', ['result']);
  rejected(() => convertOutputs(fields, { result: ' '.repeat(5000) + 'null' }), 'output_limit');
  assert.equal(usesStructuredExtraction(fields[0]), true);
  assert.equal(browserOutputMapping(fields[0]).type, 'null');
});

test('explicit scalar coercion preserves legacy decimal behavior and strict native JSON types', () => {
  for (const coercion of [undefined, 'legacy']) {
    const fields = mapping({ type: 'integer', ...coercion ? { coercion } : {} });
    assert.deepEqual(convertOutputs(fields, { result: '2.0' }), { result: 2 });
    rejected(() => convertOutputs(fields, { result: '$2 PRIVATE_MALFORMED_VALUE' }), 'invalid_number');
    rejected(() => convertOutputs(fields, { result: 2 }), 'missing_output');
  }
  for (const [type, valid, text] of [['number', 1.25, '1.25'], ['integer', 2, '2'], ['boolean', false, 'false']]) {
    const fields = mapping({ type, coercion: 'strict' });
    assert.deepEqual(convertOutputs(fields, { result: valid }), { result: valid });
    assert.equal(validateConvertedOutputs(fields, { result: valid }).result, valid);
    rejected(() => convertOutputs(fields, { result: text }), type === 'boolean' ? 'invalid_boolean' : 'invalid_number', ['result']);
    assert.equal(outputJsonSchema(fields).properties.result['x-hermo-coercion'], 'strict');
  }
  rejected(() => convertOutputs(mapping({ type: 'integer', coercion: 'strict' }), { result: 1.5 }), 'invalid_integer', ['result']);
  rejected(() => convertOutputs(mapping({ type: 'number', coercion: 'strict' }), { result: Infinity }), 'invalid_number', ['result']);
  assert.equal(convertOutputs(mapping({ coercion: 'strict' }), { result: ' unicode 😀 ' }).result, ' unicode 😀 ');
  rejected(() => convertOutputs(mapping({ type: 'url', coercion: 'strict' }), { result: ' https://example.com ' }), 'invalid_url');
  assert.ok(!Object.hasOwn(outputJsonSchema(mapping({ type: 'number' })).properties.result, 'x-hermo-coercion'), 'historical schemas retain their original shape');
});

test('mapping validation rejects coercion on collections and invalid null constraints', () => {
  for (const field of [{ type: 'null', nullable: true }, { type: 'null', read_attribute: 'alt' }, { type: 'null', enum: ['null'] }, { type: 'null', enum: [null, null] }, { type: 'null', minimum: 0 }, { type: 'null', minLength: 1 }, { type: 'number', enum: [null] }, { type: 'boolean', enum: [null] }, { type: 'string', enum: [null] }, { type: 'number', coercion: true }, { type: 'number', coercion: 'guess' }, { type: 'object', fields: [{ name: 'value', selector: '.value' }], coercion: 'strict' }, { type: 'array', items: { type: 'string' }, coercion: 'legacy' }]) {
    assert.throws(() => mapping(field), { message: 'INVALID_OUTPUT_MAPPINGS' }, JSON.stringify(field));
  }
});

const nested = () => validateOutputMappings([{ name: 'catalog', type: 'object', selector: '#catalog', fields: [
  { name: 'rows', type: 'array', selector: '.row', minItems: 0, maxItems: 3, items: { type: 'object', fields: [
    { name: 'title', selector: '.title' }, { name: 'price', type: 'number', selector: '.price', coercion: 'legacy' },
    { name: 'tags', type: 'array', selector: '.tag', minItems: 0, maxItems: 3, items: { type: 'string' } },
    { name: 'note', selector: '.note', required: false }, { name: 'next_page', type: 'null', selector: '.next' },
  ] } },
  { name: 'optional_group', type: 'object', selector: '.absent', required: false, fields: [{ name: 'name', selector: '.name' }] },
  { name: 'nullable_group', type: 'object', selector: '.absent', nullable: true, fields: [{ name: 'name', selector: '.name' }] },
] }]);

test('mixed nested null, optional fields and empty collections retain declared structure and schema', () => {
  const fields = nested(), raw = { catalog: { rows: [{ title: 'Unicode 😀', price: '1.25', tags: [], next_page: 'null', ignored: 'private' }] } };
  const result = convertOutputs(fields, raw);
  assert.deepEqual(result, { catalog: { rows: [{ title: 'Unicode 😀', price: 1.25, tags: [], next_page: null }], nullable_group: null } });
  assert.equal(validateConvertedOutputs(fields, result), result);
  const schema = outputJsonSchema(fields), row = schema.properties.catalog.properties.rows.items;
  assert.equal(row.properties.next_page.type, 'null'); assert.equal(row.properties.price['x-hermo-coercion'], 'legacy');
  assert.equal(row.properties.tags.minItems, 0); assert.ok(!row.required.includes('note')); assert.ok(row.required.includes('next_page'));
  const definition = { inputs: {}, outputs: fields, steps: [], verifiers: [] };
  assert.deepEqual(validateWorkflowContract(JSON.parse(JSON.stringify(definition))).outputs, fields);
  assert.deepEqual(convertOutputs(fields, { catalog: { rows: [] } }), { catalog: { rows: [], nullable_group: null } });
  delete raw.catalog.rows[0].next_page; rejected(() => convertOutputs(fields, raw), 'missing_output', ['catalog', 'rows', 0, 'next_page']);
  rejected(() => validateConvertedOutputs(fields, { catalog: { rows: [{ title: 'A', price: 1, tags: [], next_page: null, extra: true }], nullable_group: null } }), 'invalid_structure', ['catalog', 'rows', 0]);
});

test('actual DOM extraction keeps nested relative scopes, explicit null text and empty collections, with strict conversion failures', { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: managedBrowserInstallation().executablePath });
  try {
    const page = await browser.newPage();
    await page.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><h1>Controlled catalog fixture</h1><section id="catalog" style="min-height:20px"><article class="row"><h2 class="title">Unicode 😀</h2><span class="price">1.25</span><span class="next">null</span></article></section>' }));
    await page.goto('https://example.com/catalog');
    const fields = nested(), read = mapping => page.evaluate(extractOutputDocument, { mapping, origin: 'https://example.com', path_prefix: '/' });
    const observed = await read(browserOutputMapping(fields[0])); assert.equal(observed.hermo_error, undefined);
    assert.deepEqual(convertOutputs(fields, { catalog: observed.value }), { catalog: { rows: [{ title: 'Unicode 😀', price: 1.25, tags: [], next_page: null }], nullable_group: null } });
    const strict = structuredClone(fields); strict[0].fields[0].items.fields.find(field => field.name === 'price').coercion = 'strict';
    rejected(() => convertOutputs(strict, { catalog: observed.value }), 'invalid_number', ['catalog', 'rows', 0, 'price']);
    strict[0].fields[0].items.fields.find(field => field.name === 'price').coercion = 'legacy'; strict[0].fields[0].items.fields.find(field => field.name === 'next_page').coercion = 'strict';
    rejected(() => convertOutputs(strict, { catalog: observed.value }), 'invalid_null', ['catalog', 'rows', 0, 'next_page']);
    await page.locator('.next').evaluate(element => element.textContent = 'PRIVATE_MALFORMED_VALUE');
    const malformed = await read(browserOutputMapping(fields[0])); rejected(() => convertOutputs(fields, { catalog: malformed.value }), 'invalid_null', ['catalog', 'rows', 0, 'next_page']);
    await page.locator('.row').evaluate(element => element.remove());
    const empty = await read(browserOutputMapping(fields[0])); assert.deepEqual(convertOutputs(fields, { catalog: empty.value }), { catalog: { rows: [], nullable_group: null } });
  } finally { await browser.close(); }
});
