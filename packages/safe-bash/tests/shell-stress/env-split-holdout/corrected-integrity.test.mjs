import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { git, owned, root, sha256, transport } from './support.mjs';

const read = async name => JSON.parse(await readFile(resolve(owned, name)));
const baseline = await read('baseline-e7f4f2e-bytes-v2.json');
const previous = await read('baseline-e7f4f2e.json');
const native = await read('native-aligned.json');
const rows = baseline.records.filter(record => record.kind === 'row');
const hosts = baseline.records.filter(record => record.kind === 'host');
const prefix = 'tests/shell-stress/env-split-holdout';

test('all twenty original files and six initial-baseline files remain byte immutable', async () => {
  assert.equal(Object.keys(baseline.historyBefore).length, 26);
  assert.deepEqual(baseline.historyBefore, baseline.historyAfter);
  assert.deepEqual(baseline.frozenBefore, baseline.frozenAfter);
  assert.equal(Object.keys(baseline.frozenBefore).length, 20);
  for (const [path, proof] of Object.entries(baseline.historyBefore)) {
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256, path);
    assert.equal(sha256(git(['cat-file', 'blob', proof.blob])), proof.sha256, path);
  }
  assert.equal(previous.denominators.rowsExact, 1);
  assert.equal(previous.records.filter(record => record.kind === 'row' && !record.observationAvailable).length, 6);
  assert.equal(previous.denominators.hostsPassed, 0);
});

test('versioned helper differs only in the one authorized byte-API setup conversion', async () => {
  const oldHelper = git(['show', `${baseline.inputCommit}:${prefix}/product-row.mjs`]).toString();
  const oldProbe = git(['show', `${baseline.inputCommit}:${prefix}/probe.mjs`]).toString();
  const correction = baseline.setupCorrection;
  assert.equal(oldHelper.split(correction.oldWrite).length, 2);
  assert.equal(await readFile(resolve(owned, 'product-row-bytes-v2.mjs'), 'utf8'), oldHelper.replace(correction.oldWrite, correction.newWrite));
  assert.equal(correction.newWrite, 'await fs.writeFile(row.fixture.path, new TextEncoder().encode(row.fixture.virtualSource), { mode: row.fixture.mode });');
  assert.equal(await readFile(resolve(owned, 'probe-bytes-v2.mjs'), 'utf8'), oldProbe.replace("from './product-row.mjs'", "from './product-row-bytes-v2.mjs'"));
  assert.deepEqual(correction.versionedBefore, baseline.versionedAfter);
  for (const [name, hash] of Object.entries(correction.versionedBefore)) assert.equal(sha256(await readFile(resolve(owned, name))), hash, name);
  const hostSource = await readFile(resolve(owned, 'hosts.mjs'), 'utf8');
  assert.equal(hostSource.includes('writeFile'), false);
  assert.equal(sha256(hostSource), correction.hostsUnchanged.sha256);
});

test('all six fixture texts encode to their intended exact UTF-8 bytes without changing bindings', () => {
  assert.equal(baseline.setupCorrection.fixtures.length, 6);
  for (const fixture of baseline.setupCorrection.fixtures) {
    const reference = native.profiles[0].rows.find(row => row.id === fixture.id && row.category === 'single-optional');
    assert.deepEqual(fixture.fixtureUnchanged, reference.fixture);
    assert.equal(fixture.path, reference.fixture.path);
    assert.equal(fixture.mode, reference.fixture.mode);
    assert.equal(fixture.intendedHex, Buffer.from(reference.fixture.virtualSource, 'utf8').toString('hex'));
    assert.equal(fixture.encodedHex, fixture.intendedHex);
    assert.equal(sha256(Buffer.from(fixture.encodedHex, 'hex')), fixture.sha256);
  }
});

test('same complete48 plus seven hosts execute once, with six actual shebang product observations', () => {
  assert.equal(rows.length, 48); assert.equal(hosts.length, 7);
  assert.equal(baseline.records.length, 55);
  assert.equal(new Set(baseline.records.map(record => `${record.kind}/${record.category}/${record.id}`)).size, 55);
  assert.deepEqual(baseline.records.map(record => [record.kind, record.category, record.id]), previous.records.map(record => [record.kind, record.category, record.id]));
  assert.equal(rows.filter(record => record.observationAvailable).length, 48);
  for (const record of baseline.records) {
    assert.ok(transport(record.child));
    assert.ok(record.guard.valid);
    if (record.kind === 'row') {
      assert.equal(record.child.status, 0);
      assert.deepEqual(record.parsed.result.forbiddenAttempts, []);
      assert.equal(typeof record.comparison.actual.status, 'number');
    }
  }
  for (const record of rows.filter(record => record.category === 'command')) {
    const prior = previous.records.find(candidate => candidate.kind === record.kind && candidate.category === record.category && candidate.id === record.id);
    assert.deepEqual(record.comparison.actual, prior.comparison.actual);
  }
});

test('both whole frozen native profiles retain hashes; no fresh or selectively switched oracle', async () => {
  assert.deepEqual(baseline.nativeBefore, baseline.nativeAfter);
  assert.equal(baseline.nativeCapture.freshNativeExecutions, 0);
  assert.equal(baseline.nativeCapture.sha256, sha256(await readFile(resolve(owned, 'native-aligned.json'))));
  assert.equal(native.profiles.length, 2);
  assert.ok(native.profiles.every(profile => profile.rows.length === 55));
  for (const [path, proof] of Object.entries(baseline.nativeBefore)) assert.equal(sha256(await readFile(path)), proof.sha256, path);
  const references = native.profiles[0].rows.filter(row => ['command', 'single-optional'].includes(row.category));
  assert.deepEqual(rows.map(row => [row.id, row.category]), references.map(row => [row.id, row.category]));
  for (const row of rows) {
    const reference = references.find(candidate => candidate.id === row.id && candidate.category === row.category);
    assert.equal(row.comparison.profile, native.profiles[0].id);
    assert.deepEqual(row.comparison.expected, { status: reference.result.status, stdout: reference.result.stdout, stderr: reference.result.stderr, effects: reference.after });
    for (const key of ['status', 'stdout', 'stderr', 'effects']) assert.equal(row.comparison.fields[key], isDeepStrictEqual(row.comparison.actual[key], row.comparison.expected[key]));
    assert.equal(row.comparison.exact, Object.values(row.comparison.fields).every(Boolean));
    const actual = row.parsed.result.result;
    assert.deepEqual(actual.incomingEnv, reference.env);
    assert.equal(actual.stdinHex, reference.stdinHex);
    assert.deepEqual(actual.fixtureBinding, reference.fixture ? { native: reference.fixture.source, virtual: reference.fixture.virtualSource } : null);
  }
});

test('full committed public source and actual loaded dependencies pass all phase guards', () => {
  assert.equal(baseline.sourceCommit, 'e7f4f2e3753184415f8098445c2009cb4cd9a6e9');
  assert.equal(Object.keys(baseline.sourceArchive.committed).length, 216);
  assert.equal(Object.keys(baseline.sourceArchive.sourceHashes).length, 212);
  assert.equal(Object.keys(baseline.sourceArchive.copied).length, 23);
  assert.equal(baseline.failure, null);
  assert.ok(Object.values(baseline.guard).every(Boolean));
  const archive = baseline.sourceArchive.archive;
  for (const record of baseline.records) {
    assert.deepEqual(record.request.sourceHashes, previous.sourceArchive.sourceHashes);
    assert.deepEqual(baseline.manifests[record.before], baseline.manifests[record.after]);
    assert.equal(record.guard.publicIndexLoads, 1);
    for (const load of baseline.manifests[record.loads]) {
      assert.ok(load.valid);
      assert.equal(load.hash, load.before); assert.equal(load.hash, load.expected);
      if (load.path.startsWith(`${archive}/src/`)) assert.equal(load.hash, baseline.sourceArchive.committed[load.path.slice(archive.length + 1)].sha256);
      assert.equal(load.path.startsWith(`${root}/src/`), false);
    }
  }
});

test('versioned cleanup binds its raw evidence and leaves no owned archive or child group', async () => {
  const cleanup = await read('baseline-e7f4f2e-bytes-v2-cleanup.json');
  assert.equal(cleanup.rawSha256, sha256(await readFile(resolve(owned, 'baseline-e7f4f2e-bytes-v2.json'))));
  assert.ok(cleanup.directoryRemoved && cleanup.allRecordedGroupsAbsent);
});
