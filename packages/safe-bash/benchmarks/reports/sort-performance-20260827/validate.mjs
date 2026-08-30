import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const own = dirname(import.meta.filename), root = (await readFile(process.env.SORT_STATE ?? join(own, 'scratch-path.txt'), 'utf8')).trim();
const destination = join(process.env.SORT_REPORT ?? join(own, 'evidence'), process.argv[2] ?? 'validation-final');
await mkdir(destination);
await cp(join(own, 'holdouts.mjs'), join(root, 'harness/holdouts.mjs'));
const commands = [];
for (const variant of ['base', 'candidate']) {
  for (const [label, args] of [
    ['build', [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json']],
    ['unchanged-core100', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=30000',
      'tests/commands/core-regression-stress/native.test.ts', 'tests/commands/core-regression-stress/resources.test.ts', 'tests/commands/core-regression-stress/runtime.test.ts']],
    ['adjacent-sort-expanded', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=30000',
      'tests/commands/core-sort/regressions.test.ts', 'tests/commands/core-expanded/regressions.test.ts']],
    ['fresh-heldouts', ['--unhandled-rejections=strict', '--test', '--test-concurrency=1', '--test-timeout=30000', join(root, 'harness/holdouts.mjs')]],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: join(root, variant), env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: join(root, 'tmp'), LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', SORT_ROOT: root, SORT_VARIANT: variant },
      encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 });
    await writeFile(join(destination, `${variant}-${label}.stdout`), result.stdout ?? '', { flag: 'wx' });
    await writeFile(join(destination, `${variant}-${label}.stderr`), result.stderr ?? '', { flag: 'wx' });
    const counts = Object.fromEntries([...(result.stdout ?? '').matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    commands.push({ variant, label, args, pid: result.pid, status: result.status, signal: result.signal, counts, error: result.error?.message });
    console.log(variant, label, result.status, counts);
    assert.ifError(result.error); assert.equal(result.signal, null);
  }
}
await writeFile(join(destination, 'validation.json'), JSON.stringify(commands, null, 2) + '\n', { flag: 'wx' });
