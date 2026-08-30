import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { directory, git, hash, json, root } from './common.mjs';

const manifest = json('FREEZE-MANIFEST.json');
for (const entry of manifest.entries) if (entry.kind === 'file') assert.equal(hash(readFileSync(path.join(directory, entry.path))), entry.sha256, entry.path);
for (const entry of [...manifest.baseline.files, ...manifest.historical.flatMap(cohort => cohort.files), ...manifest.futureVariantObligations.controls.map(control => control.source)]) {
  assert.equal(hash(git(['show', `${entry.commit}:${entry.path}`])), entry.sha256, entry.path);
  if (manifest.historical.some(cohort => entry.path.startsWith(`${cohort.prefix}/`))) assert.equal(hash(readFileSync(path.join(root, entry.path))), entry.sha256, entry.path);
}
const inputs = json('INPUTS.json');
const native = json('native-01.json');
const expected = json('EXPECTED-PROFILES.json');
assert.equal(hash(readFileSync(path.join(directory, 'INPUTS.json'))), native.inputSha256);
assert.equal(expected.inputSha256, native.inputSha256);
assert.equal(expected.nativeCaptureSha256, hash(readFileSync(path.join(directory, 'native-01.json'))));
assert.equal(inputs.cases.length, 32);
assert.equal(new Set(inputs.cases.map(row => JSON.stringify([row.subject, row.pattern]))).size, 32);
assert.deepEqual(inputs.cases.map(row => row.id), native.rows.map(row => row.id));
for (const row of expected.rows) for (const [name, observed] of Object.entries(row.qualified)) {
  const actual = native.rows.find(item => item.id === row.id).observations[name];
  assert.deepEqual(observed, { status: actual.status, signal: actual.signal, error: actual.error, stdoutHex: actual.stdoutHex, stderrHex: actual.stderrHex });
}
console.log(JSON.stringify({ verified: true, counts: manifest.counts, historicalTestsExecuted: 0, enginesExecuted: 0 }));
