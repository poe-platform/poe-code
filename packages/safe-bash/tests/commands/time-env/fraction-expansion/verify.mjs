import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { supervise } from '../../../integration/full-gate-20260827/supervise.mjs';

const repo = resolve(dirname(import.meta.filename), '../../../..');
const source = execFileSync('git', ['rev-parse', 'c782363^{commit}'], { cwd: repo }).toString().trim();
const output = process.argv[2]; assert.ok(output?.startsWith('/tmp/')); await mkdir(output);
const scratch = await mkdtemp('/tmp/time-env-fraction-author-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { source, startedAt: new Date().toISOString(), scratch, versions: process.versions, commands: {} };
const env = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', TZ: 'Pacific/Honolulu', TSX_DISABLE_CACHE: '1' };
async function execute(label, args) {
  const result = await supervise(process.execPath, args, { cwd: scratch, env, timeoutMs: 30000, maxOutputBytes: 4 * 1024 * 1024, stdout: join(output, label + '.stdout'), stderr: join(output, label + '.stderr') });
  const stdout = await readFile(join(output, label + '.stdout'), 'utf8');
  result.counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  assert.deepEqual(result.survivors, []); assert.equal(result.timedOut, false); assert.equal(result.outputExceeded, false);
  report.commands[label] = result; console.log(label, result.status, result.counts); return result;
}
async function replaceLine(path, before, after) {
  const patch = `*** Begin Patch\n*** Update File: ${path}\n@@\n-${before}\n+${after}\n*** End Patch\n`;
  const file = join(scratch, 'mutant.patch'); await writeFile(file, patch); const handle = await open(file, 'r');
  try { const result = spawnSync('apply_patch', [], { stdio: [handle.fd, 'pipe', 'pipe'] }); assert.equal(result.status, 0, result.stderr?.toString()); }
  finally { await handle.close(); }
}
try {
  const archive = execFileSync('git', ['archive', source, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json',
    'tests/commands/time-env/helpers.ts', 'tests/commands/time-env/tsconfig.json', 'tests/commands/time-env/fraction-expansion'], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', scratch], { input: archive }); report.archiveSha256 = hash(archive);
  report.lockSha256 = hash(await readFile(join(scratch, 'package-lock.json'))); assert.equal(report.lockSha256, hash(await readFile(join(repo, 'package-lock.json'))));
  await cp(join(repo, 'node_modules'), join(scratch, 'node_modules'), { recursive: true, dereference: true });
  const path = join(scratch, 'src/commands/time-env/format.ts'), original = await readFile(path, 'utf8'); report.formatSha256 = hash(original);
  const args = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=10000',
    'tests/commands/time-env/fraction-expansion/nanoseconds.test.ts', 'tests/commands/time-env/fraction-expansion/iso-year.test.ts'];
  assert.equal((await execute('feature', args)).status, 0); assert.equal(report.commands.feature.counts.pass, 54);
  assert.equal((await execute('types', ['node_modules/typescript/bin/tsc', '-p', 'tests/commands/time-env/fraction-expansion/tsconfig.json', '--noEmit'])).status, 0);
  for (const [label, before, after] of [
    ['mutant-output-preflight', '        checkSize(size + length + 1, limits.maxOutputBytes, "output");', '        void length;'],
    ['mutant-left-padding', '        append(padding === "" ? digits : digits.padEnd(precision, padding ?? "0")); continue;', '        append(padding === "" ? digits : digits.padStart(precision, padding ?? "0")); continue;'],
    ['mutant-ISO-wrap', '      case "g": value = String(Math.abs(isoYear % 100)); defaultWidth = 2; break;', '      case "g": value = String((isoYear % 100 + 100) % 100); defaultWidth = 2; break;'],
  ]) {
    assert.equal(original.split(before).length - 1, 1); await replaceLine(path, before, after);
    const result = await execute(label, args); assert.equal(result.status, 1); assert.ok(result.counts.fail > 0);
    await replaceLine(path, after, before); assert.equal(hash(await readFile(path)), report.formatSha256);
  }
  assert.equal((await execute('restored-feature', args)).status, 0); report.sourceRestored = true;
} finally {
  await rm(scratch, { recursive: true, force: true }); report.cleaned = true; report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'manifest.json'), JSON.stringify(report, null, 2));
}
