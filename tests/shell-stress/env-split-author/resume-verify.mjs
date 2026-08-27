import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, copyFile, symlink, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = 'e7f4f2e3753184415f8098445c2009cb4cd9a6e9';
const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const owned = [
  'tests/shell/env-split-native.test.ts', 'tests/shell/env-split-host.test.ts',
  ...['resume-fixtures.ts', 'resume-host.ts', 'resume-baseline.mjs', 'resume-cases.json', 'resume-native.json', 'native-frozen.json'].map(name => `tests/shell-stress/env-split-author/${name}`),
];
const scratch = await mkdtemp('/tmp/safe-bash-env-split-committed-base-');
const report = { base, scratch, date: new Date().toISOString(), repositoryHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), node: process.version, borrowed: {}, authorHashes: {}, commands: [], scratchRemoved: false };
const run = (command, args, cwd = scratch, input) => {
  const child = spawnSync(command, args, { cwd, input, detached: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  report.commands.push({ command, args, cwd, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout?.toString(), stderr: child.stderr?.toString(), pid: child.pid });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH');
  return child;
};
try {
  const archive = execFileSync('git', ['archive', '--format=tar', base, 'src', 'package.json'], { cwd: root, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  report.sourceArchiveHash = hash(archive);
  assert.equal(run('/usr/bin/tar', ['-xf', '-', '-C', scratch], scratch, archive).status, 0);
  await symlink(`${root}node_modules`, `${scratch}/node_modules`);
  for (const path of owned) {
    await mkdir(`${scratch}/${path.slice(0, path.lastIndexOf('/'))}`, { recursive: true });
    await copyFile(`${root}${path}`, `${scratch}/${path}`);
    report.authorHashes[path] = hash(await readFile(`${root}${path}`));
  }
  for (const path of ['node_modules/tsx/package.json', 'node_modules/typescript/package.json', 'package-lock.json']) report.borrowed[path] = hash(await readFile(`${root}${path}`));
  const baseline = run(process.execPath, ['--import', 'tsx', `${scratch}/tests/shell-stress/env-split-author/resume-baseline.mjs`, `${scratch}/baseline.json`], root);
  assert.equal(baseline.status, 0, baseline.stderr.toString());
  report.baseline = JSON.parse(await readFile(`${scratch}/baseline.json`, 'utf8'));
  const tests = run(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=spec', 'tests/shell/env-split-native.test.ts', 'tests/shell/env-split-host.test.ts']);
  report.testsExit = tests.status;
  const types = run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', 'tests/shell/env-split-native.test.ts', 'tests/shell/env-split-host.test.ts', 'tests/shell-stress/env-split-author/resume-host.ts']);
  report.scopedTypecheckExit = types.status;
  for (const [path, digest] of Object.entries(report.authorHashes)) assert.equal(hash(await readFile(`${root}${path}`)), digest);
} finally {
  await rm(scratch, { recursive: true, force: true }); report.scratchRemoved = true;
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ rows: report.baseline.rows.length, testsExit: report.testsExit, scopedTypecheckExit: report.scopedTypecheckExit, sourceInputs: Object.keys(report.baseline.before).length, scratchRemoved: report.scratchRemoved }));
