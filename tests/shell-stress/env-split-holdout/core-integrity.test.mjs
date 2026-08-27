import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { git, owned, root, sha256, transport } from './support.mjs';

const json = async name => JSON.parse(await readFile(resolve(owned, name)));
const evidence = await json('core-candidate-84ab66c.json');
const prior = await json('baseline-e7f4f2e-bytes-v2.json');
const original = await json('baseline-e7f4f2e.json');
const native = await json('native-aligned.json');
const rows = evidence.records.filter(record => record.kind === 'row');
const hosts = evidence.records.filter(record => record.kind === 'host');

test('all34 frozen files and both red histories remain immutable', async () => {
  assert.equal(evidence.setupCorrection.historyCommit, '258879a4fae6b7e771ff2f266396c97e39400130');
  assert.equal(Object.keys(evidence.historyBefore).length, 34);
  assert.deepEqual(evidence.historyBefore, evidence.historyAfter);
  for (const [path, proof] of Object.entries(evidence.historyBefore)) {
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256, path);
    assert.equal(sha256(git(['cat-file', 'blob', proof.blob])), proof.sha256, path);
  }
  assert.equal(original.denominators.rowsExact, 1);
  assert.equal(original.records.filter(record => record.kind === 'row' && !record.observationAvailable).length, 6);
  assert.equal(prior.denominators.rowsExact, 2);
  assert.equal(prior.denominators.hostsPassed, 0);
  for (const [name, hash] of Object.entries(evidence.versionedAfter)) assert.equal(sha256(await readFile(resolve(owned, name))), hash, name);
});

test('same48 rows and seven hosts run once with unchanged source, fixtures and native assertions', () => {
  assert.equal(rows.length, 48); assert.equal(hosts.length, 7);
  assert.deepEqual(evidence.records.map(record => [record.kind, record.category, record.id]), prior.records.map(record => [record.kind, record.category, record.id]));
  assert.equal(new Set(evidence.records.map(record => `${record.kind}/${record.category}/${record.id}`)).size, 55);
  for (const row of rows) {
    const previous = prior.records.find(record => record.id === row.id && record.category === row.category);
    assert.ok(row.observationAvailable);
    assert.equal(row.parsed.result.result.source, previous.parsed.result.result.source);
    assert.deepEqual(row.parsed.result.result.incomingEnv, previous.parsed.result.result.incomingEnv);
    assert.equal(row.parsed.result.result.stdinHex, previous.parsed.result.result.stdinHex);
    assert.deepEqual(row.parsed.result.result.fixtureBinding, previous.parsed.result.result.fixtureBinding);
    assert.deepEqual(row.comparison.expected, previous.comparison.expected);
    assert.deepEqual(row.parsed.result.forbiddenAttempts, []);
  }
});

test('raw40/48 means exact status and all bytes and effects; eight failures remain failures', () => {
  assert.equal(rows.filter(row => row.comparison.exact).length, 40);
  assert.equal(rows.filter(row => row.category === 'command' && row.comparison.exact).length, 39);
  assert.equal(rows.filter(row => row.category === 'single-optional' && row.comparison.exact).length, 1);
  for (const row of rows) {
    const reference = native.profiles[0].rows.find(item => item.id === row.id && item.category === row.category);
    assert.deepEqual(row.comparison.expected, { status: reference.result.status, stdout: reference.result.stdout, stderr: reference.result.stderr, effects: reference.after });
    assert.equal(row.comparison.profile, native.profiles[0].id);
    for (const key of ['status', 'stdout', 'stderr', 'effects']) assert.equal(row.comparison.fields[key], isDeepStrictEqual(row.comparison.actual[key], row.comparison.expected[key]));
    assert.equal(row.comparison.exact, Object.values(row.comparison.fields).every(Boolean));
  }
  const diagnosticLosses = rows.filter(row => row.category === 'command' && !row.comparison.exact);
  assert.equal(diagnosticLosses.length, 3);
  for (const row of diagnosticLosses) assert.deepEqual(row.comparison.fields, { status: true, stdout: true, stderr: false, effects: true });
  for (const row of rows.filter(row => row.category === 'single-optional' && !row.comparison.exact)) assert.equal(row.comparison.actual.status, 126);
});

test('six real hosts pass; invalid invoke ByteSource host remains one unrepaired raw failure', async () => {
  assert.equal(hosts.filter(row => row.hostPassed).length, 6);
  const failure = hosts.find(row => !row.hostPassed);
  assert.equal(failure.id, 'literal-invoke-replace-env-parent');
  assert.equal(failure.child.status, 1);
  assert.equal(failure.parsed, null);
  assert.match(Buffer.from(failure.child.stderr, 'base64').toString(), /actual: 'parent:private'/u);
  assert.match(Buffer.from(failure.child.stderr, 'base64').toString(), /expected: 'abcparent:private'/u);
  const hostSource = await readFile(resolve(owned, 'hosts.mjs'), 'utf8');
  assert.ok(hostSource.includes("env: { TOKEN: 'a b' }, stdin: new Uint8Array(), stdinIsDefault: false"));
  assert.equal(new Uint8Array()[Symbol.asyncIterator], undefined);
  assert.ok(git(['show', `${evidence.sourceCommit}:src/contracts/command.ts`]).toString().includes('readonly stdin?: ByteSource;'));
  assert.ok(git(['show', `${evidence.sourceCommit}:src/shell/input.ts`]).toString().includes('source[Symbol.asyncIterator]()'));
  for (const row of hosts.filter(item => item.hostPassed)) assert.deepEqual(row.parsed.result.forbiddenAttempts, []);
});

test('full candidate source, manifest, actual imports and dependencies remain authenticated', () => {
  assert.equal(evidence.sourceCommit, '84ab66ca717e0dff21abf57051b41cb553f3c7f3');
  assert.equal(Object.keys(evidence.sourceArchive.committed).length, 217);
  assert.equal(Object.keys(evidence.sourceArchive.sourceHashes).length, 213);
  assert.equal(evidence.sourceArchive.committed['src/shell/runtime.ts'].sha256, prior.sourceArchive.committed['src/shell/runtime.ts'].sha256);
  assert.equal(evidence.failure, null);
  assert.ok(Object.values(evidence.guard).every(Boolean));
  assert.deepEqual(evidence.sourceChanges.authorCommit.trim().split('\n'), ['A\tsrc/commands/env-split.ts', 'M\tsrc/commands/execution.ts']);
  assert.match(evidence.sourceChanges.baselineToCandidate, /M\tpackage.json/u);
  const archive = evidence.sourceArchive.archive;
  for (const record of evidence.records) {
    assert.ok(transport(record.child)); assert.ok(record.guard.valid);
    assert.equal(record.guard.publicIndexLoads, 1);
    assert.deepEqual(evidence.manifests[record.before], evidence.manifests[record.after]);
    for (const load of evidence.manifests[record.loads]) {
      assert.ok(load.valid); assert.equal(load.before, load.hash); assert.equal(load.expected, load.hash);
      if (load.path.startsWith(`${archive}/src/`)) assert.equal(load.hash, evidence.sourceArchive.committed[load.path.slice(archive.length + 1)].sha256);
      assert.equal(load.path.startsWith(`${root}/src/`), false);
    }
  }
});

test('both complete native profiles retain original captures and current binary identities', async () => {
  assert.equal(native.profiles.length, 2);
  assert.ok(native.profiles.every(profile => profile.rows.length === 55));
  assert.equal(evidence.nativeCapture.freshNativeExecutions, 0);
  assert.equal(evidence.nativeCapture.sha256, sha256(await readFile(resolve(owned, 'native-aligned.json'))));
  assert.deepEqual(evidence.nativeBefore, evidence.nativeAfter);
  for (const [path, proof] of Object.entries(evidence.nativeBefore)) assert.equal(sha256(await readFile(path)), proof.sha256, path);
});

test('scoped two-root TypeScript check has actual guarded reads and zero diagnostics', () => {
  const check = evidence.typecheck;
  assert.ok(check.valid); assert.ok(transport(check.child)); assert.equal(check.child.status, 0);
  assert.equal(check.parsed.roots.length, 2); assert.equal(check.parsed.reads.length, 182);
  assert.deepEqual(check.parsed.diagnostics, []);
  const archive = evidence.sourceArchive.archive;
  for (const read of check.parsed.reads) {
    assert.equal(read.before, read.after); assert.equal(read.before, read.expected);
    if (read.path.startsWith(`${archive}/src/`)) assert.equal(read.before, evidence.sourceArchive.committed[read.path.slice(archive.length + 1)].sha256);
  }
});

test('cleanup is bound to this new raw evidence and all owned child groups are absent', async () => {
  const cleanup = await json('core-candidate-84ab66c-cleanup.json');
  assert.equal(cleanup.rawSha256, sha256(await readFile(resolve(owned, 'core-candidate-84ab66c.json'))));
  assert.ok(cleanup.directoryRemoved && cleanup.allRecordedGroupsAbsent);
});
