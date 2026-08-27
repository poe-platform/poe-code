import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { owned, root, hash, git, inventory, manifest, verifyInputs } from './integrity-v2.mjs';

const label = process.argv[2];
if (!label) {
  console.log('Read-only input verification:', JSON.stringify(verifyInputs()));
  console.log('Capture requires a NEW explicit label; no default evidence writes.');
  process.exit(0);
}
assert(/^[a-z0-9-]+$/u.test(label), 'supply a unique capture label');
const output = join(owned, label), scratch = join(owned, 'node_modules', label);
assert(!existsSync(output) && !existsSync(scratch), 'refusing to overwrite capture or owned scratch');
const inputsBefore = verifyInputs();
mkdirSync(output);
mkdirSync(scratch, { recursive: true });
const temporary = join(scratch, 'temporary');
mkdirSync(temporary);
const environment = { ...process.env, TMPDIR: temporary, TSX_DISABLE_CACHE: '1', GIT_CEILING_DIRECTORIES: temporary };
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const processes = [];
function command(name, executable, args, cwd, extra = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, env: environment, timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...extra });
  const record = { executable, args, cwd, started, finished: new Date().toISOString(), timeout: extra.timeout ?? 120000, maxBuffer: 32 * 1024 * 1024, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString(), stderr: result.stderr?.toString() };
  save(`${name}-process.json`, record);
  processes.push({ name, status: record.status, signal: record.signal, error: record.error });
  assert(!record.error && !record.signal, `${name}: ${record.error ?? record.signal}`);
  return record;
}
const counts = result => ({ status: result.status, ...Object.fromEntries([...result.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])])) });
const legacyPaths = JSON.parse(readFileSync(join(owned, 'historical/final-regression-summary.json'))).lifecyclePaths;
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/expr'];
const originalTrees = [
  'diagnostics-candidate-review/replay', 'output-emergency-review-20260827', 'encounter-independent-v2-20260827/freeze',
  'encounter-final-review-v2-20260827', 'encounter-shared-outside-review-v2-20260827', 'encounter-author-v2-20260827',
  'frozen', 'extension-review/frozen',
];
const originalsInventory = () => Object.fromEntries(originalTrees.map(path => [path, inventory(join(root, 'tests/commands/expr-stress', path))]));
const summaries = {}, sources = {}, sourceBefore = {}, runtimeBefore = {}, compiledBefore = {};
let installed, installedBefore, toolingBefore, originalBefore, archived;
try {
  save('inputs-before.json', inputsBefore);
  originalBefore = originalsInventory();
  save('original-trees-before.json', originalBefore);
  toolingBefore = inventory(join(root, 'node_modules'));
  save('tooling-before.json', toolingBefore);
  archived = git('archive', '--format=tar', manifest.candidate, ...selected);
  const gitEntries = git('ls-tree', '-r', manifest.candidate, '--', ...selected).toString().trim().split('\n').map(line => {
    const [metadata, path] = line.split('\t');
    const [mode, kind, blob] = metadata.split(' ');
    return { path, mode, kind, blob, sha256: hash(git('cat-file', 'blob', blob)) };
  });
  save('candidate.json', { candidate: manifest.candidate, canonicalCommit: manifest.canonicalCommit, quotaAncestor: manifest.quotaAncestor, archiveSha256: hash(archived), selected, legacyPaths, sourceFiles: gitEntries, node: { version: process.version, executable: process.execPath, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, environment: { TMPDIR: temporary, TSX_DISABLE_CACHE: environment.TSX_DISABLE_CACHE, GIT_CEILING_DIRECTORIES: environment.GIT_CEILING_DIRECTORIES, inheritedMapSha256: hash(JSON.stringify(Object.fromEntries(Object.entries(environment).sort()))) }, limits: { cohortTimeoutMs: 120000, coreAndPackagingTimeoutMs: 180000, outputBytesPerStream: 32 * 1024 * 1024, coreChildWatchdog: 'unchanged 2000 ms / 8192 bytes / 64 MiB / stack 4 MiB' }, noNativeRecapture: true });
  for (const profile of ['original', 'revised']) {
    const source = sources[profile] = join(scratch, profile);
    mkdirSync(source);
    assert.equal(command(`${profile}-extract`, 'tar', ['-xf', '-', '-C', source], root, { input: archived }).status, 0);
    for (const entry of gitEntries) assert.equal(hash(readFileSync(join(source, entry.path))), entry.sha256, entry.path);
    if (profile === 'revised') writeFileSync(join(source, 'tests/commands/expr/contracts.test.ts'), readFileSync(join(owned, 'revised/canonical/contracts.test.ts.data')));
    sourceBefore[profile] = inventory(source);
    save(`${profile}-source-before.json`, sourceBefore[profile]);
    const deltas = gitEntries.filter(entry => hash(readFileSync(join(source, entry.path))) !== entry.sha256).map(entry => entry.path);
    assert.deepEqual(deltas, profile === 'revised' ? ['tests/commands/expr/contracts.test.ts'] : []);
    symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
    assert.equal(command(`${profile}-build`, process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], source).status, 0);
    compiledBefore[profile] = inventory(join(source, 'dist'));
    save(`${profile}-compiled-before.json`, compiledBefore[profile]);
    runtimeBefore[profile] = inventory(source);
    save(`${profile}-runtime-before.json`, runtimeBefore[profile]);
  }
  assert.deepEqual(compiledBefore.original, compiledBefore.revised);
  for (const profile of ['original', 'revised']) {
    const focused = command(`${profile}-canonical-focused`, process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', 'tests/commands/expr/contracts.test.ts'], sources[profile]);
    const legacy = command(`${profile}-canonical-legacy`, process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...legacyPaths], sources[profile]);
    summaries[profile] = { focused: counts(focused), canonical: counts(legacy) };
  }
  for (const profile of ['original', 'revised']) {
    const nearby = command(`${profile}-nearby`, process.execPath, [join(owned, 'support/nearby-driver.mjs'), sources.original, join(owned, profile, 'nearby/controls.json')], sources.original);
    assert.equal(nearby.status, 0);
    const nearbyResults = JSON.parse(nearby.stdout);
    save(`${profile}-nearby-results.json`, nearbyResults);
    const quota = command(`${profile}-quota`, process.execPath, [join(owned, profile === 'revised' ? 'quota-identity-v2' : 'original/quota', 'probe.mjs'), sources.original, join(output, `${profile}-quota-results.json`)], sources.original);
    assert.equal(quota.status, 0);
    const quotaResults = JSON.parse(readFileSync(join(output, `${profile}-quota-results.json`)));
    summaries[profile].nearby = { pass: nearbyResults.cases.filter(row => row.passed).length, tests: nearbyResults.cases.length, failures: nearbyResults.cases.filter(row => !row.passed).map(row => row.id) };
    summaries[profile].quota = { pass: quotaResults.passed, tests: quotaResults.total, failures: quotaResults.rows.filter(row => !row.passed).map(row => row.input.id) };
    assert.equal(nearbyResults.activeWorkers, 0);
    assert.equal(quotaResults.safetyTerminations, 0);
    assert.equal(quotaResults.activeAfterSafety, 0);
    assert.deepEqual(quotaResults.unhandledRejections, []);
    assert.deepEqual(quotaResults.mainThreadMatcherViolations, []);
  }
  const packed = command('core-pack', 'npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(scratch, 'pack-cache'), '--pack-destination', scratch], sources.original, { timeout: 180000 });
  assert.equal(packed.status, 0);
  const artifact = JSON.parse(packed.stdout)[0];
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"name":"expr-core-physical-review","private":true,"type":"module"}\n', { flag: 'wx' });
  assert.equal(command('core-install', 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(scratch, 'install-cache'), join(scratch, artifact.filename)], consumer, { timeout: 180000 }).status, 0);
  const relocated = join(scratch, 'relocated');
  renameSync(consumer, relocated);
  installed = join(relocated, 'node_modules/virtual-bash');
  installedBefore = inventory(installed);
  save('installed-before.json', installedBefore);
  assert.deepEqual(inventory(join(installed, 'dist')), compiledBefore.original);
  const tarSha256 = hash(readFileSync(join(scratch, artifact.filename)));
  save('package.json', { artifact, tarSha256, installed, physicalInstallForOriginalCoreCohort: true, independentMovedSmokeNotRun: true });
  for (const profile of ['original', 'revised']) {
    const coreOutput = join(output, `${profile}-core`);
    mkdirSync(coreOutput);
    const core = command(`${profile}-core`, process.execPath, [join(owned, 'support/core-bound.mjs'), `${label}-${profile}`], relocated, { timeout: 180000, env: { ...environment, REVIEW_INSTALLED: installed, REVIEW_COMMIT: manifest.candidate, REVIEW_TMP: temporary, REVIEW_OUTPUT: coreOutput, REVIEW_TAR_SHA256: tarSha256, REVIEW_ROOT: root, REVIEW_PROFILE: profile, NODE_PATH: '' } });
    assert.equal(core.status, 0, core.stderr);
    const results = JSON.parse(readFileSync(join(coreOutput, 'core-controls.json')));
    summaries[profile].core = { pass: results.rows.filter(row => row.passed).length, tests: results.rows.length, failures: results.failedSubcases };
    assert(results.rows.every(row => row.terminationAwaited));
    assert(results.realVfsScratchRemoved);
  }
  save('SUMMARY.json', { candidate: manifest.candidate, canonicalCommit: manifest.canonicalCommit, separateNewReruns: summaries, historicalResults: manifest.historicalDenominators, qualification: 'Original and revised runs are separately captured, not rescored history. Focused tests overlap the six-file legacy cohort. Shared regressions, additional canonical cohorts and independent moved smoke are delegated elsewhere and are not rerun here.' });
  console.log(JSON.stringify(summaries, null, 2));
} finally {
  const checks = {};
  const compare = (name, actual, expected) => { checks[name] = JSON.stringify(actual) === JSON.stringify(expected); };
  for (const profile of Object.keys(runtimeBefore)) {
    const after = inventory(sources[profile]);
    save(`${profile}-runtime-after.json`, after);
    compare(`${profile}RuntimeCompleteEntrySet`, after, runtimeBefore[profile]);
  }
  if (installedBefore) { const after = inventory(installed); save('installed-after.json', after); compare('installedCompleteEntrySet', after, installedBefore); }
  if (toolingBefore) { const after = inventory(join(root, 'node_modules')); save('tooling-after.json', after); compare('toolingCompleteEntrySet', after, toolingBefore); }
  if (originalBefore) { const after = originalsInventory(); save('original-trees-after.json', after); compare('originalTreesCompleteEntrySets', after, originalBefore); }
  if (archived) compare('candidateArchive', hash(git('archive', '--format=tar', manifest.candidate, ...selected)), hash(archived));
  let inputError;
  try { const after = verifyInputs(); save('inputs-after.json', after); compare('frozenInputs', after, inputsBefore); }
  catch (error) { inputError = error; checks.frozenInputs = false; }
  save('INTEGRITY.json', { checks, detectsAddedEntries: true, qualification: 'Observation-time equality of complete selected extracted runtime, build/installed, tooling and named original-evidence entry sets; not a transient-mutation or global live-tree guarantee.', inputError: inputError?.message ?? null });
  save('temporary-before-cleanup.json', inventory(temporary));
  rmSync(scratch, { recursive: true, force: true });
  save('CLEANUP.json', { scratch: relative(root, scratch), absent: !existsSync(scratch), boundedProcesses: processes, normalRemoval: true, sigstopUsed: false, finished: new Date().toISOString() });
  assert(Object.values(checks).every(Boolean), 'selected input/runtime integrity changed');
}
