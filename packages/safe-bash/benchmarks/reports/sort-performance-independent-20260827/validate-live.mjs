import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { supervise } from '../../../tests/integration/full-gate-20260827/supervise.mjs';

const repo = resolve(dirname(import.meta.filename), '../../..'), output = process.argv[2]; assert.ok(output?.startsWith('/tmp/')); await mkdir(output);
const source = process.argv[3] ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
assert.match(source, /^[0-9a-f]{40}$/);
const scratch = await mkdtemp('/tmp/sort-current-integration-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, path));
    else { assert.ok(entry.isFile(), path); result[path] = hash(await readFile(join(directory, path))); }
  }
  return result;
}
const report = { source, startedAt: new Date().toISOString(), scratch, commands: {}, overlay: {}, versions: process.versions };
async function execute(label, args) {
  const result = await supervise(process.execPath, args, { cwd: scratch, env: { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1' },
    timeoutMs: 90000, maxOutputBytes: 8 * 1024 * 1024, stdout: join(output, label + '.stdout'), stderr: join(output, label + '.stderr') });
  const stdout = await readFile(join(output, label + '.stdout'), 'utf8');
  result.counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  report.commands[label] = result; console.log(label, result.status, result.counts);
  assert.deepEqual(result.survivors, []); assert.equal(result.timedOut, false); assert.equal(result.outputExceeded, false); return result.status;
}
try {
  const archive = execFileSync('git', ['archive', source, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json',
    'tests/commands/helpers.ts', 'tests/commands/core-regression-stress', 'tests/commands/core-sort', 'tests/commands/core-expanded'], { cwd: repo, maxBuffer: 24 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', scratch], { input: archive }); report.archiveSha256 = hash(archive);
  for (const path of ['src/commands/text.ts', 'tests/commands/core-sort/borrowed-buffer.test.ts']) {
    const bytes = await readFile(join(repo, path)); await writeFile(join(scratch, path), bytes); report.overlay[path] = hash(bytes);
  }
  assert.equal(report.overlay['src/commands/text.ts'], '08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d');
  report.sourceHashes = await hashes(join(scratch, 'src')); report.tests = await hashes(join(scratch, 'tests'));
  report.lockSha256 = hash(await readFile(join(scratch, 'package-lock.json'))); assert.equal(report.lockSha256, hash(await readFile(join(repo, 'package-lock.json'))));
  await cp(join(repo, 'node_modules'), join(scratch, 'node_modules'), { recursive: true, dereference: true }); report.dependencies = await hashes(join(scratch, 'node_modules'));
  const tests = ['tests/commands/core-regression-stress/native.test.ts', 'tests/commands/core-regression-stress/resources.test.ts', 'tests/commands/core-regression-stress/runtime.test.ts',
    'tests/commands/core-sort/regressions.test.ts', 'tests/commands/core-expanded/regressions.test.ts', 'tests/commands/core-sort/borrowed-buffer.test.ts'];
  assert.equal(await execute('targeted', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=30000', ...tests]), 0);
  assert.equal(await execute('build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']), 0);
  assert.equal(await execute('scoped-types', ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023', '--types', 'node', ...tests]), 0);
  assert.deepEqual(await hashes(join(scratch, 'src')), report.sourceHashes); assert.deepEqual(await hashes(join(scratch, 'tests')), report.tests); assert.deepEqual(await hashes(join(scratch, 'node_modules')), report.dependencies);
  report.buildHashes = await hashes(join(scratch, 'dist')); report.inputsUnchanged = true;
} finally {
  await rm(scratch, { recursive: true, force: true }); report.cleaned = true; report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'manifest.json'), JSON.stringify(report, null, 2));
}
