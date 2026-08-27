import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from './old47/common.mjs';
import { cases as oldCases } from './old47/cases.mjs';
import { cases as newCases } from './additional-cases.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const historicalPath = 'tests/commands/expr-stress/output-emergency-review-20260827';
const baseline = '7623599c995c42f62ec1cd9ad78ced2913970f66';
const cohortCommit = '064f3381';
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json',
  ...['contracts.test.ts', 'abort-reason-regression.test.ts', 'regex-lifecycle.test.ts', 'regex-protocol.test.ts', 'helpers.ts'].map(name => `tests/commands/expr/${name}`)];
const drivers = ['FREEZE.md', 'additional-cases.mjs', 'additional-probe.mjs', 'old47/cases.mjs', 'old47/common.mjs', 'old47/probe.mjs', 'replay.mjs', 'scoped-tsconfig.json'];
const dependencies = realpathSync(join(root, 'node_modules'));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, timeout: 120000, maxBuffer: 128 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command}: ${result.stderr?.toString()} ${result.error ?? ''}`);
  return result.stdout;
};
const driverInventory = () => drivers.map(path => ({ path, sha256: hash(readFileSync(join(owned, path))) }));
const historicalInventory = () => ['output-emergency-review-20260827', 'fixture-output-contract-20260827', 'qualified-final-review-20260827'].map(path => ({ path, entries: inventory(join(owned, '..', path)) }));
const [mode, label, suppliedCommit] = process.argv.slice(2);
if (mode === '--freeze') {
  assert(!label);
  for (const name of ['cases.mjs', 'common.mjs', 'probe.mjs']) assert.equal(hash(readFileSync(join(owned, 'old47', name))), hash(run('git', ['show', `${cohortCommit}:${historicalPath}/${name}`])));
  assert.equal(oldCases.length, 47);
  assert.equal(newCases.length, 21);
  const archive = run('git', ['archive', '--format=tar', baseline, ...selected]);
  save(join(owned, 'FREEZE.json'), { frozenAt: new Date().toISOString(), baseline,
    cohortCommit: run('git', ['rev-parse', cohortCommit]).toString().trim(), oldCount: oldCases.length, newCount: newCases.length,
    selected, baselineArchiveSha256: hash(archive), drivers: driverInventory(),
    oldCasesSha256: hash(JSON.stringify(oldCases)), newCasesSha256: hash(JSON.stringify(newCases)),
    historical: historicalInventory(), dependencies: inventory(dependencies), node: process.version, platform: process.platform, architecture: process.arch,
    note: 'Independent additions and unchanged original 47 frozen before candidate receipt/source read and before product execution. No author evidence used for acceptance.' });
  console.log('Frozen unchanged old47 and 21 new controls. Candidate not read.');
} else {
  assert.equal(mode, '--capture');
  assert(label && /^[a-z0-9-]+$/.test(label));
  assert(suppliedCommit && /^[0-9a-f]{40}$/.test(suppliedCommit));
  const output = join(owned, label);
  assert(!existsSync(output));
  const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE.json')));
  assert.deepEqual(driverInventory(), freeze.drivers);
  assert.deepEqual(historicalInventory(), freeze.historical);
  assert.deepEqual(inventory(dependencies), freeze.dependencies);
  assert.equal(hash(JSON.stringify(oldCases)), freeze.oldCasesSha256);
  assert.equal(hash(JSON.stringify(newCases)), freeze.newCasesSha256);
  mkdirSync(output);
  const archive = run('git', ['archive', '--format=tar', suppliedCommit, ...selected]);
  if (suppliedCommit === baseline) assert.equal(hash(archive), freeze.baselineArchiveSha256);
  const scratch = mkdtempSync(join(owned, '.owned-'));
  const startedAt = new Date().toISOString();
  const processes = [];
  const processRun = (name, command, args, timeout = 120000) => {
    const result = spawnSync(command, args, { cwd: scratch, timeout, killSignal: 'SIGTERM', maxBuffer: 8 * 1024 * 1024 });
    const record = { name, command, args, status: result.status, signal: result.signal, stdout: result.stdout?.toString(), stderr: result.stderr?.toString(), error: result.error?.message };
    processes.push(record);
    save(join(output, `${name}-process.json`), record);
    assert.equal(result.status, 0, `${name}: ${record.stderr} ${record.error ?? ''}`);
  };
  try {
    run('tar', ['-xf', '-', '-C', scratch], { input: archive });
    const archiveBefore = inventory(scratch);
    save(join(output, 'archive-before.json'), archiveBefore);
    symlinkSync(dependencies, join(scratch, 'node_modules'), 'dir');
    copyFileSync(join(owned, 'scoped-tsconfig.json'), join(scratch, 'scoped-tsconfig.json'));
    processRun('build', process.execPath, [join(dependencies, 'typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false']);
    processRun('scoped-types', process.execPath, [join(dependencies, 'typescript/bin/tsc'), '-p', 'scoped-tsconfig.json']);
    const builtBefore = inventory(scratch);
    save(join(output, 'built-before.json'), builtBefore);
    const archiveEntries = entries => entries.filter(entry => entry.path !== 'node_modules' && entry.path !== 'scoped-tsconfig.json' && entry.path !== 'dist' && !entry.path.startsWith('dist/'));
    assert.deepEqual(archiveEntries(builtBefore), archiveBefore);
    processRun('old47', process.execPath, [join(owned, 'old47/probe.mjs'), scratch, join(output, 'old47-results.json')], 30000);
    processRun('additional', process.execPath, [join(owned, 'additional-probe.mjs'), scratch, join(output, 'additional-results.json')], 30000);
    assert.deepEqual(inventory(scratch), builtBefore);
    assert.deepEqual(driverInventory(), freeze.drivers);
    assert.deepEqual(historicalInventory(), freeze.historical);
    assert.deepEqual(inventory(dependencies), freeze.dependencies);
    assert.equal(hash(run('git', ['archive', '--format=tar', suppliedCommit, ...selected])), hash(archive));
    const oldResult = JSON.parse(readFileSync(join(output, 'old47-results.json')));
    const additional = JSON.parse(readFileSync(join(output, 'additional-results.json')));
    save(join(output, 'summary.json'), { suppliedCommit, archiveSha256: hash(archive), startedAt, finishedAt: new Date().toISOString(),
      selected, gitTree: run('git', ['ls-tree', '-r', suppliedCommit, '--', ...selected]).toString(),
      sourceCommitChanges: run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', suppliedCommit, '--', 'src', 'package.json', 'package-lock.json']).toString(),
      sourceChangesFromBaseline: run('git', ['diff', '--name-only', baseline, suppliedCommit, '--', 'src', 'package.json', 'package-lock.json']).toString(),
      old47: { passed: oldResult.passed, total: oldResult.total, failures: oldResult.rows.filter(row => !row.passed).map(row => ({ id: row.input.id, checks: row.checks.filter(check => !check.passed) })) },
      additional: { passed: additional.passed, total: additional.total, failures: additional.rows.filter(row => !row.passed).map(row => ({ id: row.input.id, checks: row.checks.filter(check => !check.passed) })) },
      integrity: { fullEntrySetsUnchanged: true, detectsAppendedEntries: true, historicalUnchanged: true, dependenciesUnchanged: true, archiveUnchanged: true, driversUnchanged: true },
      safety: [oldResult, additional].map(result => ({ unhandledRejections: result.unhandledRejections, uncaughtExceptions: result.uncaughtExceptions ?? 'old probe has no monitor; process exit/status/stderr recorded', mainThreadMatcherViolations: result.mainThreadMatcherViolations, safetyTerminations: result.safetyTerminations, activeAfterSafety: result.activeAfterSafety })),
    });
    console.log(JSON.stringify({ commit: suppliedCommit, old47: `${oldResult.passed}/${oldResult.total}`, additional: `${additional.passed}/${additional.total}` }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    save(join(output, 'cleanup.json'), { scratch, absent: !existsSync(scratch), finishedAt: new Date().toISOString(), knownChildren: processes.map(({ name, status, signal }) => ({ name, status, signal })) });
  }
}
