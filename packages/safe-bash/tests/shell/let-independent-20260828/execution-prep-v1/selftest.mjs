import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, save } from './artifacts.mjs';
import { classify, supervise } from './protocol.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), records = [];
const env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
for (const mode of ['pass', 'ordinary-failure', 'late-exit', 'late-throw', 'missing', 'duplicate', 'wrong-summary', 'split-utf8', 'hang', 'cap']) {
  const run = await supervise(process.execPath, [join(scope, 'protocol-fixture.mjs'), mode], { cwd: scope, env, timeoutMs: mode === 'hang' ? 300 : 5000, maxBytes: mode === 'cap' ? 512 : 16384 });
  const result = classify(run, mode === 'missing' ? ['F1', 'F2'] : ['F1']);
  assert.equal(result.accepted, mode === 'pass' || mode === 'split-utf8', mode);
  if (mode === 'ordinary-failure') { assert.equal(result.coherent, true); assert.deepEqual(result.failed, ['F1']); }
  if (mode === 'late-exit' || mode === 'late-throw') { assert.equal(result.passed, 1); assert.ok(result.errors.includes('exit status contradicts body outcomes')); }
  if (mode === 'split-utf8') assert.equal(result.observations[0].result.stdout, '雪😀');
  if (mode === 'hang') assert.equal(run.failure, 'deadline');
  if (mode === 'cap') assert.equal(run.failure, 'output-ceiling');
  assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true);
  records.push({ mode, run, result });
}
const fixture = records.find(row => row.mode === 'ordinary-failure').run;
const modulePath = '/fixture/actual-loaded-runtime.js', moduleSha256 = 'a'.repeat(64);
const validMutant = { ...fixture, stdout: JSON.stringify({ load: { path: modulePath, sha256: moduleSha256 } }) + '\n' + fixture.stdout + JSON.stringify({ activation: { id: 'M-test', hits: 1 } }) + '\n' };
const required = { modulePath, moduleSha256, mutantId: 'M-test', requiredFailed: ['F1'] };
const comparatorControls = [];
for (const mode of ['complete-model', 'missing-load', 'wrong-load-hash', 'missing-activation', 'no-designated-failure', 'late-nonzero-all-pass']) {
  let changed = structuredClone(validMutant), expectation = required;
  if (mode === 'missing-load') changed.stdout = changed.stdout.split('\n').filter(line => !line.includes('"load"')).join('\n');
  if (mode === 'wrong-load-hash') changed.stdout = changed.stdout.replace(moduleSha256, 'b'.repeat(64));
  if (mode === 'missing-activation') changed.stdout = changed.stdout.split('\n').filter(line => !line.includes('"activation"')).join('\n');
  if (mode === 'no-designated-failure') expectation = { ...required, requiredFailed: ['OTHER'] };
  if (mode === 'late-nonzero-all-pass') changed = { ...records.find(row => row.mode === 'late-exit').run };
  const result = classify(changed, ['F1'], expectation); assert.equal(result.mutantKilled, mode === 'complete-model');
  comparatorControls.push({ mode, result, qualification: 'receipt-classifier model only; not product/module execution or a real LET mutant' });
}
const refusal = await supervise(process.execPath, [join(scope, 'run-review.mjs')], { cwd: scope, env, timeoutMs: 5000 });
assert.equal(refusal.code, 78); assert.match(refusal.stderr, /explicit root-authorized/u); assert.equal(refusal.groupAbsent, true); assert.equal(refusal.failure, null);
const report = { kind: 'LET harness-only preparation controls; no candidate', capturedAt: new Date().toISOString(), node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, files: Object.fromEntries(['protocol.mjs', 'protocol-fixture.mjs', 'selftest.mjs', 'run-review.mjs'].map(name => [name, hash(readFileSync(join(scope, name)))])), actualReceiptChildren: records.length, records, comparatorControls, admissionRefusal: refusal, productExecutions: 0, builds: 0, nativeReruns: 0, allOwnedChildrenReaped: true };
if (process.argv[2]) save(process.argv[2], report);
process.stdout.write(JSON.stringify({ receiptChildren: records.length, classifierModels: comparatorControls.length, missingCandidateRefusal: 78, allOwnedChildrenReaped: true, productExecutions: 0 }) + '\n');
