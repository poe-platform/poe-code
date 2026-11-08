import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { owned, root, sha256, transport } from './support.mjs';

const read = async name => JSON.parse(await readFile(resolve(owned, name)));
const native = await read('aligned-native-20260827.json');
const comparison = await read('aligned-comparison-20260827.json');
const inputs = await read('inputs.json');
const baseline = await read('baseline-6e3e316.json');
const specimens = inputs.rows.filter(row => ['differential', 'syntax', 'gaps'].includes(row.cohort));
test('all twenty original owned files and imported process helper remain frozen', async () => {
  assert.equal(Object.keys(native.beforeInputs).length, 21);
  assert.deepEqual(native.beforeInputs, native.afterInputs);
  for (const [path, proof] of Object.entries(native.beforeInputs)) {
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256);
    assert.equal(sha256(execFileSync('/usr/bin/git', ['cat-file', 'blob', proof.blob], { cwd: root, maxBuffer: 64 * 1024 * 1024 })), proof.sha256);
  }
});
test('two complete native profiles use one exact source/name/argv/environment protocol', () => {
  assert.equal(native.total, 176);
  assert.deepEqual(native.profiles.map(profile => profile.id), ['gnu53', 'apple32']);
  assert.deepEqual(native.toolsBefore, native.toolsAfter);
  for (const profile of native.profiles) {
    assert.equal(native.toolsBefore[profile.path].sha256, profile.sha256);
    assert.deepEqual(profile.rows.map(row => row.id), specimens.map(row => row.id));
    for (const [index, row] of profile.rows.entries()) {
      const input = specimens[index];
      assert.equal(row.source, input.source);
      assert.equal(row.sourceSha256, sha256(input.source));
      assert.equal(row.inputSha256, sha256(JSON.stringify(input)));
      assert.equal(row.argv0, 'bash');
      assert.deepEqual(row.args, ['--noprofile', '--norc', '-c', input.source, 'shell']);
      assert.equal(row.stdinHex, input.stdinHex);
      assert.deepEqual(row.files, input.files);
      assert.deepEqual(row.env, { PATH: '/usr/bin:/bin', HOME: row.cwd, TMPDIR: row.cwd, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', ...input.env });
      assert.ok(transport(row.result), row.id);
    }
  }
});
test('existing name/line controls are actual separate native observations', () => {
  assert.equal(native.extraExistingNameLineControls, 2);
  const original = inputs.rows.find(row => row.id === 'control/name-line');
  for (const profile of native.profiles) {
    const row = profile.existingNameLineControl;
    assert.equal(row.source, original.source);
    assert.ok(transport(row.result));
    assert.equal(Buffer.from(row.result.stdout, 'base64').toString(), 'name=shell\n');
    assert.equal(row.result.status, 2);
    assert.notEqual(row.result.stderr, '');
  }
});
test('all 88 product observations are reused unchanged guarded direct exec', async () => {
  assert.equal(native.productExecutions, 0);
  assert.equal(comparison.productReused.freshExecutions, 0);
  assert.equal(comparison.productReused.observations, 88);
  for (const [name, expected] of Object.entries(comparison.inputs)) assert.equal(sha256(await readFile(resolve(owned, name))), expected);
  for (const profile of comparison.profiles) for (const row of profile.rows) {
    const prior = baseline.records.find(record => record.id === row.id && record.context === 'original');
    assert.ok(prior.valid);
    assert.deepEqual(row.virtual, prior.result.actual);
    assert.equal(prior.result.launch.actualSource, row.source);
    assert.deepEqual(prior.result.launch.calls, []);
    assert.deepEqual(baseline.manifests[prior.before], baseline.manifests[prior.after]);
    for (const load of baseline.manifests[prior.loads]) {
      assert.ok(load.valid);
      assert.equal(load.liveSource, false);
      if (load.category === 'product') assert.equal(load.hash, baseline.committed[load.key].sha256);
    }
  }
});
test('strict raw native tuples and every mode difference remain visible', () => {
  for (const profile of comparison.profiles) for (const row of profile.rows) {
    const reference = native.profiles.find(item => item.id === profile.id).rows.find(item => item.id === row.id);
    assert.deepEqual(row.native, { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects });
    for (const field of ['stdout', 'stderr', 'status', 'effects']) assert.equal(row.fields[field], isDeepStrictEqual(row.virtual[field], row.native[field]));
    assert.equal(row.fullTupleExact, Object.values(row.fields).every(Boolean));
    for (const difference of row.modeDifferences) {
      assert.equal(difference.native, reference.effects[difference.path].mode);
      assert.equal(difference.virtual, row.virtual.effects[difference.path].mode);
      assert.notEqual(difference.native, difference.virtual);
    }
  }
  assert.deepEqual(comparison.profiles.map(profile => [profile.total.originalComparedFieldsExact, profile.total.fullTupleExact, profile.total.modeLossRows]), [[88, 48, 40], [74, 37, 40]]);
});
test('cleanup and artifact seal bind this additive phase without candidate acceptance', async () => {
  assert.equal(native.directoryRemoved, true);
  const seal = await read('aligned-freeze.json');
  assert.equal(seal.candidateInspected, false);
  for (const [name, expected] of Object.entries(seal.files)) assert.equal(sha256(await readFile(resolve(owned, name))), expected, name);
});
