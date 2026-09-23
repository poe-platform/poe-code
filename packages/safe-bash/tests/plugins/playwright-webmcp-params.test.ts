import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWebMCPParams } from '../../src/playwright/webmcp-params.js';
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';

test('WebMCP parameter preflight bounds nodes and depth before native parsing', () => {
  const sources = [
    '{"items":[' + '{},'.repeat(10000) + '{}]}',
    '{"items":[' + '0,'.repeat(10000) + '0]}',
    '{' + '"duplicate":0,'.repeat(5000) + '"duplicate":0}',
    '{"items":' + '['.repeat(64) + '0' + ']'.repeat(64) + '}',
  ];
  const parse = JSON.parse;
  let parsed = false;
  JSON.parse = () => { parsed = true; throw new Error('must reject before parsing'); };
  try {
    for (const source of sources) assert.throws(() => parseWebMCPParams(source), PlaywrightResourceLimitError);
    assert.equal(parsed, false);
  } finally { JSON.parse = parse; }
});

test('WebMCP parameter preflight enforces UTF-8 bytes and smaller command budgets', () => {
  const source = '{"text":"é"}';
  const bytes = new TextEncoder().encode(source).byteLength;
  assert.deepEqual(parseWebMCPParams(source, bytes), { text: 'é' });
  assert.throws(() => parseWebMCPParams(source, bytes - 1), /parameter byte limit/);
  assert.throws(() => parseWebMCPParams('{"text":"' + 'x'.repeat(1024 * 1024) + '"}', 16 * 1024 * 1024), /parameter byte limit/);
});

test('WebMCP parameter preflight accepts boundary graphs and escaped string punctuation', () => {
  const source = JSON.stringify({ text: '\\"{}[],:\n', items: [null, true, false, -1.5e20, { nested: [] }] });
  assert.deepEqual(parseWebMCPParams(source), JSON.parse(source));
  const nodes = '{"items":[' + '0,'.repeat(9996) + '0]}';
  assert.equal((parseWebMCPParams(nodes).items as unknown[]).length, 9997);
  const depth = '{"items":' + '['.repeat(63) + '0' + ']'.repeat(63) + '}';
  assert.deepEqual(parseWebMCPParams(depth), JSON.parse(depth));
});

test('WebMCP parameter preflight preserves native JSON syntax and object validation', () => {
  for (const source of ['{"a":}', '{"a":01}', '{"a":"\\q"}', '{"a":0,}', '{"a":0} trailing', '{"a":"unterminated']) assert.throws(() => parseWebMCPParams(source), SyntaxError);
  for (const source of ['[]', 'null', 'true', '1', '"text"']) assert.throws(() => parseWebMCPParams(source), /JSON object/);
  assert.deepEqual(parseWebMCPParams('{}'), {});
});
