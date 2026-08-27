import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from './common.mjs';
import { cases } from './cases.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const drivers = ['cases.mjs', 'common.mjs', 'probe.mjs', 'capture.mjs'];
const historical = ['fixture-output-contract-20260827', 'qualified-final-review-20260827'];
const dependencies = realpathSync(join(root, 'node_modules'));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, timeout: 120000, maxBuffer: 128 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command}: ${result.stderr?.toString()} ${result.error ?? ''}`);
  return result.stdout;
};
const driverInventory = () => drivers.map(path => ({ path, sha256: hash(readFileSync(join(owned, path))) }));
const historicalInventory = () => historical.map(path => ({ path, entries: inventory(join(owned, '..', path)) }));
const [mode, destination] = process.argv.slice(2);
if (mode === '--freeze') {
  assert(!destination);
  const candidate = '7623599c995c42f62ec1cd9ad78ced2913970f66';
  const archive = run('git', ['archive', '--format=tar', candidate, ...selected]);
  save(join(owned, 'FREEZE.json'), { frozenAt: new Date().toISOString(), candidate, selected, archiveSha256: hash(archive),
    gitTree: run('git', ['ls-tree', '-r', candidate, '--', ...selected]).toString(), drivers: driverInventory(), casesSha256: hash(JSON.stringify(cases)),
    historical: historicalInventory(), dependencies: inventory(dependencies),
    node: process.version, platform: process.platform, architecture: process.arch,
    selectedLiveStatus: run('git', ['status', '--porcelain', '--', ...selected]).toString(),
    note: 'Postcandidate independently authored controls frozen before execution; not preimplementation holdouts. New entries detected by full inventory equality.' });
  console.log('Frozen candidate and controls; no product execution yet.');
} else {
  assert.equal(mode, '--capture');
  assert(destination && /^[a-z0-9-]+$/.test(destination));
  const output = join(owned, destination);
  assert(!existsSync(output));
  mkdirSync(output);
  const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE.json')));
  assert.deepEqual(driverInventory(), freeze.drivers);
  assert.equal(hash(JSON.stringify(cases)), freeze.casesSha256);
  assert.deepEqual(historicalInventory(), freeze.historical);
  assert.deepEqual(inventory(dependencies), freeze.dependencies);
  const archive = run('git', ['archive', '--format=tar', freeze.candidate, ...selected]);
  assert.equal(hash(archive), freeze.archiveSha256);
  const scratch = mkdtempSync(join(owned, '.owned-'));
  const startedAt = new Date().toISOString();
  try {
    run('tar', ['-xf', '-', '-C', scratch], { input: archive });
    const archiveBefore = inventory(scratch);
    save(join(output, 'archive-before.json'), archiveBefore);
    symlinkSync(dependencies, join(scratch, 'node_modules'), 'dir');
    const build = spawnSync(process.execPath, [join(dependencies, 'typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], { cwd: scratch, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    save(join(output, 'build.json'), { status: build.status, signal: build.signal, stdout: build.stdout?.toString(), stderr: build.stderr?.toString(), error: build.error?.message });
    assert.equal(build.status, 0);
    const builtBefore = inventory(scratch);
    save(join(output, 'built-before.json'), builtBefore);
    assert.deepEqual(builtBefore.filter(entry => entry.path !== 'node_modules' && entry.path !== 'dist' && !entry.path.startsWith('dist/')), archiveBefore);
    const probe = spawnSync(process.execPath, [join(owned, 'probe.mjs'), scratch, join(output, 'results.json')], { cwd: scratch, timeout: 90000, killSignal: 'SIGTERM', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch } });
    save(join(output, 'probe-process.json'), { status: probe.status, signal: probe.signal, stdout: probe.stdout?.toString(), stderr: probe.stderr?.toString(), error: probe.error?.message });
    assert.equal(probe.status, 0);
    assert.deepEqual(inventory(scratch), builtBefore);
    assert.deepEqual(inventory(dependencies), freeze.dependencies);
    assert.deepEqual(historicalInventory(), freeze.historical);
    assert.deepEqual(driverInventory(), freeze.drivers);
    assert.equal(hash(run('git', ['archive', '--format=tar', freeze.candidate, ...selected])), freeze.archiveSha256);
    const results = JSON.parse(readFileSync(join(output, 'results.json')));
    assert.equal(results.safetyTerminations, 0);
    assert.equal(results.activeAfterSafety, 0);
    assert.deepEqual(results.unhandledRejections, []);
    assert.deepEqual(results.mainThreadMatcherViolations, []);
    save(join(output, 'integrity.json'), { candidate: freeze.candidate, startedAt, finishedAt: new Date().toISOString(), archiveSha256: freeze.archiveSha256,
      archiveAndBuiltAppendAwareUnchanged: true, dependencyAppendAwareUnchanged: true, historicalAppendAwareUnchanged: true, controlsUnchanged: true,
      passed: results.passed, total: results.total, failed: results.rows.filter(row => !row.passed).map(row => row.input.id),
      resultMeaning: 'Capture success is NOT acceptance success. Every failed assertion is retained.' });
    console.log(JSON.stringify({ passed: results.passed, total: results.total, failed: results.rows.filter(row => !row.passed).map(row => row.input.id) }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    save(join(output, 'cleanup.json'), { scratch, absent: !existsSync(scratch), childProtocol: 'One bounded synchronous child, normally exited; worker termination awaited in probe; timeout uses SIGTERM, never SIGSTOP.' });
  }
}
