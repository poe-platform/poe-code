import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvOptions } from '../../src/commands/env-split.js';
const signal = new AbortController().signal;
test('env split admits arguments and bytes above the former fixed ceilings', async () => {
  const result = await parseEnvOptions(['-S', 'echo ' + 'x '.repeat(10001)], {}, signal);
  assert.equal(result.operands.length, 10002);
  await assert.doesNotReject(parseEnvOptions(['-S', 'echo ' + 'x'.repeat(131073)], {}, signal));
});
test('env split enforces host-selected limits', async () => {
  await assert.rejects(parseEnvOptions(['-S', 'echo x'], {}, signal, undefined, { arguments: 1 }), /argument limit/);
});

test('env split admits more than thirty-two expansions unless explicitly bounded', async () => {
  const source = '-S '.repeat(33) + 'echo';
  await assert.doesNotReject(parseEnvOptions(['-S', source], {}, signal));
  await assert.rejects(parseEnvOptions(['-S', source], {}, signal, undefined, { expansions: 32 }), /expansion limit/);
});
