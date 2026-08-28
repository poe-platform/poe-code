import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const scratch = process.argv[2];
const payload = JSON.parse(fs.readFileSync(process.argv[3]));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const loads = [];
for (const entry of payload.files) {
  const filename = path.join(scratch, entry.path);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o777, entry.mode);
  assert.equal(stat.size, entry.bytes);
  assert.equal(hash(fs.readFileSync(filename)), entry.sha256);
}
const moduleRoot = path.join(scratch, 'capture-membership-v3');
const capture = await import(pathToFileURL(path.join(moduleRoot, 'capture-io.mjs')).href);
const controller = await import(pathToFileURL(path.join(moduleRoot, 'controller.mjs')).href);
const admission = await import(pathToFileURL(path.join(moduleRoot, 'controller-admission.mjs')).href);
for (const entry of payload.files.filter(entry => entry.path.endsWith('.mjs'))) loads.push({ url: pathToFileURL(path.join(scratch, entry.path)).href, sha256: entry.sha256, scope: 'exact static import closure of invoked harness, not universal loader trace' });
const observations = [];
let getterCalls = 0;
function observe(id, route, invoke, accepted, empty = false) {
  let value, reason, caught = false;
  try { value = invoke(); } catch (error) { caught = true; reason = error; }
  const row = { id, route, acceptedExpected: accepted, caught, reason: caught ? { name: reason?.name, code: reason?.code, message: reason?.message } : null };
  if (!caught) {
    row.bytes = value.bytes.length;
    row.sha256 = hash(value.bytes);
    if (value.entries) row.entries = value.entries.map(entry => ({ mode: entry.mode, type: entry.type, oid: entry.blob, pathHex: entry.pathBytes.toString('hex') }));
    if (value.root) row.root = value.root;
  }
  try {
    assert.equal(!caught, accepted);
    if (caught) assert.equal(reason?.code, 'CAPTURE_ADMISSION');
    else {
      assert.equal(value.bytes.toString('base64'), empty ? '' : payload.expected.stdoutBase64);
      if (route !== 'helper') {
        assert.deepEqual(row.entries, empty ? [] : payload.expected.entries);
        assert.equal(value.root, empty ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' : payload.expectedRoot);
      }
    }
    assert.equal(getterCalls, 0);
    row.status = 'PASS';
  } catch (error) { row.status = 'FAIL'; row.failure = error.message; }
  observations.push(row);
}
for (const control of payload.cases) {
  const directory = path.join(moduleRoot, 'runs/author-01/work', control.id);
  for (const route of ['helper', 'composed']) {
    const supplied = control.transform === 'getter' ? capture.boundManifest(control.id).manifest : undefined;
    if (supplied) Object.defineProperty(supplied, 'version', { get() { getterCalls++; throw new Error('GETTER_EXECUTED'); } });
    observe(control.id, route, () => route === 'helper' ? { bytes: capture.readCapture(directory, 'synthetic', control.id, supplied) } : controller.dataAdmission(control.id, supplied), control.accepted, control.id === 'empty');
  }
}
const restored = path.join(moduleRoot, 'runs/author-01/work/c18-original');
fs.unlinkSync(path.join(restored, payload.restore.remove));
for (const route of ['helper', 'composed']) observe('c18-restored', route, () => route === 'helper' ? { bytes: capture.readCapture(restored, 'synthetic', 'c18-original') } : controller.dataAdmission('c18-original'), true);
const positive = path.join(moduleRoot, 'runs/author-01/work/positive');
for (const [id, directory] of [['namespace-dot', positive + '/.'], ['namespace-dotdot', positive + '/../positive'], ['namespace-trailing-slash', positive + '/']]) {
  for (const route of ['helper', 'shared-controller']) observe(id, route, () => route === 'helper' ? { bytes: capture.readCapture(directory, 'synthetic', 'positive') } : admission.admitCapturedTree(directory, 'synthetic', 'positive'), false);
}
for (const route of ['helper', 'shared-controller']) {
  observe('missing-capture-id', route, () => route === 'helper' ? { bytes: capture.readCapture(positive, 'absent', 'positive') } : admission.admitCapturedTree(positive, 'absent', 'positive'), false);
  const supplied = capture.boundManifest('positive').manifest;
  supplied.files[0].sha256 = '0'.repeat(64);
  observe('self-asserted-manifest-hash', route, () => route === 'helper' ? { bytes: capture.readCapture(positive, 'synthetic', 'positive', supplied) } : admission.admitCapturedTree(positive, 'synthetic', 'positive', supplied), false);
}
assert.equal(observations.length, 52);
console.log(JSON.stringify({ schema: 'independent-c18-regular-data-v1', loads, observations, getterCalls, productActual: 0, symlinkOperations: 0 }));
process.exitCode = observations.some(row => row.status !== 'PASS') ? 1 : 0;
