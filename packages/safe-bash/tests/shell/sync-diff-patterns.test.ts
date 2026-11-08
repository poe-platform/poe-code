import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';
import { basicCommands } from '../../src/commands/basic.js';
import { streamCommands } from '../../src/commands/streams.js';
import { createDiffPatchCommands, evalSyncDiff } from '../../src/commands/diff-patch/index.js';
import { syncCommandEvaluators } from '../../src/commands/internal.js';

test('shell diff uses the asynchronous document path for files and pipelines', async context => {
  assert.equal(syncCommandEvaluators.evalSyncDiff, undefined, 'buffered diff must remain an opt-in convenience API');
  const { fs, shell, commands } = setup();
  context.after(() => shell.dispose());
  for (const command of [...basicCommands(), ...streamCommands(), ...createDiffPatchCommands()]) commands.register(command);
  await fs.writeFile('/left', new TextEncoder().encode('same\nold\n'));
  await fs.writeFile('/right', new TextEncoder().encode('same\nnew\n'));
  for (const source of ['diff /left /right', 'diff /left /right | cat', 'cat /left | diff - /right', 'diff - /right < /left']) {
    const result = await shell.exec(source);
    assert.equal(result.stdout, '2c2\n< old\n---\n> new\n');
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, source.endsWith('| cat') ? 0 : 1);
  }
  const substitution = await shell.exec('result=$(diff /left /right); printf "%s\\n" "$result"');
  assert.equal(substitution.stdout, '2c2\n< old\n---\n> new\n');
  assert.equal(substitution.stderr, '');
  assert.equal(substitution.exitCode, 0);
});

test('sync diff delegates parsed basic patterns to the shared matcher', () => {
  const encoder = new TextEncoder();
  const files = new Map([['left',encoder.encode('stable\nAAA111\n')],['right',encoder.encode('stable\nAAA222\n')]]);
  assert.equal(evalSyncDiff(undefined,['-I','^AAA','left','right'],path => files.get(path)),undefined);
});

test('diff retains full basic regex behavior through the shared matcher', async context => {
  const {fs,shell,commands} = setup();
  context.after(() => shell.dispose());
  for (const command of [...basicCommands(),...streamCommands(),...createDiffPatchCommands()]) commands.register(command);
  await fs.writeFile('/left',new TextEncoder().encode('stable\nignored one\n'));
  await fs.writeFile('/right',new TextEncoder().encode('stable\nignored two\n'));
  const result = await shell.exec("diff -I '^ignored.*' /left /right | cat");
  assert.equal(result.exitCode,0,result.stderr);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr,'');
});

test('sync diff preserves nonignored changes when repeated ignored lines dominate alignment', () => {
  const encoder = new TextEncoder();
  const files = new Map([['left',encoder.encode('ignored a\n'.repeat(5) + 'keep\n' + 'ignored b\n'.repeat(5))],['right',encoder.encode('ignored b\n'.repeat(5) + 'keep\n' + 'ignored a\n'.repeat(5))]]);
  assert.equal(evalSyncDiff(undefined,['-I','^ignored','left','right'],path => files.get(path)),undefined);
});

test('ignored regex lines cannot suppress nonmatching changes in a shell pipeline', async context => {
  const {fs,shell,commands} = setup();
  context.after(() => shell.dispose());
  for (const command of [...basicCommands(),...streamCommands(),...createDiffPatchCommands()]) commands.register(command);
  await fs.writeFile('/left',new TextEncoder().encode('stable\nignored one\nreal-left\n'));
  await fs.writeFile('/right',new TextEncoder().encode('stable\nignored two\nreal-right\n'));
  const result = await shell.exec("set -o pipefail; diff -I '^ignored.*' /left /right | cat");
  assert.equal(result.exitCode,1,result.stderr);
  assert.ok(result.stdout.includes('real-left') && result.stdout.includes('real-right'));
  assert.equal(result.stderr,'');
});
