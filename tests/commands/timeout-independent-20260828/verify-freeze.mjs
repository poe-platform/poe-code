import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactRationalDuration, materialize } from './oracle.mjs';
import { controlledClock } from './clock.mjs';
import { families } from './families.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), repository = resolve(scope, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(join(scope, name)));
const manifest = read('MANIFEST.json'), binding = read('BINDINGS.json');
assert.match(process.argv[2] ?? '', /^[a-f0-9]{40}$/u);
for (const [name, digest] of Object.entries(manifest.files)) {
  assert.ok(!name.split('/').includes('AGENTS.md') && !/\.[mc]?ts$/u.test(name));
  const bytes = fs.readFileSync(join(scope, name)); assert.equal(hash(bytes), digest, name);
  const frozen = execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repository, 'show', `${process.argv[2]}:${relative(repository, scope)}/${name}`], { timeout: 15000 });
  assert.equal(hash(frozen), digest, name);
}
for (const row of binding.references) {
  assert.equal(hash(fs.readFileSync(join(repository, row.path))), row.sha256, row.path);
  assert.equal(hash(execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repository, 'show', `${row.commit}:${row.path}`], { timeout: 15000 })), row.sha256, row.path);
}
for (const tool of binding.tools) assert.equal(hash(fs.readFileSync(tool.path)), tool.sha256);
assert.equal(families.length, 32); assert.equal(new Set(families.map(row => row.id)).size, 32);
for (const row of families) { assert.equal(row.status, 'FROZEN-PROSPECTIVE-NOT-EXECUTED'); assert.ok(row.assertions.length >= 3); assert.ok(row.basis.length > 0); }
const numeric = read('NUMERIC.json');
for (const row of numeric.vectors) {
  const input = materialize(row.input); assert.equal(input.length, row.codeUnits); assert.equal(hash(input), row.sha256); assert.deepEqual(exactRationalDuration(input), row.expected);
}
const controls = [];
for (const [input, value] of [['0', '0'], ['.00001m', '1'], ['.0000001d', '9'], ['1.0001s', '1001'], ['.999999999999999999999d', '86400000'], ['9007199254740.991s', '9007199254740991']]) {
  assert.deepEqual(exactRationalDuration(input), { kind: 'milliseconds', value }); controls.push(`rational-known:${input}`);
}
for (const input of ['1\n', '900719925474099199999x']) { assert.deepEqual(exactRationalDuration(input), { kind: 'invalid-duration' }); controls.push('rational-grammar-complete'); }
assert.deepEqual(exactRationalDuration('9007199254740.9911s'), { kind: 'duration-overflow' }); controls.push('rational-overflow');
for (const handle of [undefined, null, 0, false, '']) {
  const clock = controlledClock({ handles: [handle] });
  let callbackCalls = 0;
  const actual = clock.scheduler.setTimeout(() => { callbackCalls++; }, 1); assert.ok(Object.is(actual, handle));
  assert.equal(callbackCalls, 0); assert.equal(clock.live, 1); clock.scheduler.clearTimeout(actual); assert.equal(clock.live, 0);
  await clock.wake(0, 1); assert.equal(callbackCalls, 1); assert.equal(clock.peak, 1);
  assert.throws(() => clock.scheduler.clearTimeout(actual));
  controls.push('clock-falsy-handle-and-single-queued-offer');
}
const clock = controlledClock(); clock.scheduler.setTimeout(() => {}, 1);
assert.throws(() => clock.scheduler.setTimeout(() => {}, 1)); controls.push('clock-rejects-two-live');
assert.throws(() => clock.scheduler.now.call({})); controls.push('clock-receiver');
clock.scheduler.clearTimeout(clock.rows[0].handle);
assert.equal(clock.live, 0);
const native = read('NATIVE.json'); assert.equal(native.rows.length, 12); assert.equal(native.nativeRowsExecuted, 0);
for (const executable of [native.oracle, native.shell]) assert.equal(hash(fs.readFileSync(executable.path)), executable.sha256);
assert.equal(binding.productExecuted, 0); assert.equal(binding.nativeExecuted, 0); assert.equal(binding.implementationCandidate, null);
const report = { schema: 'timeout-independent-freeze-validation/1', at: new Date().toISOString(), freezeCommit: process.argv[2], manifestSha256: hash(fs.readFileSync(join(scope, 'MANIFEST.json'))), authenticatedReferences: binding.references.length, families: families.length, numericVectors: numeric.vectors.length, diagnosticRecords: binding.diagnostics.length, developmentHelperControls: { expected: controls.length, passed: controls.length, controls }, nativeProspective: 12, nativeExecuted: 0, productExecuted: 0, authorImplementationReleased: false, noCandidateImports: true, status: 'PRECODE_FREEZE_VALIDATED_NOT_PRODUCT_ACCEPTANCE' };
fs.writeFileSync(join(scope, 'VALIDATION.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(report));
