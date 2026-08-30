import assert from 'node:assert/strict';
import { Shell, agentCommands, createMemoryFileSystem, writeText } from '../../../src/index.ts';
import { EnvSplitError, parseEnvOptions } from '../../../src/commands/env-split.ts';

let checks = 0;
const signal = new AbortController().signal;
const parse = (source, env = {}) => parseEnvOptions(['-S', source], env, signal);
const exact = await parse(`rec ${'x'.repeat(65532)}`);
assert.equal(exact.operands[1].length, 65532);
checks++;
await assert.rejects(parse(`rec ${'x'.repeat(65533)}`), error => error instanceof EnvSplitError && error.message === 'split-string byte limit exceeded (131072)');
checks++;
const unicodeCount = 16383;
assert.equal((await parse(`rec ${'🙂'.repeat(unicodeCount)}`)).operands[1], '🙂'.repeat(unicodeCount));
checks++;
assert.equal((await parse(`rec ${'x '.repeat(9999)}`)).operands.length, 10000);
checks++;
await assert.rejects(parse(`rec ${'x '.repeat(10000)}`), error => error instanceof EnvSplitError && error.message === 'split-string argument limit exceeded (10000)');
checks++;
await assert.rejects(parse('${LOOP}', { LOOP: '-S ${LOOP}' }), error => error instanceof EnvSplitError && error.message === 'split-string expansion limit exceeded (32)');
checks++;
await assert.rejects(parse('rec ${VALUE}', { VALUE: 'before\0after' }), error => error instanceof EnvSplitError && error.message === 'NUL is not supported in -S strings');
checks++;

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const controller = new AbortController();
const reason = Object.freeze({ kind: 'cancel-during-env-parser' });
let dispatched = 0;
let enteredEnv = 0;
shell.use(async (context, next) => {
  if (context.command === 'env') { enteredEnv++; setImmediate(() => controller.abort(reason)); }
  return next();
});
shell.register({ name: 'report', execute() { dispatched++; return { exitCode: 0 }; } });
try {
  await assert.rejects(shell.exec(`env -S 'report ${'x'.repeat(50000)}'`, { signal: controller.signal }), error => error === reason);
  assert.equal(enteredEnv, 1); assert.equal(dispatched, 0);
  checks++;
} finally { await shell.dispose(); }

const compatible = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
compatible.register({ name: 'large', execute: context => context.invoke('env', [`VALUE=${'x'.repeat(1100000)}`, 'measure']) });
compatible.register({ name: 'measure', async execute(context) {
  await writeText(context.stdout, String(context.env.VALUE.length));
  return { exitCode: 0 };
} });
try {
  const result = await compatible.exec('large');
  assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, '1100000', '']);
  checks++;
  const malformed = await compatible.exec("env -0 -C /absent -S 'measure'");
  assert.deepEqual([malformed.exitCode, malformed.stdout, malformed.stderr], [2, '', 'env: cannot specify --null with a command\n']);
  checks++;
} finally { await compatible.dispose(); }
console.log(JSON.stringify({ checks }));
