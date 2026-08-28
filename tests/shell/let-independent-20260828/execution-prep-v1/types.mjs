import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { supervise } from './protocol.mjs';

export async function checkTypes({ node, compiler, typeRoots, consumer, harnessRoot, env, record }) {
  const flags = ['--noEmit', '--strict', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023', '--types', 'node', '--typeRoots', typeRoots];
  const rows = [
    ['consumer', null, null],
    ['negative-limit', '2322', source => source.replace("'1024'", '1024')],
    ['negative-api', '2305', source => source.replaceAll('createLetCommands', 'Shell')],
  ];
  const outcomes = [];
  for (const [name, diagnostic, neutralize] of rows) {
    const target = join(consumer, `${name}.mts`); copyFileSync(join(harnessRoot, `${name}.mts.fixture`), target);
    const run = await supervise(node, [compiler, ...flags, ...(diagnostic ? [] : ['--traceResolution']), target], { cwd: consumer, env, timeoutMs: 60000, maxBytes: 8 * 1024 * 1024 });
    record(`types-${name}`, run);
    assert.equal(run.failure, null); assert.equal(run.signal, null); assert.equal(run.spawnError, null); assert.equal(run.groupAbsent, true);
    const codes = [...(run.stdout + run.stderr).matchAll(/error TS(\d+):/gu)].map(match => match[1]);
    assert.deepEqual(codes, diagnostic ? [diagnostic] : []); assert.equal(run.code, diagnostic ? 2 : 0);
    if (!diagnostic) assert.ok(run.stdout.includes(join(consumer, 'node_modules/virtual-bash/dist/index.d.ts')), 'actual current package declaration resolution');
    else {
      assert.ok((run.stdout + run.stderr).includes(diagnostic === '2305' ? 'createLetCommands' : 'not assignable'));
      const fixed = join(consumer, `${name}-neutralized.mts`); writeFileSync(fixed, neutralize(readFileSync(target, 'utf8')), { flag: 'wx' });
      const control = await supervise(node, [compiler, ...flags, fixed], { cwd: consumer, env, timeoutMs: 60000, maxBytes: 1024 * 1024 }); record(`types-${name}-neutralized`, control);
      assert.equal(control.code, 0); assert.equal(control.signal, null); assert.equal(control.failure, null); assert.equal(control.spawnError, null); assert.equal(control.groupAbsent, true);
    }
    outcomes.push({ name, expectedDiagnostic: diagnostic, accepted: true });
  }
  return outcomes;
}
