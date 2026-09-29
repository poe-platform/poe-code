import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';
import { basicCommands } from '../../src/commands/basic.js';
import { streamCommands } from '../../src/commands/streams.js';
import { createDiffPatchCommands, evalSyncDiff } from '../../src/commands/diff-patch/index.js';

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
