import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from '../output-emergency-review-20260827/common.mjs';
import { cases } from '../output-emergency-review-20260827/cases.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const original = join(owned, '../output-emergency-review-20260827');
const source = 'src/commands/expr/index.ts';
const regression = 'tests/commands/expr/output-quota.test.ts';
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/expr', 'tests/commands/expr-author'];
const dependencies = realpathSync(join(root, 'node_modules'));
const historical = ['output-emergency-review-20260827', 'fixture-output-contract-20260827', 'qualified-final-review-20260827'];
const historicalInventory = () => historical.map(path => ({ path, entries: inventory(join(owned, '..', path)) }));
const controls = () => [join(owned, 'capture.mjs'), join(root, regression), ...['cases.mjs', 'common.mjs', 'probe.mjs'].map(path => join(original, path))]
  .map(path => ({ path: path.slice(root.length + 1), sha256: hash(readFileSync(path)) }));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, timeout: 120000, killSignal: 'SIGTERM', maxBuffer: 128 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command}: ${result.stderr?.toString()} ${result.error ?? ''}`);
  return result.stdout;
};
const [mode, revision, name] = process.argv.slice(2);
if (mode === '--freeze') {
  assert(!revision && !name);
  const baseline = run('git', ['rev-parse', 'HEAD']).toString().trim();
  assert.equal(run('git', ['status', '--porcelain', '--', source]).toString(), '');
  const previous = JSON.parse(readFileSync(join(original, 'FREEZE.json')));
  assert.equal(hash(JSON.stringify(cases)), previous.casesSha256);
  for (const entry of previous.drivers) assert.equal(hash(readFileSync(join(original, entry.path))), entry.sha256);
  save(join(owned, 'FREEZE.json'), {
    frozenAt: new Date().toISOString(), baseline, baselineSourceSha256: hash(readFileSync(join(root, source))),
    controls: controls(), casesSha256: hash(JSON.stringify(cases)), historical: historicalInventory(), dependencies: inventory(dependencies),
    selected, node: process.version, platform: process.platform, architecture: process.arch,
    note: 'Preimplementation author inputs and unchanged independent 47 controls. No candidate product execution. Historical 36/47 twice, 11 failures and original 11/12 versus approved V2 12/12 are preserved, not rescored.',
  });
  console.log('Frozen controls before source change.');
} else {
  assert(['--development', '--capture'].includes(mode));
  assert(revision && name && /^[a-z0-9-]+$/.test(name));
  const output = join(owned, name);
  assert(!existsSync(output));
  const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE.json')));
  assert.deepEqual(controls(), freeze.controls);
  assert.deepEqual(historicalInventory(), freeze.historical);
  assert.deepEqual(inventory(dependencies), freeze.dependencies);
  const candidate = run('git', ['rev-parse', `${revision}^{commit}`]).toString().trim();
  const archive = run('git', ['archive', '--format=tar', candidate, ...selected]);
  mkdirSync(output);
  const scratch = mkdtempSync(join(owned, '.owned-'));
  const startedAt = new Date().toISOString();
  const execute = (label, args, timeout = 120000) => {
    const result = spawnSync(process.execPath, args, { cwd: scratch, timeout, killSignal: 'SIGTERM', maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch } });
    save(join(output, `${label}.json`), { status: result.status, signal: result.signal, stdout: result.stdout?.toString(), stderr: result.stderr?.toString(), error: result.error?.message });
    return result.status;
  };
  try {
    run('tar', ['-xf', '-', '-C', scratch], { input: archive });
    const archiveBefore = inventory(scratch);
    save(join(output, 'archive-before.json'), archiveBefore);
    if (mode === '--development') {
      copyFileSync(join(root, source), join(scratch, source));
      copyFileSync(join(root, regression), join(scratch, regression));
    } else {
      assert.equal(hash(readFileSync(join(scratch, regression))), freeze.controls.find(entry => entry.path === regression).sha256);
    }
    const inputBefore = inventory(scratch);
    save(join(output, 'input-before.json'), inputBefore);
    symlinkSync(dependencies, join(scratch, 'node_modules'), 'dir');
    const build = execute('build-strict', [join(dependencies, 'typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false']);
    assert.equal(build, 0);
    const types = execute('types-expr-strict', [join(dependencies, 'typescript/bin/tsc'), '-p', 'tests/commands/expr/tsconfig.json', '--skipLibCheck', 'false']);
    const builtBefore = inventory(scratch);
    save(join(output, 'built-before.json'), builtBefore);
    assert.deepEqual(builtBefore.filter(entry => entry.path !== 'node_modules' && entry.path !== 'dist' && !entry.path.startsWith('dist/')), inputBefore);
    const regressionStatus = execute('regression', ['--import', 'tsx', '--test', 'tests/commands/expr/output-quota.test.ts']);
    const adjacentStatus = execute('adjacent', ['--import', 'tsx', '--test',
      ...['contracts', 'grammar', 'diagnostics-regression', 'abort-reason-regression', 'regex-lifecycle', 'regex-limits'].map(path => `tests/commands/expr/${path}.test.ts`)]);
    const probe = execute('unchanged47-process', [join(original, 'probe.mjs'), scratch, join(output, 'unchanged47.json')], 90000);
    assert.equal(probe, 0);
    const results = JSON.parse(readFileSync(join(output, 'unchanged47.json')));
    assert.equal(results.safetyTerminations, 0);
    assert.equal(results.activeAfterSafety, 0);
    assert.deepEqual(results.unhandledRejections, []);
    assert.deepEqual(results.mainThreadMatcherViolations, []);
    assert.deepEqual(inventory(scratch), builtBefore);
    assert.deepEqual(inventory(dependencies), freeze.dependencies);
    assert.deepEqual(historicalInventory(), freeze.historical);
    assert.deepEqual(controls(), freeze.controls);
    assert.equal(hash(run('git', ['archive', '--format=tar', candidate, ...selected])), hash(archive));
    const summary = { candidate, mode, startedAt, finishedAt: new Date().toISOString(), archiveSha256: hash(archive),
      sourceSha256: hash(readFileSync(join(scratch, source))), build, types, regressionStatus, adjacentStatus,
      passed: results.passed, total: results.total, failed: results.rows.filter(row => !row.passed).map(row => row.input.id),
      archiveAndBuiltAppendAwareUnchanged: true, historicalAppendAwareUnchanged: true, dependenciesAppendAwareUnchanged: true, controlsUnchanged: true,
      meaning: 'Capture success is not acceptance. Development overlays exactly source and new regression; --capture uses immutable committed selected inputs only. All legacy failures retained.' };
    save(join(output, 'summary.json'), summary);
    console.log(JSON.stringify(summary));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    save(join(output, 'cleanup.json'), { scratch, absent: !existsSync(scratch), childProtocol: 'Bounded synchronous children, SIGTERM timeout, no SIGSTOP. Probe checks zero owned workers at settlement and zero safety terminations.' });
  }
}
