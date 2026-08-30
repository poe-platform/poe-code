import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { commandCases, shebangCases } from './aligned-cases.mjs';
import { hostIds } from './hosts.mjs';
import { owned, sha256, transport } from './support.mjs';

const read = async name => JSON.parse(await readFile(resolve(owned, name)));
const native = await read('native-aligned.json');
const initial = await read('native-frozen.json');
test('both complete native profiles and initial capture remain distinct', () => {
  for (const capture of [initial, native]) {
    assert.equal(capture.failure, null);
    assert.equal(capture.productExecutions, 0);
    assert.equal(capture.profiles.length, 2);
    assert.deepEqual(capture.toolsBefore, capture.toolsAfter);
    assert.deepEqual(capture.inputsBefore, capture.inputsAfter);
    for (const profile of capture.profiles) {
      assert.equal(profile.rows.length, 55);
      assert.equal(profile.rows.filter(row => row.category === 'command').length, 42);
      assert.equal(profile.rows.filter(row => row.category === 'single-optional').length, 6);
      assert.equal(profile.rows.filter(row => row.category === 'kernel').length, 6);
      for (const row of profile.rows) if (row.category !== 'bounded') assert.ok(transport(row.result), row.id);
    }
  }
});
test('aligned inputs match every actual command and whole-profile optional-argument launch', () => {
  for (const profile of native.profiles) {
    assert.deepEqual(profile.rows.filter(row => row.category === 'command').map(row => row.id), commandCases.map(row => row.id));
    for (const row of profile.rows) {
      assert.equal(row.env.LC_ALL, 'C'); assert.equal(row.env.LANG, 'C'); assert.equal(row.env.TZ, 'UTC');
      if (row.category === 'command') {
        assert.deepEqual(row.args, commandCases.find(specimen => specimen.id === row.id).args);
        assert.deepEqual(row.after, row.before, row.id);
      } else if (row.category === 'single-optional') {
        assert.equal(row.args[0], shebangCases.find(specimen => specimen.id === row.id).optional);
        assert.equal(row.args.length, 4);
        assert.equal(row.fixture.sha256, sha256(row.fixture.source));
      }
      if (row.recorderOutput) {
        assert.equal(row.recorderOutput.argc, row.recorderOutput.argvHex.length);
        assert.equal(row.recorderOutput.stdinHex, row.stdinHex);
        assert.equal(Buffer.from(row.recorderOutput.cwdHex, 'hex').toString(), row.cwd);
      }
      assert.equal(row.after.effect.mode, 0o644);
    }
  }
});
test('actual GNU failure statuses and native capability controls are retained, not waived', () => {
  const rows = native.profiles[0].rows;
  const status = id => rows.find(row => row.category === 'command' && row.id === id).result.status;
  assert.equal(status('plain-argv-positive'), 0);
  assert.equal(status('invalid-bare-dollar'), 125);
  assert.equal(status('missing-command-negative'), 127);
  assert.equal(status('nonexecutable-command-negative'), 126);
  assert.ok(rows.filter(row => row.category === 'command').every(row => !Object.hasOwn(row.after, 'injected')));
  assert.equal(rows.find(row => row.category === 'single-optional' && row.id === 'non-s-packed-bash-option').result.status, 127);
});
test('Darwin kernel tokenization is actual separate proof, not the virtual single-argument oracle', () => {
  const kernel = JSON.parse(Buffer.from(native.controls.kernel.result.stdout, 'base64').toString());
  const literal = JSON.parse(Buffer.from(native.controls.literalSingleOptional.result.stdout, 'base64').toString());
  assert.equal(kernel.argc, 5); assert.equal(literal.argc, 4);
  assert.deepEqual(kernel.argvHex.slice(1, 3).map(hex => Buffer.from(hex, 'hex').toString()), ['alpha', 'beta']);
  assert.equal(Buffer.from(literal.argvHex[1], 'hex').toString(), 'alpha beta');
  for (const profile of native.profiles) {
    const row = profile.rows.find(row => row.category === 'bounded');
    assert.equal(row.boundedObservationIsNotNativePass, true);
    assert.equal(row.result.timedOut, true); assert.equal(row.result.groupAlive, false);
  }
});
test('initial fixture issue is preserved with exactly three command and one script corrections', async () => {
  const before = await read('native-inputs.json'), after = await read('aligned-inputs.json');
  assert.equal(before.files['native.mjs'], sha256(await readFile(resolve(owned, 'native-initial.mjs'))));
  const changed = before.commandCases.filter((row, index) => JSON.stringify(row) !== JSON.stringify(after.commandCases[index]));
  assert.equal(changed.length, 3);
  assert.equal(before.shebangCases.filter((row, index) => JSON.stringify(row) !== JSON.stringify(after.shebangCases[index])).length, 1);
  for (const [name, expected] of Object.entries(after.files)) assert.equal(sha256(await readFile(resolve(owned, name))), expected, name);
});
test('host controls are only prepared and cleanup binds both native captures', async () => {
  assert.equal(hostIds.length, 7);
  const provenance = await read('provenance.json');
  assert.equal(provenance.productBaseline.freshExecutions, 0);
  assert.equal(provenance.productBaseline.currentAcceptance, null);
  assert.equal(Object.keys(provenance.source).length, 177);
  for (const [name, raw] of [['native-cleanup.json', 'native-frozen.json'], ['aligned-cleanup.json', 'native-aligned.json']]) {
    const cleanup = await read(name);
    assert.equal(cleanup.rawSha256, sha256(await readFile(resolve(owned, raw))));
    assert.ok(cleanup.directoryRemoved && cleanup.allRecordedGroupsAbsent);
  }
});
