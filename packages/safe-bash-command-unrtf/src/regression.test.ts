import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenizeRtf } from './tokenizer.js';
import { renderRtf } from './render.js';
import { Budget } from './contracts.js';

async function* source(text: string) { yield new TextEncoder().encode(text); }
test('control words crossing a cooperative boundary remain intact', async () => {
  const name = 'a'.repeat(120);
  const tokens = [];
  for await (const token of tokenizeRtf(source('{\\rtf1 ' + 'x'.repeat(3980) + '\\' + name + '42 hello}'), {signal: new AbortController().signal})) {
    if (token.kind === 'control') tokens.push([token.name, token.parameter]);
  }
  assert.deepEqual(tokens, [['rtf', 1], [name, 42]]);
});
test('buffered plain text retains its storage reservation until emission', async () => {
  const options = {format: 'text' as const, signal: new AbortController().signal};
  const budget = new Budget(options);
  let retained = 0, peak = 0;
  const input = '{\\rtf1 ' + 'a\\tab '.repeat(100) + '}';
  const charge = budget.charge.bind(budget), release = budget.release.bind(budget);
  budget.charge = (resource, value, offset) => { charge(resource, value, offset); if (resource === 'retainedBytes') { retained += value; peak = Math.max(peak, retained); } };
  budget.release = (resource, value) => { release(resource, value); if (resource === 'retainedBytes') retained -= value; };
  let text = '';
  for await (const bytes of renderRtf(source(input), options, budget)) text += new TextDecoder().decode(bytes);
  assert.equal(text, 'a\t'.repeat(100));
  assert.ok(peak >= input.length + 600, `buffer reservation missing: ${peak}`);
  assert.equal(retained, 0);
});
test('cancellation never flushes buffered text', async () => {
  const controller = new AbortController();
  const options = {format: 'text' as const, signal: controller.signal};
  const budget = new Budget(options);
  const charge = budget.charge.bind(budget);
  let queued = false;
  budget.charge = (resource, value, offset) => {
    if (queued && resource === 'work') controller.abort();
    charge(resource, value, offset);
    if (resource === 'outputBytes') queued = true;
  };
  const output = renderRtf(source('{\\rtf1 a\\tab b}'), options, budget);
  await assert.rejects(output.next(), {code: 'E_CANCELLED'});
});
