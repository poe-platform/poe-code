import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, symlinkSync, rmSync, renameSync, cpSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const candidate = 'c3e40f8bd721da5e496f3b3abfd51aee45db5a84';
const quotaCommit = 'c25e682a7baa2f2abf70cebf8c01d11d0ad5daee';
const freezeCommit = '30dda5b930c6e5ea29a54348926fc02b81f9d8e6';
const encounter = join(owned, '../encounter-independent-v2-20260827');
const quota = join(owned, '../output-quota-independent-v2-20260827');
const qualified = join(owned, '../qualified-final-review-20260827');
const label = process.argv[2];
assert(/^[a-z0-9-]+$/u.test(label ?? ''), 'supply unique capture label');
const output = join(owned, label);
assert(!existsSync(output), 'immutable capture already exists');
mkdirSync(output);
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = join(owned, 'node_modules', label);
assert(!existsSync(scratch));
mkdirSync(scratch, { recursive: true });
const source = join(scratch, 'source');
const temporary = join(scratch, 'temporary');
mkdirSync(source);
mkdirSync(temporary);
const environment = { ...process.env, TMPDIR: temporary, TSX_DISABLE_CACHE: '1', GIT_CEILING_DIRECTORIES: temporary };
const processes = [];
function command(name, executable, args, cwd = source, extra = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, env: environment, timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...extra });
  const record = { executable, args, cwd, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString(), stderr: result.stderr?.toString() };
  processes.push({ name, status: record.status, signal: record.signal });
  if (name) save(`${name}-process.json`, record);
  return record;
}
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function inventory(directory, excluded = []) {
  const records = {};
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current).sort()) {
      if (!prefix && excluded.includes(entry)) continue;
      const filename = prefix ? `${prefix}/${entry}` : entry;
      const absolute = join(current, entry);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) records[filename] = { kind: 'symlink', target: readlinkSync(absolute) };
      else if (stat.isDirectory()) { records[filename] = { kind: 'directory' }; walk(absolute, filename); }
      else records[filename] = { kind: 'file', bytes: stat.size, sha256: hash(readFileSync(absolute)) };
    }
  }
  walk(directory);
  return records;
}
function authenticate() {
  const paths = git('ls-tree', '-r', '--name-only', freezeCommit, '--', relative(root, encounter)).toString().trim().split('\n');
  const records = {};
  for (const filename of paths) {
    const expected = hash(git('show', `${freezeCommit}:${filename}`));
    assert.equal(hash(readFileSync(join(root, filename))), expected, filename);
    records[relative(encounter, join(root, filename))] = expected;
  }
  for (const folder of ['freeze', 'historical']) {
    assert.deepEqual(Object.entries(inventory(join(encounter, folder))).filter(([, entry]) => entry.kind !== 'directory').map(([name]) => `${folder}/${name}`).sort(), Object.keys(records).filter(name => name.startsWith(`${folder}/`)).sort());
  }
  const original = JSON.parse(readFileSync(join(encounter, 'freeze/original-cases.json')));
  assert.equal(original.cases.length, 61);
  assert.equal(hash(JSON.stringify(original.cases)), 'd4bb6baf0109a8f5ba2e6752a1bb5d56c492cbdde43495883f68a4a2ea124a47');
  const quotaFreeze = JSON.parse(readFileSync(join(quota, 'FREEZE.json')));
  for (const driver of quotaFreeze.drivers) assert.equal(hash(readFileSync(join(quota, driver.path))), driver.sha256, driver.path);
  return { encounter: records, quotaDrivers: quotaFreeze.drivers, quotaFreezeSha256: hash(readFileSync(join(quota, 'FREEZE.json'))) };
}
const testCounts = result => ({ status: result.status, ...Object.fromEntries([...result.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])])) });
try {
  save('freeze-before.json', authenticate());
  assert.equal(git('rev-parse', `${candidate}^{commit}`).toString().trim(), candidate);
  assert.equal(command(null, 'git', ['merge-base', '--is-ancestor', quotaCommit, candidate], root).status, 0);
  const changed = git('diff', '--name-only', quotaCommit, candidate, '--', 'src', 'package.json', 'package-lock.json').toString().trim().split('\n');
  assert.deepEqual(changed, ['src/commands/expr/evaluate.ts', 'src/commands/expr/index.ts', 'src/commands/expr/syntax.ts']);
  const shared = JSON.parse(readFileSync(join(qualified, 'shared-qualified-summary.json'))).paths;
  const selected = [...new Set(['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/expr', 'tests/commands/expr-author', ...shared])];
  const archive = git('archive', '--format=tar', candidate, ...selected);
  const extraction = command('extract', 'tar', ['-xf', '-', '-C', source], root, { input: archive });
  assert.equal(extraction.status, 0);
  const sourceBefore = inventory(source);
  save('source-before.json', sourceBefore);
  save('candidate.json', { candidate, quotaCommit, freezeCommit, selected, changed, archiveSha256: hash(archive), tree: git('ls-tree', '-r', candidate, '--', ...selected).toString(), platform: process.platform, release: os.release(), arch: process.arch, node: process.version, sharedPaths: shared, temporaryPolicy: 'Owned TMPDIR inside workspace; GIT_CEILING_DIRECTORIES stops parent repository discovery for native rg fixtures. No fixture or oracle edits.' });
  symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  const build = command('build', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false']);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const compiledBefore = inventory(join(source, 'dist'));
  save('compiled-before.json', compiledBefore);
  const originalRun = command('original61', process.execPath, [join(encounter, 'freeze/original-driver.mjs'), source, join(encounter, 'freeze/original-cases.json')]);
  assert.equal(originalRun.status, 0);
  const original = JSON.parse(originalRun.stdout);
  save('original61-results.json', original);
  const nearbyRun = command('nearby16', process.execPath, [join(encounter, 'nearby-driver.mjs'), source, join(encounter, 'freeze/controls.json')]);
  assert.equal(nearbyRun.status, 0);
  const nearby = JSON.parse(nearbyRun.stdout);
  save('nearby16-results.json', nearby);
  for (const [name, probe] of [['quota47', 'old47/probe.mjs'], ['quota21', 'additional-probe.mjs']]) {
    const result = command(name, process.execPath, [join(quota, probe), source, join(output, `${name}-results.json`)]);
    assert.equal(result.status, 0);
  }
  const baseline = JSON.parse(readFileSync(join(encounter, 'baseline-01/original-results.json')));
  const closure = baseline.cases.filter(row => !row.passed).map(before => ({ id: before.id, before, after: original.cases.find(row => row.id === before.id) }));
  save('nineteen-closure.json', closure);
  const frozenCases = JSON.parse(readFileSync(join(encounter, 'freeze/original-cases.json'))).cases;
  const summarize = rows => ({ passed: rows.filter(row => row.passed).length, total: rows.length, failures: rows.filter(row => !row.passed).map(row => ({ id: row.id, args: row.args, expected: row.expected, observed: row.observed, failures: row.failures })) });
  save('encounter-summary.json', { original: summarize(original.cases), nativeDarwin: summarize(original.cases.filter(row => frozenCases.find(specimen => specimen.id === row.id).native !== false)), project: summarize(original.cases.filter(row => frozenCases.find(specimen => specimen.id === row.id).native === false)), nearby: summarize(nearby.cases), shellOverlapping: summarize(original.shell), oldCapSeparate: original.oldCap, closure: { total: closure.length, closed: closure.filter(row => row.after.passed).length } });
  console.log(JSON.stringify({ original: summarize(original.cases), nearby: summarize(nearby.cases), closed: closure.filter(row => row.after.passed).length }));
  const typesConfig = { extends: './tsconfig.json', compilerOptions: { noEmit: true, skipLibCheck: false }, include: ['src/**/*.ts', 'tests/commands/expr/**/*.ts', 'tests/commands/expr-author/**/*.ts'], files: shared.filter(filename => filename.endsWith('.ts')), exclude: [] };
  writeFileSync(join(source, 'review-tsconfig.json'), JSON.stringify(typesConfig), { flag: 'wx' });
  const types = command('scoped-types', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'review-tsconfig.json']);
  const lifecyclePaths = ['contracts', 'abort-reason-regression', 'regex-lifecycle', 'regex-limits', 'regex-protocol', 'grammar'].map(name => `tests/commands/expr/${name}.test.ts`);
  const legacy = command('legacy-no-native', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...lifecyclePaths]);
  const currentPaths = ['diagnostics-regression', 'inactive-prefix', 'named-profile', 'encounter-order', 'output-quota'].map(name => `tests/commands/expr/${name}.test.ts`);
  const current = command('additional-canonical', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...currentPaths]);
  const sharedRun = command('shared11', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...shared.filter(filename => filename.endsWith('.test.ts'))]);
  save('regression-summary.json', { types: testCounts(types), legacyNoNative: testCounts(legacy), additionalCanonical: testCounts(current), shared11: testCounts(sharedRun), omittedLegacy: ['tests/commands/expr/native.test.ts', 'tests/commands/expr/regex-native.test.ts'], nativeExprPolicy: 'No native expr recapture. Existing frozen 44 Darwin tuples replayed separately; native canonical files not run.', lifecyclePaths, currentPaths });
  const packed = command('pack', 'npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(scratch, 'pack-cache'), '--pack-destination', scratch]);
  assert.equal(packed.status, 0, packed.stderr);
  const artifact = JSON.parse(packed.stdout)[0];
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"name":"expr-physical-review","private":true,"type":"module"}\n', { flag: 'wx' });
  const install = command('install', 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(scratch, 'install-cache'), join(scratch, artifact.filename)], consumer);
  assert.equal(install.status, 0, install.stderr);
  const moved = join(scratch, 'relocated');
  renameSync(consumer, moved);
  const installed = join(moved, 'node_modules/virtual-bash');
  const installedBefore = inventory(installed);
  save('installed-before.json', installedBefore);
  assert.deepEqual(inventory(join(installed, 'dist')), compiledBefore);
  assert(!existsSync(join(installed, 'src')));
  const smoke = command('moved-physical-smoke', process.execPath, [join(owned, 'moved-smoke.mjs'), installed], moved, { env: { PATH: process.env.PATH, HOME: join(scratch, 'empty-home'), TMPDIR: temporary, NODE_PATH: '' } });
  assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr);
  save('moved-results.json', JSON.parse(smoke.stdout));
  assert.deepEqual(inventory(installed), installedBefore);
  save('installed-after.json', inventory(installed));
  save('package.json', { artifact, tarSha256: hash(readFileSync(join(scratch, artifact.filename))), moved, physicalOnly: true, noPublicExprClaim: true, emptyCachesBeforeUse: true });
  const sourceAfter = inventory(source, ['dist', 'node_modules', 'review-tsconfig.json']);
  save('source-after.json', sourceAfter);
  assert.deepEqual(sourceAfter, sourceBefore);
  save('compiled-after.json', inventory(join(source, 'dist')));
  assert.deepEqual(inventory(join(source, 'dist')), compiledBefore);
  save('freeze-after.json', authenticate());
  assert.equal(hash(git('archive', '--format=tar', candidate, ...selected)), hash(archive));
  save('integrity.json', { selectedSourceEntriesUnchanged: true, detectsAppendedEntries: true, compiledEntriesUnchanged: true, installedEntriesUnchanged: true, frozenInputsUnchanged: true, committedArchiveUnchanged: true, globalLiveTreeClaim: false });
} finally {
  save('temporary-before-cleanup.json', inventory(temporary));
  rmSync(scratch, { recursive: true, force: true });
  save('cleanup.json', { scratch, absent: !existsSync(scratch), processes, finished: new Date().toISOString() });
}
