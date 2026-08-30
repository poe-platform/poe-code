import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { git, owned, root, sha256, transport } from './support.mjs';

const read = async name => JSON.parse(await readFile(resolve(owned, name)));
const baseline = await read('baseline-e7f4f2e.json');
const native = await read('native-aligned.json');
test('all twenty frozen files and complete native profiles remain immutable', async () => {
  assert.equal(Object.keys(baseline.frozenBefore).length, 20);
  assert.deepEqual(baseline.frozenBefore, baseline.frozenAfter);
  for (const [path, proof] of Object.entries(baseline.frozenBefore)) {
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256, path);
    assert.equal(sha256(git(['cat-file', 'blob', proof.blob])), proof.sha256, path);
  }
  assert.equal(native.profiles.length, 2);
  assert.ok(native.profiles.every(profile => profile.rows.length === 55));
  assert.equal(baseline.nativeCapture.freshNativeExecutions, 0);
  assert.equal(baseline.nativeCapture.sha256, sha256(await readFile(resolve(owned, 'native-aligned.json'))));
});
test('actual native executable identities still match both frozen whole profiles', async () => {
  assert.deepEqual(baseline.nativeBefore, baseline.nativeAfter);
  for (const [path, proof] of Object.entries(baseline.nativeBefore)) assert.equal(sha256(await readFile(path)), proof.sha256, path);
});
test('all48 original row slots and seven hosts execute once without shrinking denominators', () => {
  const rows = baseline.records.filter(record => record.kind === 'row');
  const hosts = baseline.records.filter(record => record.kind === 'host');
  assert.equal(rows.length, 48); assert.equal(hosts.length, 7);
  const reference = native.profiles[0].rows.filter(row => ['command', 'single-optional'].includes(row.category));
  assert.deepEqual(rows.map(row => [row.id, row.category]), reference.map(row => [row.id, row.category]));
  assert.equal(rows.filter(row => row.comparison.exact).length, 1);
  assert.equal(rows.filter(row => row.observationAvailable).length, 42);
  assert.equal(hosts.filter(row => row.hostPassed).length, 0);
  for (const record of baseline.records) assert.ok(transport(record.child));
});
test('every actual source import is inside the complete archive and matches its Git blob', () => {
  assert.equal(baseline.sourceCommit, 'e7f4f2e3753184415f8098445c2009cb4cd9a6e9');
  assert.equal(Object.keys(baseline.sourceArchive.committed).length, 216);
  assert.equal(Object.keys(baseline.sourceArchive.sourceHashes).length, 212);
  assert.equal(baseline.failure, null);
  assert.ok(Object.values(baseline.guard).every(Boolean));
  const archive = baseline.sourceArchive.archive;
  for (const record of baseline.records) {
    assert.ok(record.guard.valid);
    assert.deepEqual(baseline.manifests[record.before], baseline.manifests[record.after]);
    for (const load of baseline.manifests[record.loads]) {
      assert.ok(load.valid);
      assert.equal(load.hash, load.before); assert.equal(load.hash, load.expected);
      if (load.path.startsWith(`${archive}/src/`)) assert.equal(load.hash, baseline.sourceArchive.committed[load.path.slice(archive.length + 1)].sha256);
    }
    assert.equal(record.guard.publicIndexLoads, 1);
  }
});
test('exact native tuples, modes and missing observations are retained, not normalized', () => {
  for (const row of baseline.records.filter(record => record.kind === 'row')) {
    const reference = native.profiles[0].rows.find(record => record.id === row.id && record.category === row.category);
    assert.deepEqual(row.comparison.expected, { status: reference.result.status, stdout: reference.result.stdout, stderr: reference.result.stderr, effects: reference.after });
    for (const key of ['status', 'stdout', 'stderr', 'effects']) assert.equal(row.comparison.fields[key], isDeepStrictEqual(row.comparison.actual?.[key], row.comparison.expected[key]));
    if (!row.observationAvailable) {
      assert.equal(row.comparison.actual, null);
      assert.equal(row.comparison.exact, false);
      assert.equal(row.category, 'single-optional');
      assert.match(Buffer.from(row.child.stderr, 'base64').toString(), /Memory files require Uint8Array data/u);
    }
  }
});
test('source setup error is a frozen helper issue and cleanup proof binds the raw run', async () => {
  const fixtureWriter = git(['show', `${baseline.inputCommit}:tests/shell-stress/env-split-holdout/product-row.mjs`]).toString();
  assert.ok(fixtureWriter.includes('await fs.writeFile(row.fixture.path, row.fixture.virtualSource, { mode: row.fixture.mode });'));
  const cleanup = await read('baseline-e7f4f2e-cleanup.json');
  assert.equal(cleanup.rawSha256, sha256(await readFile(resolve(owned, 'baseline-e7f4f2e.json'))));
  assert.ok(cleanup.directoryRemoved && cleanup.allRecordedGroupsAbsent);
});
