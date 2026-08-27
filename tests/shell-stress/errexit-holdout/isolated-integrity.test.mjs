import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { sha256 } from '../current-shell/support.mjs';
import { cases, hostCases, invocation } from './cases.mjs';
import { owned } from './native.mjs';

const root = resolve(owned, '../../..');
const raw = await readFile(resolve(owned, 'isolated-6e3e316-once.json'));
const report = JSON.parse(raw);
const receipt = JSON.parse(await readFile(resolve(owned, 'isolated-6e3e316-once-cleanup.json')));
const native = JSON.parse(await readFile(resolve(owned, 'native-frozen.json')));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });

test('all sixteen historical files and the actual isolation driver remain unchanged', async () => {
  assert.equal(Object.keys(report.immutable).length, 16);
  for (const [path, proof] of Object.entries(report.immutable)) {
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256);
    assert.equal(sha256(git('show', `${proof.commit}:${path}`)), proof.sha256);
    assert.equal(report.immutableEndpoint[path], proof.sha256);
  }
  assert.equal(sha256(await readFile(resolve(root, report.driver.path))), report.driver.sha256);
  assert.equal(report.sourceCommit, '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a');
  assert.equal(report.initialCommit, '17bbd47d3b7d1c372312ab45bb0f250fef68e0d9');
});

test('the complete archived source and root manifests match committed Git blobs', () => {
  const paths = git('ls-tree', '-r', '--name-only', report.sourceCommit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().trim().split('\n');
  assert.deepEqual(Object.keys(report.archive.committedFiles).sort(), paths.sort());
  assert.equal(report.archive.extractedFileCount, paths.length);
  assert.equal(report.archive.sourceFileCount, paths.filter(path => path.startsWith('src/')).length);
  assert.equal(report.archive.sourceOverlay, false);
  for (const [path, proof] of Object.entries(report.archive.committedFiles)) {
    assert.equal(sha256(git('cat-file', 'blob', proof.blob)), proof.sha256, path);
    assert.equal(report.manifests[report.initial].archive[path], proof.sha256);
    assert.equal(report.manifests[report.endpoint].archive[path], proof.sha256);
  }
});

test('only needed frozen fixtures and the new import guard were copied', async () => {
  const prefix = 'tests/shell-stress/errexit-holdout/';
  assert.deepEqual(Object.keys(report.archive.copyProof).sort(), ['acceptance-product.mjs', 'cases.mjs', 'host.mjs', 'isolated-trace.mjs', 'native-frozen.json'].map(name => prefix + name).sort());
  for (const [path, proof] of Object.entries(report.archive.copyProof)) {
    assert.equal(proof.sha256, proof.currentSha256); assert.equal(proof.sha256, proof.copySha256);
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256);
    if (proof.commit) assert.equal(sha256(git('show', `${proof.commit}:${path}`)), proof.sha256);
    else assert.equal(path, `${prefix}isolated-trace.mjs`);
  }
  assert.equal(report.helper.before, report.helper.after);
});

test('the full unique cohort and all frozen exact comparisons are preserved', () => {
  assert.equal(report.rows.length, 112);
  assert.equal(new Set(report.rows.map(row => `${row.role}:${row.id}`)).size, 112);
  for (const role of ['bash', 'sh']) assert.deepEqual(report.rows.filter(row => row.role === role).map(row => row.id), cases.map(specimen => specimen.id));
  assert.deepEqual(report.rows.filter(row => row.role === 'host').map(row => row.id), hostCases.map(specimen => specimen.id));
  assert.equal(report.rows.flatMap(row => row.comparisons).length, 216);
  assert.equal(report.nativeReused, true); assert.equal(report.freshNativeRuns, 0);
  assert.equal(report.nativeSha256, sha256(Buffer.from(`${JSON.stringify(native, null, 2)}\n`)));
  for (const row of report.rows) for (const comparison of row.comparisons) {
    const reference = native.profiles.find(profile => profile.id === comparison.profile).rows.find(reference => reference.id === row.id);
    const expected = { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects };
    assert.deepEqual(comparison.expected, expected);
    assert.equal(comparison.rawPass, Object.keys(expected).every(field => isDeepStrictEqual(row.actual[field], expected[field])));
    assert.equal(comparison.accepted, row.valid && comparison.rawPass);
  }
  for (const summary of report.summary) {
    const comparisons = summary.profile === 'host' ? report.rows.filter(row => row.role === 'host') : report.rows.flatMap(row => row.comparisons.filter(comparison => comparison.profile === summary.profile));
    assert.equal(summary.denominator, comparisons.length);
    assert.equal(summary.rawExact, comparisons.filter(comparison => comparison.rawPass).length);
    assert.equal(summary.accepted, comparisons.filter(comparison => comparison.accepted).length);
  }
});

test('actual public imports are archive Git blobs, never live source aliases', () => {
  for (const row of report.rows) {
    assert.equal(row.valid, true); assert.equal(row.fullPublicImport, true);
    assert.deepEqual(row.loadIssues, []); assert.deepEqual(row.committedIssues, []);
    const before = report.manifests[row.before], after = report.manifests[row.after];
    const loads = report.manifests[row.loads];
    assert.ok(loads.length > 100);
    for (const load of loads) {
      assert.equal(load.valid, true); assert.equal(load.liveSource, false); assert.equal(load.beforeHash, load.hash);
      assert.equal(load.hash, load.expected);
      if (load.category === 'product') {
        assert.ok(load.path.startsWith(`${report.archive.root}/src/`));
        assert.ok(load.real.startsWith(`${report.archive.root}/src/`));
        assert.equal(report.archive.committedFiles[load.key].sha256, load.hash);
      }
      const inventory = load.category === 'toolchain' ? 'toolchain' : 'archive';
      assert.equal(before[inventory][load.key], load.hash); assert.equal(after[inventory][load.key], load.hash);
    }
    const product = report.manifests[row.loadedProduct];
    for (const path of ['src/index.ts', 'src/commands/index.ts', 'src/commands/search/rg.ts', 'src/fs/webdav/webdav.ts', 'src/shell/runtime.ts', 'src/shell/parser.ts']) assert.equal(product[path], report.archive.committedFiles[path].sha256);
  }
});

test('archive and symlinked development toolchain guards are stable at every phase', () => {
  assert.equal(report.archiveAndToolchainStable, true);
  assert.deepEqual(report.manifests[report.initial], report.manifests[report.endpoint]);
  for (const row of report.rows) {
    assert.equal(row.changed, false);
    assert.deepEqual(report.manifests[row.before], report.manifests[row.after]);
    assert.deepEqual(report.manifests[row.before].toolSymlink, report.archive.toolSymlink);
    assert.equal(row.process.cwd, report.archive.root);
    assert.deepEqual(row.forbidden, []);
  }
  assert.equal(report.archive.toolSymlink.realpath, report.archive.toolchainRoot);
  for (const [key, value] of Object.entries(report.manifests)) assert.equal(sha256(JSON.stringify(value)), key);
});

test('unchanged product driver retains source, launcher identity and full effect modes', () => {
  for (const row of report.rows.filter(row => row.role !== 'host')) {
    const launch = invocation(cases.find(specimen => specimen.id === row.id), row.role);
    assert.deepEqual(row.launch.nativeLaunch, launch);
    assert.deepEqual(row.launch.args, launch.args.slice(2));
    assert.deepEqual(row.launch.actualInvocations[0], { command: row.role, args: launch.args.slice(2) });
    assert.equal(row.launch.stdin, launch.stdin);
    for (const effect of Object.values(row.actual.effects)) { assert.equal(effect.kind, 'file'); assert.equal(effect.mode, 0o644); assert.equal(Buffer.from(effect.bytes, 'base64').toString('base64'), effect.bytes); }
    for (const stream of ['stdout', 'stderr']) assert.equal(Buffer.from(row.actual[stream], 'base64').toString('base64'), row.actual[stream]);
  }
});

test('audit evidence was saved before removal and every child group was cleaned', () => {
  assert.equal(report.cleanup.auditSavedBeforeCleanup, true);
  assert.equal(report.cleanup.allGroupsAbsent, true);
  assert.equal(receipt.evidenceSha256, sha256(raw));
  assert.equal(receipt.directory, report.archive.temporaryParent);
  assert.equal(receipt.directoryRemoved, true); assert.equal(receipt.allGroupsAbsent, true);
  assert.equal(existsSync(receipt.directory), false);
  for (const row of report.rows) { assert.equal(row.run.timedOut, false); assert.equal(row.run.overflow, false); assert.equal(row.run.signal, null); assert.equal(row.run.groupAlive, false); }
});
