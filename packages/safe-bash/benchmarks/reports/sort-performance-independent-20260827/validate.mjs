import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { supervise } from '../../../tests/integration/full-gate-20260827/supervise.mjs';

const own = dirname(import.meta.filename), root = (await readFile(process.env.SORT_STATE, 'utf8')).trim();
const output = join(process.env.SORT_REPORT, process.argv[2] ?? 'independent-hidden'); await mkdir(output);
await cp(join(own, 'hidden.mjs'), join(root, 'harness/independent-hidden.mjs'));
await cp(join(own, 'hidden.mjs'), join(output, 'hidden-input.mjs.txt'));
const commands = [];
for (const variant of ['base', 'candidate']) {
  const result = await supervise(process.execPath, ['--unhandled-rejections=strict', '--test', '--test-concurrency=1', '--test-timeout=30000', join(root, 'harness/independent-hidden.mjs')], {
    cwd: join(root, variant), env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: join(root, 'tmp'), LC_ALL: 'C', TZ: 'UTC', SORT_ROOT: root, SORT_VARIANT: variant },
    timeoutMs: 90000, maxOutputBytes: 8 * 1024 * 1024, stdout: join(output, `${variant}.stdout`), stderr: join(output, `${variant}.stderr`),
  });
  const stdout = await readFile(join(output, `${variant}.stdout`), 'utf8');
  result.counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  result.failures = [...stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]);
  assert.equal(result.timedOut, false); assert.equal(result.outputExceeded, false); assert.deepEqual(result.survivors, []);
  commands.push({ variant, ...result }); console.log(variant, result.counts, result.failures);
}
await writeFile(join(output, 'REPORT.json'), JSON.stringify({ capturedAt: new Date().toISOString(), hiddenSha256: createHash('sha256').update(await readFile(join(own, 'hidden.mjs'))).digest('hex'), commands }, null, 2));
