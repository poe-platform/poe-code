import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadInputs, makePlan, nativeRequest, validateNativeRequest, validateReceipt, compare, validateMembership, admitGrant, hash, canonical, json } from './harness.mjs';
import './run.mjs';
import './virtual-case.mjs';
assert.deepEqual(process.argv.slice(2), ['--data-only']);
const { cases, protocol } = loadInputs();
const definitions = json('HELPER-CONTROLS.presealed.json');
const native = { id: 'DATA', status: 0, stdoutBase64: Buffer.from([65, 0, 66, 10]).toString('base64'), stderrBase64: '', files: [{ path: 'out', type: 'file', mode: 384, base64: 'QQ==' }] };
const virtual = { ...structuredClone(native), kind: 'result' };
const request = nativeRequest(cases.cases[0], '/private/tmp/DATA-NOT-CREATED/B01', { path: '/bin/bash' }, protocol.phases.qualification);
const receipt = { role: request.role, id: request.id, requestSha256: hash(Buffer.from(canonical(request))), retirement: 'COMPLETE', observerComplete: true, unknownProcesses: 0, processes: [{ identity: 'SYNTHETIC-NOT-A-PROCESS', pid: 1, bornObserved: true, exitObserved: true, reaped: true }], signal: null, captureOverflow: false, integrity: 'UNCHANGED', safetyStops: [], stdoutBase64: '', stderrBase64: '', status: 0 };
const changed = (original, update) => { const copy = structuredClone(original); update(copy); return copy; };
const tests = new Map([
  ['literal40-preserved', () => { assert.equal(cases.cases.length, 40); assert.equal(hash(fs.readFileSync(new URL('./CASES.original.json', import.meta.url))), '45ab3659b3769d33dc0a50fd9547ba96949540048aa7240385a674d85131ea29'); }],
  ['binary-exact-positive', () => assert.equal(compare(native, virtual).matched, true)],
  ['raw-stderr-prefix-not-normalized', () => assert.deepEqual(compare({ ...native, stderrBase64: Buffer.from('surface-case: line 1: bad').toString('base64') }, { ...virtual, stderrBase64: Buffer.from('bash: bad').toString('base64') }).differences, ['stderrBase64'])],
  ['nul-byte-difference', () => assert.equal(compare(native, { ...virtual, stdoutBase64: Buffer.from('AB\n').toString('base64') }).matched, false)],
  ['status-mismatch', () => assert.deepEqual(compare(native, { ...virtual, status: 1 }).differences, ['status'])],
  ['fs-byte-mismatch', () => assert.deepEqual(compare(native, changed(virtual, row => row.files[0].base64 = 'Qg==')).differences, ['filesystem'])],
  ['fs-mode-mismatch', () => assert.deepEqual(compare(native, changed(virtual, row => row.files[0].mode = 420)).differences, ['filesystem'])],
  ['fs-extra-file', () => assert.deepEqual(compare(native, changed(virtual, row => row.files.push({ path: 'extra' }))).differences, ['filesystem'])],
  ['host-rejection-not-status', () => assert.deepEqual(compare(native, { ...virtual, kind: 'API-rejection' }).differences, ['API_REJECTION_VS_NATIVE_STATUS'])],
  ['missing-case', () => assert.throws(() => validateMembership(cases.cases.slice(1), cases.cases.map(row => row.id)), /MISSING_DUPLICATE_OR_REORDERED_CASE/)],
  ['duplicate-case', () => assert.throws(() => validateMembership([...cases.cases.slice(1), cases.cases[1]], cases.cases.map(row => row.id)), /MISSING_DUPLICATE_OR_REORDERED_CASE/)],
  ['reordered-case', () => assert.throws(() => validateMembership([...cases.cases].reverse(), cases.cases.map(row => row.id)), /MISSING_DUPLICATE_OR_REORDERED_CASE/)],
  ['changed-program-refused', () => assert.throws(() => validateNativeRequest(changed(request, row => row.argv[3] += '; printf BAD'), request), /REQUEST_DRIFT/)],
  ['changed-env-refused', () => assert.throws(() => validateNativeRequest(changed(request, row => row.environment.BASH_ENV = '/not-allowed'), request), /REQUEST_DRIFT/)],
  ['unknown-retirement-refused', () => assert.throws(() => validateReceipt({ ...receipt, retirement: 'UNKNOWN' }, request), /UNKNOWN_RETIREMENT/)],
  ['duplicate-process-refused', () => assert.throws(() => validateReceipt(changed(receipt, row => row.processes.push(row.processes[0])), request), /DUPLICATE_PROCESS/)],
  ['unreaped-process-refused', () => assert.throws(() => validateReceipt(changed(receipt, row => row.processes[0].reaped = false), request), /UNRETIRED_PROCESS/)],
  ['capture-overflow-refused', () => assert.throws(() => validateReceipt({ ...receipt, stdoutBase64: Buffer.alloc(262145).toString('base64') }, request), /RAW_CAPTURE/)],
  ['missing-provider-refused', () => assert.throws(() => admitGrant({ schema: 'bash-surface-root-grant-v1', decision: 'GO', phase: 'qualification', presealSha256: 'DATA', root: protocol.phases.qualification.root, candidate: protocol.candidate, packageSha256: protocol.packageSha256, deadlineEpochMs: 2, bounds: protocol.phases.qualification, provider: null }, 'qualification', 'DATA', 1), /UNQUALIFIED_FENCE_OBSERVER_OR_DEPENDENCIES/)],
  ['no-semantic-local-fallback', () => assert.equal(makePlan('semantics').requests.every(row => row.executable === null), true)],
  ['all-original-inputs-null-expected', () => { assert.equal(cases.expected, null); assert.equal(cases.cases.some(row => Object.hasOwn(row, 'expected')), false); }],
  ['version-observation-no-qualification', () => assert.equal(makePlan('qualification').oracle.version, 'UNKNOWN')],
]);
assert.deepEqual([...tests.keys()], definitions.controls.map(row => row.id));
const rows = [];
for (const [id, test] of tests) {
  try { test(); rows.push({ id, pass: true, role: 'DATA_ONLY_NOT_NATIVE_PRODUCT_FENCE_PROOF' }); }
  catch (error) { rows.push({ id, pass: false, error: String(error), stack: error.stack }); }
}
console.log(JSON.stringify({ role: 'DATA_ONLY_NO_BASH_PRODUCT_WORKER_COMPILER', rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length }));
if (rows.some(row => !row.pass)) process.exitCode = 1;
