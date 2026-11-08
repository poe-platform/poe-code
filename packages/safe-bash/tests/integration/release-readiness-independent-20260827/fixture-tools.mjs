import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { account } from './baseline/tests/integration/full-gate-20260827/account.mjs';
import { validateRuntimeResults } from './baseline/tests/plugins/qualified-current-release/runtime-coverage.mjs';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const boundary = JSON.parse(readFileSync(new URL('./boundary.json', import.meta.url)));
export const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url))).cases;

export function inventory(root) {
  const entries = [];
  function visit(relative) {
    const path = join(root, relative), stat = lstatSync(path);
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    entries.push({ path: relative, type, mode: stat.mode & 0o777,
      ...(type === 'file' ? { sha256: hash(readFileSync(path)) } : {}),
      ...(type === 'symlink' ? { target: readlinkSync(path) } : {}),
    });
    assert.notEqual(type, 'other', 'unsupported special input requires explicit admission');
    if (type === 'directory') for (const name of readdirSync(path).sort()) visit(relative ? `${relative}/${name}` : name);
  }
  visit('');
  return entries;
}

export function sameInventory(before, after) {
  assert.deepEqual(after, before, 'membership, type, mode, bytes or symlink target changed');
}

export function asset(path, expected) {
  assert.equal(lstatSync(path).isFile(), true);
  assert.equal(hash(readFileSync(path)), expected);
}

export function negative(result, expected, positive) {
  assert.equal(positive, 'pass');
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, expected);
}

export function cleanup(actual, expected) {
  assert.equal(actual.format, 'public-cleanup-committed-v1');
  assert.equal(actual.revision, expected.revision);
  assert.equal(actual.tree, expected.tree);
  assert.deepEqual(actual.files, expected.files);
}

export function defaults(names) {
  assert.deepEqual([...names].sort(), boundary.defaultNames);
  assert.equal(new Set(names).size, 73);
  for (const name of boundary.excludedDefaults) assert.ok(!names.includes(name));
}

export function migrations(changes) {
  assert.deepEqual(changes, boundary.migrations.map(({ path, from, to, assertionLines }) => ({ path, from, to, assertionLines })));
}

export function transport(result) {
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  assert.equal(result.timedOut, false);
  assert.equal(result.clean, true);
}

export function runtime(result) {
  transport(result);
  const accounting = account(result.stdout);
  assert.equal(accounting.reconciled, true);
  const groups = [{ name: 'synthetic-required-runtime', files: ['fixture.test.mts'], runtime: ['fixture.test.mjs'], nodeTests: 1 }];
  validateRuntimeResults(groups, [{ name: groups[0].name, compile: 'pass', runtimeResults: [
    { runtime: 'fixture.test.mjs', status: result.status, counts: { tests: accounting.summary.tests, ...accounting.counts } },
  ] }]);
}

export function permission(receipt) {
  transport(receipt.positive);
  assert.equal(receipt.denied.status, 1);
  assert.equal(receipt.denied.signal, null);
  assert.equal(receipt.denied.error, undefined);
  assert.match(receipt.denied.stderr, /ERR_ACCESS_DENIED/u);
  assert.match(receipt.denied.stderr, /FileSystemRead/u);
  assert.ok(receipt.denied.stderr.includes(receipt.forbidden));
  assert.deepEqual(receipt.fallbacks, []);
  assert.deepEqual(receipt.ambientNative, []);
  const reporter = receipt.argv.indexOf('--test-reporter=tap');
  assert.ok(reporter >= 0 && reporter < receipt.argv.indexOf('fixture.test.mjs'));
}

const commit = value => assert.match(value ?? '', /^[a-f0-9]{40}$/u);
const digest = value => assert.match(value ?? '', /^[a-f0-9]{64}$/u);
function binding(value) {
  assert.ok(value);
  commit(value.revision);
  assert.equal(typeof value.path, 'string');
  assert.ok(value.path && !value.path.startsWith('/') && !value.path.split('/').some(part => !part || part === '..' || part === '.'));
  digest(value.sha256);
}

export function candidateParameters(value) {
  assert.equal(value.mode, 'candidate-verification');
  binding(value.rootDeclaration);
  for (const key of ['fixtureFreezeCommit', 'patchCommit', 'sourceCommit', 'sourceTree']) commit(value[key]);
  binding(value.gateEntry);
  assert.equal(value.gateEntry.revision, value.patchCommit);
  assert.equal(value.package.name, 'virtual-bash');
  assert.equal(value.package.sourceRevision, value.sourceCommit);
  digest(value.package.manifestSha256);
  digest(value.package.tarballSha256);
  assert.ok(Array.isArray(value.nativeAssets) && value.nativeAssets.length >= 49);
  assert.equal(new Set(value.nativeAssets.map(entry => entry.id)).size, value.nativeAssets.length);
  for (const entry of value.nativeAssets) {
    assert.equal(typeof entry.path, 'string');
    assert.ok(entry.path.length > 0);
    digest(entry.expectedSha256);
    digest(entry.observedSha256);
    assert.equal(entry.observedSha256, entry.expectedSha256);
    binding(entry.sourceBinding);
  }
  const rg = value.nativeAssets.find(entry => entry.id === 'rg');
  assert.ok(rg);
  if (rg.expectedSha256 !== boundary.nativeRg.expectedSha256) binding(rg.explicitProfileApproval);
  binding(value.classifications);
  assert.equal(value.classifications.revision, value.sourceCommit);
  assert.deepEqual(value.classifications.individual.map(entry => entry.path).sort(), boundary.individualMts.map(entry => entry.path).sort());
  for (const entry of value.classifications.individual) {
    assert.ok(['current', 'negative-types', 'declaration', 'frozen-evidence', 'frozen-oracle'].includes(entry.classification));
    digest(entry.sha256);
    binding(entry.provenance);
    if (entry.classification === 'current' || entry.classification === 'negative-types') {
      binding(entry.route);
      if (entry.classification === 'negative-types') binding(entry.expectedDiagnostics);
    }
  }
  binding(value.cleanupManifest);
  assert.equal(value.cleanupManifest.revision, value.sourceCommit);
  assert.equal(value.cleanupManifest.tree, value.sourceTree);
  assert.equal(Object.keys(value.cleanupManifest.files).length, 244);
  for (const [path, sha256] of Object.entries(value.cleanupManifest.files)) binding({ path, sha256, revision: value.sourceCommit });
  commit(value.runtime.profileRevision);
  digest(value.runtime.executableSha256);
  digest(value.runtime.guardSha256);
  assert.deepEqual(value.cases, cases.map(entry => entry.id));
  assert.deepEqual(value.skippedCases, []);
  return 'structurally complete only: root approval and all Git/artifact bytes still require authentication';
}
