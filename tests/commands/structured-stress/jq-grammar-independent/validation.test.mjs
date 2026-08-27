import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadFrozen } from './evidence.mjs';
import { newTransports } from './common.mjs';
import { compare } from './harness.mjs';

test('native-only freeze and all historical cohorts have exact bounded denominators', () => {
  const evidence = loadFrozen();
  assert.deepEqual(evidence.counts, { grammar: { vectors: 35, executions: 178 }, main: { vectors: 256, executions: 790 }, legacy: { vectors: 94, executions: 376 } });
  assert.equal(evidence.native.nativeInvocations, 76);
  assert.equal(evidence.native.repeats, 2);
  assert.match(evidence.native.phase, /no virtual implementation imported/u);
  assert.equal(evidence.native.before.structuredSha256, evidence.manifest.acceptedStructuredSha256);
});

test('critical transports include every cut and both empty endpoints without multiplying long vectors', () => {
  const evidence = loadFrozen();
  const critical = evidence.native.cases.filter(vector => vector.allBoundaries);
  assert.equal(critical.length, 3);
  for (const vector of critical) {
    const length = Buffer.from(vector.inputHex, 'hex').length;
    const schedules = newTransports(vector);
    for (let offset = 0; offset <= length; offset++) assert.ok(schedules.includes(`split:${offset}`));
    assert.equal(schedules.length, length + 3);
  }
  assert.deepEqual(newTransports(evidence.native.cases.find(vector => vector.id === 'number-token-length-boundaries')), ['whole', 'bytewise']);
});

test('comparison rejects byte/status changes, stage loss, intermediate errors and fixture effects', () => {
  const expected = { status: 0, stdoutHex: '300a', stderrHex: '' };
  const vector = { expected, afterFiles: {}, stages: [{ expected }, { expected }] };
  const observed = { actual: { ...expected }, stages: [{ ...expected }, { ...expected }], afterFiles: {}, stageEffects: [{}, {}] };
  assert.equal(compare(vector, 'direct', observed).pass, true);
  for (const field of ['status', 'stdoutHex', 'stderrHex']) {
    const changed = structuredClone(observed);
    changed.actual[field] = field === 'status' ? 5 : '00';
    assert.equal(compare(vector, 'direct', changed).pass, false);
  }
  assert.equal(compare(vector, 'direct', { ...observed, stages: [expected] }).pass, false);
  assert.equal(compare(vector, 'direct', { ...observed, stages: [{ ...expected, status: 5 }, expected] }).pass, false);
  assert.equal(compare(vector, 'shell', { ...observed, afterFiles: { extra: '00' } }).pass, false);
  assert.equal(compare(vector, 'direct', { ...observed, stageEffects: [{ extra: '00' }, {}] }).pass, false);
});

test('native pipeline stages chain exact bytes and file effects remain frozen', () => {
  const { native } = loadFrozen();
  assert.equal(native.cases.filter(vector => vector.stages).length, 2);
  for (const vector of native.cases) {
    assert.deepEqual(vector.afterFiles, vector.files ?? {});
    if (!vector.stages) continue;
    let inputHex = vector.inputHex;
    for (const stage of vector.stages) {
      assert.equal(stage.inputHex, inputHex);
      inputHex = stage.expected.stdoutHex;
    }
    assert.equal(vector.expected.stdoutHex, inputHex);
    assert.equal(vector.expected.status, vector.stages.at(-1).expected.status);
    assert.equal(vector.expected.stderrHex, vector.stages.map(stage => stage.expected.stderrHex).join(''));
  }
});

test('22 historical canonical reds stay individually mapped and no proposal is approved', () => {
  const inventory = JSON.parse(readFileSync(new URL('./canonical-red-inventory.json', import.meta.url)));
  const evidence = loadFrozen();
  assert.equal(inventory.entries.length, 22);
  assert.equal(new Set(inventory.entries.map(entry => entry.name)).size, 22);
  assert.equal(new Set(inventory.entries.map(entry => entry.file)).size, 5);
  for (const entry of inventory.entries) {
    assert.equal(entry.fileSha256, evidence.manifest.historicalFiles[entry.file]);
    assert.ok(entry.nativeProbeIds.length > 0);
  }
  assert.match(inventory.proposalStatus, /NOT PROVIDED \/ NOT REVIEWED/u);
  assert.equal(inventory.entries.filter(entry => entry.preliminaryClassification.startsWith('MIXED:')).length, 3);
});
