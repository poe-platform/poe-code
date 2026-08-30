import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { supervise } from '../execution-prep-v1/protocol.mjs';

export async function checkApiDiagnostic({ node, compiler, typeRoots, consumer, env, record }) {
  const flags = ['--noEmit', '--strict', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023', '--types', 'node', '--typeRoots', typeRoots];
  const diagnostic = `negative-api.mts(1,10): error TS2724: '"virtual-bash"' has no exported member named 'createLetCommands'. Did you mean 'createFileCommands'?\n`;
  const target = join(consumer, 'negative-api.mts');
  assert.equal(readFileSync(target, 'utf8'), "import { createLetCommands } from 'virtual-bash';\nvoid createLetCommands;\n");
  const run = await supervise(node, [compiler, ...flags, target], { cwd: consumer, env, timeoutMs: 60000, maxBytes: 1024 * 1024 });
  record('types-v2-exact-api', run);
  assert.equal(run.code, 2); assert.equal(run.stdout, diagnostic); assert.equal(run.stderr, '');
  assert.equal(run.failure, null); assert.equal(run.signal, null); assert.equal(run.spawnError, null); assert.equal(run.groupAbsent, true);
  const fixed = join(consumer, 'negative-api-neutralized.mts');
  writeFileSync(fixed, readFileSync(target, 'utf8').replaceAll('createLetCommands', 'Shell'), { flag: 'wx' });
  const positive = await supervise(node, [compiler, ...flags, fixed], { cwd: consumer, env, timeoutMs: 60000, maxBytes: 1024 * 1024 });
  record('types-v2-exact-api-neutralized', positive);
  assert.equal(positive.code, 0); assert.equal(positive.stdout, ''); assert.equal(positive.stderr, '');
  assert.equal(positive.failure, null); assert.equal(positive.signal, null); assert.equal(positive.spawnError, null); assert.equal(positive.groupAbsent, true);
  for (const changed of [diagnostic.replace('2724', '2305'), diagnostic.replace('(1,10)', '(2,10)'), diagnostic.replace('createLetCommands', 'unrelated'), diagnostic + diagnostic]) assert.notEqual(changed, diagnostic);
  return { exactDiagnostic: diagnostic, negativeExit: 2, neutralizedExit: 0, accepted: true };
}
