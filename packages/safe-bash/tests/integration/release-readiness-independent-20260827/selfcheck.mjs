import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyInventory } from './baseline/tests/plugins/qualified-current-release/inventory-check.mjs';
import { asset, boundary, candidateParameters, cases, cleanup, defaults, hash, inventory, migrations, negative, permission, runtime, sameInventory } from './fixture-tools.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const clone = value => structuredClone(value);
const success = () => ({ status: 0, signal: null, timedOut: false, clean: true });
const tap = status => `TAP version 13\n${status === 'fail' || status === 'cancelled' ? 'not ok' : 'ok'} 1 - independent control${status === 'skipped' ? ' # SKIP fixture' : status === 'todo' ? ' # TODO fixture' : ''}\n${status === 'cancelled' ? '  ---\n  failureType: testAborted\n  ...\n' : ''}1..1\n# tests 1\n# suites 0\n# pass ${status === 'pass' ? 1 : 0}\n# fail ${status === 'fail' ? 1 : 0}\n# cancelled ${status === 'cancelled' ? 1 : 0}\n# skipped ${status === 'skipped' ? 1 : 0}\n# todo ${status === 'todo' ? 1 : 0}\n# duration_ms 1\n`;

function inventoryCase(id) {
  const directory = mkdtempSync(join(owned, '.fixture-'));
  try {
    assert.equal(lstatSync(directory).isDirectory(), true);
    writeFileSync(join(directory, 'input'), 'before\n');
    mkdirSync(join(directory, 'empty'));
    symlinkSync('input', join(directory, 'link'));
    if (id === 'inventory-postsetup-baseline') {
      mkdirSync(join(directory, 'dist'));
      writeFileSync(join(directory, 'dist/setup-output'), 'legitimate setup artifact\n');
    }
    const before = inventory(directory);
    const actions = {
      'inventory-added-file': () => writeFileSync(join(directory, 'new-input'), 'addition\n'),
      'inventory-added-empty-directory': () => mkdirSync(join(directory, 'new-empty')),
      'inventory-removed-file': () => rmSync(join(directory, 'input')),
      'inventory-modified-bytes': () => writeFileSync(join(directory, 'input'), 'after!\n'),
      'inventory-file-to-directory': () => { rmSync(join(directory, 'input')); mkdirSync(join(directory, 'input')); },
      'inventory-directory-to-file': () => { rmSync(join(directory, 'empty'), { recursive: true }); writeFileSync(join(directory, 'empty'), 'replacement'); },
      'inventory-file-to-symlink': () => { rmSync(join(directory, 'input')); symlinkSync('missing', join(directory, 'input')); },
      'inventory-symlink-retarget': () => { rmSync(join(directory, 'link')); symlinkSync('missing', join(directory, 'link')); },
      'inventory-new-symlink': () => symlinkSync('input', join(directory, 'new-link')),
      'inventory-new-dangling-symlink': () => symlinkSync('missing', join(directory, 'dangling')),
      'inventory-symlink-to-file': () => { rmSync(join(directory, 'link')); writeFileSync(join(directory, 'link'), 'replacement'); },
      'inventory-mode-change': () => chmodSync(join(directory, 'input'), 0o700),
    };
    actions[id]?.();
    return () => sameInventory(before, inventory(directory));
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    pendingDirectories.push(directory);
  }
}

const pendingDirectories = [];

function classificationCase(id, omitted = 0) {
  const files = Object.fromEntries(boundary.individualMts.map((entry, index) => [entry.path, Buffer.from(`synthetic consumer ${index}\n`)]));
  files['fixture-evidence.json'] = Buffer.from('synthetic evidence\n');
  const entries = boundary.individualMts.map((entry, index) => ({ path: entry.path,
    classification: index === 1 ? 'negative-types' : index === 2 ? 'frozen-evidence' : index === 3 ? 'declaration' : 'current',
    sha256: hash(files[entry.path]),
    ...(index === 2 ? { freeze: { sourceCommit: boundary.revision, packageSha256: hash('synthetic package'), evidence: [{ path: 'fixture-evidence.json', sha256: hash(files['fixture-evidence.json']) }] } } : {}),
  }));
  const current = entries.filter(entry => entry.classification === 'current').map(entry => entry.path);
  const negatives = [entries[1].path];
  const tracked = entries.map(entry => entry.path);
  if (id === 'classification-omission') entries.splice(omitted, 1);
  if (id === 'classification-invalid') entries[0].classification = 'ignore';
  if (id === 'classification-multiple') entries.push({ ...entries[0], classification: 'declaration' });
  if (id === 'classification-current-unrouted') current.pop();
  if (id === 'classification-negative-unrouted') negatives.pop();
  if (id === 'classification-historical-changed') files[entries[2].path] = Buffer.from('changed history');
  if (id === 'classification-declaration-changed') files[entries[3].path] = Buffer.from('changed declaration');
  if (id === 'classification-freeze-evidence-changed') files['fixture-evidence.json'] = Buffer.from('changed provenance');
  const counts = {};
  for (const entry of entries) counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;
  return () => {
    const result = verifyInventory({ entries, counts }, tracked, current, negatives, path => files[path]);
    assert.equal(result.current, 8);
    assert.ok(!current.includes(entries[2].path), 'historical input must not be a current pass');
  };
}

function parameters() {
  const binding = { revision: boundary.revision, path: 'synthetic/binding.json', sha256: hash('synthetic binding') };
  return {
    mode: 'candidate-verification', rootDeclaration: binding, fixtureFreezeCommit: boundary.revision,
    patchCommit: boundary.revision, sourceCommit: boundary.observationRevision, sourceTree: boundary.observationTree,
    gateEntry: binding,
    package: { name: 'virtual-bash', sourceRevision: boundary.observationRevision, manifestSha256: hash('manifest'), tarballSha256: hash('tarball') },
    nativeAssets: Array.from({ length: 49 }, (_, index) => ({ id: index === 48 ? 'rg' : `synthetic-${index}`, path: `fixture/asset-${index}`, expectedSha256: index === 48 ? boundary.nativeRg.expectedSha256 : hash(`asset-${index}`), observedSha256: index === 48 ? boundary.nativeRg.expectedSha256 : hash(`asset-${index}`), sourceBinding: binding })),
    classifications: { ...binding, revision: boundary.observationRevision, individual: boundary.individualMts.map(entry => ({ path: entry.path, sha256: entry.sha256, classification: 'current', route: binding, provenance: binding })) },
    cleanupManifest: { ...binding, revision: boundary.observationRevision, tree: boundary.observationTree, files: clone(boundary.cleanupObservation.files) },
    runtime: { profileRevision: boundary.revision, executableSha256: hash('synthetic runtime'), guardSha256: hash('synthetic guard') },
    cases: cases.map(entry => entry.id), skippedCases: [],
  };
}

function prepare(row) {
  const { id, group } = row;
  if (group === 'inventory') return inventoryCase(id);
  if (group === 'classification') return classificationCase(id);
  if (group === 'asset') {
    if (id === 'asset-rg-observed-not-expected') return () => assert.equal(boundary.nativeRg.observedSha256, boundary.nativeRg.expectedSha256);
    const directory = mkdtempSync(join(owned, '.fixture-'));
    pendingDirectories.push(directory);
    const path = join(directory, 'native-asset');
    const accepted = Buffer.from('independent inert native asset fixture v1\n');
    if (id !== 'asset-missing') writeFileSync(path, id === 'asset-wrong-bytes' ? Buffer.from('wrong asset\n') : accepted);
    const expected = '6afe59dd4b71ade0d4a735e1a361776c4644c1e5938da6a11413ef19633a95a0';
    assert.equal(hash(accepted), expected, 'frozen synthetic asset identity');
    return () => asset(path, expected);
  }
  if (group === 'negative') {
    const expected = boundary.negativeControl.stdout;
    const result = { status: 2, signal: null, stdout: expected, stderr: '' };
    if (id === 'negative-wrong-line') result.stdout = expected.replace('(2,41)', '(3,41)');
    if (id === 'negative-wrong-code') result.stdout = expected.replace('TS2741', 'TS2322');
    if (id === 'negative-missing-module') result.stdout = "invalid-binding.mts(1,1): error TS2307: Cannot find module 'virtual-bash'.\n";
    if (id === 'negative-unexpected-success') result.status = 0;
    return () => negative(result, expected, id === 'negative-positive-control-failed' ? 'fail' : 'pass');
  }
  if (group === 'defaults') {
    const names = [...boundary.defaultNames];
    if (id === 'defaults-old70') names.splice(70);
    if (boundary.excludedDefaults.some(name => id === `defaults-${name}`)) names[0] = id.slice('defaults-'.length);
    return () => defaults(names);
  }
  if (group === 'counts') {
    const changes = boundary.migrations.map(({ path, from, to, assertionLines }) => ({ path, from, to, assertionLines }));
    if (id === 'counts-one-migration') changes.pop();
    if (id === 'counts-historical-rewrite') changes.push({ path: 'tests/plugins/stream-five-public/current-profile.mjs', from: 70, to: 73 });
    if (id === 'counts-wrong-value') changes[0].to = 74;
    return () => migrations(changes);
  }
  if (group === 'cleanup') {
    const expected = boundary.cleanupObservation, actual = clone(expected), paths = Object.keys(actual.files);
    if (id === 'cleanup-missing-source') delete actual.files[paths[0]];
    if (id === 'cleanup-stale-source') actual.files[paths[0]] = hash('stale source');
    if (id === 'cleanup-swapped-path') { actual.files['src/not-approved.ts'] = actual.files[paths[0]]; delete actual.files[paths[0]]; }
    if (id === 'cleanup-wrong-revision') actual.revision = boundary.revision;
    if (id === 'cleanup-wrong-tree') actual.tree = '0'.repeat(40);
    return () => cleanup(actual, expected);
  }
  if (group === 'runtime') {
    const result = { ...success(), stdout: tap('pass') };
    if (id === 'runtime-nonzero') result.status = 1;
    if (id === 'runtime-abnormal-exit') { result.status = null; result.error = 'spawn failure'; }
    if (id === 'runtime-timeout') result.timedOut = true;
    if (id === 'runtime-signal') result.signal = 'SIGTERM';
    if (id === 'runtime-missing-tap') result.stdout = '';
    if (id === 'runtime-truncated-tap') result.stdout = result.stdout.split('# tests')[0];
    for (const [suffix, status] of [['failed', 'fail'], ['cancelled', 'cancelled'], ['skipped', 'skipped'], ['todo', 'todo']]) if (id === `runtime-${suffix}`) result.stdout = tap(status);
    if (id === 'runtime-invalid-count') result.stdout = result.stdout.replace('# tests 1', '# tests NaN');
    if (id === 'runtime-wrong-count') result.stdout = result.stdout.replace('# tests 1', '# tests 2');
    return () => runtime(result);
  }
  if (group === 'permission') {
    const receipt = { positive: success(), denied: { status: 1, signal: null, stderr: 'ERR_ACCESS_DENIED FileSystemRead /frozen/source/src/index.ts' }, forbidden: '/frozen/source/src/index.ts', fallbacks: [], ambientNative: [], argv: ['--test-reporter=tap', 'fixture.test.mjs'] };
    if (id === 'permission-missing-positive') receipt.positive.status = 1;
    if (id === 'permission-unknown-flag') receipt.denied.stderr = 'bad option: --permission';
    if (id === 'permission-wrong-resource') receipt.denied.stderr = 'ERR_ACCESS_DENIED FileSystemRead /wrong/file';
    if (id === 'permission-source-fallback') receipt.fallbacks.push('/live/src/index.ts');
    if (id === 'permission-live-dist-fallback') receipt.fallbacks.push('/live/dist/index.d.ts');
    if (id === 'permission-ambient-native') receipt.ambientNative.push('/usr/bin/rg');
    if (id === 'permission-tap-flag-after-input') receipt.argv.reverse();
    return () => permission(receipt);
  }
  if (group === 'binding') {
    const value = id === 'binding-pending-template' ? JSON.parse(readFileSync(new URL('./candidate-template.json', import.meta.url))) : parameters();
    if (id === 'binding-mutable-head') value.sourceCommit = 'HEAD';
    if (id === 'binding-missing-asset') value.nativeAssets.pop();
    if (id === 'binding-missing-classification') value.classifications.individual.pop();
    if (id === 'binding-missing-cleanup-manifest') value.cleanupManifest = null;
    if (id === 'binding-skipped-case') { value.skippedCases = [value.cases.pop()]; }
    return () => candidateParameters(value);
  }
  throw new Error(`Unimplemented case: ${id}`);
}

test('fixture boundary and baseline module integrity', () => {
  assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
  assert.equal(boundary.candidate, null);
  assert.equal(boundary.individualMts.length, 11);
  assert.equal(new Set(boundary.individualMts.map(entry => entry.path)).size, 11);
  assert.ok(boundary.individualMts.every(entry => entry.classification === null));
  assert.equal(Object.keys(boundary.cleanupObservation.files).length, 244);
  for (const reference of boundary.references.filter(entry => [
    'tests/integration/full-gate-20260827/account.mjs',
    'tests/plugins/qualified-current-release/runtime-coverage.mjs',
    'tests/plugins/qualified-current-release/inventory-check.mjs',
    'tests/plugins/stream-five-public/current-profile.mjs',
  ].includes(entry.path))) assert.equal(hash(readFileSync(join(owned, 'baseline', reference.path))), reference.sha256);
});

for (const row of cases) test(`${row.id}: expected ${row.expected} (fixture only)`, () => {
  try {
    const check = prepare(row);
    if (row.expected === 'accept') check();
    else {
      assert.equal(row.expected, 'reject');
      assert.throws(check);
    }
    if (row.id === 'classification-omission') for (let index = 1; index < boundary.individualMts.length; index++) assert.throws(classificationCase(row.id, index), boundary.individualMts[index].path);
  } finally {
    for (const directory of pendingDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  }
});
