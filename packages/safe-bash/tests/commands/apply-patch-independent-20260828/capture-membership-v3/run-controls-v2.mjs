import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { readCapture, boundManifest, sha256 } from './capture-io.mjs';
import { dataAdmission } from './controller.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), work = path.join(own, 'runs/author-01/work');
const controls = JSON.parse(fs.readFileSync(path.join(own, 'CONTROLS.json')));
const results = [], start = performance.now();
let getterCalls = 0, written = 0;
assert.equal(fs.existsSync(work), true); assert.ok(fs.lstatSync(work).isDirectory());
function transform(value, kind) {
  if (kind === null) return undefined;
  if (kind === 'cross-realm') return vm.runInNewContext(`(${JSON.stringify(value)})`);
  if (kind === 'null-prototype') {
    const convert = item => item === null || typeof item !== 'object' ? item : Array.isArray(item) ? item.map(convert) : Object.assign(Object.create(null), Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, convert(entry)])));
    return convert(value);
  }
  const getter = () => { getterCalls++; throw new Error('getter must not execute'); };
  switch (kind) {
    case 'getter': Object.defineProperty(value, 'version', { get: getter }); break;
    case 'array-getter': Object.defineProperty(value.files, '0', { get: getter }); break;
    case 'hole': delete value.files[0]; break;
    case 'array-extra': value.files.extra = 1; break;
    case 'symbol': value[Symbol('extra')] = 1; break;
    case 'nonenumerable': Object.defineProperty(value, 'extra', { value: 1 }); break;
    case 'inherited': delete value.version; Object.setPrototypeOf(value, { version: 3 }); break;
    case 'nan': value.version = NaN; break;
    case 'boxed': value.version = new Number(3); break;
    case 'wrong-order': value.files.reverse(); break;
    case 'self-asserted-hash': value.sha256 = sha256(Buffer.from(JSON.stringify(value))); break;
    default: throw new Error('unknown frozen transform');
  }
  return value;
}
function fixture(control) {
  const directory = path.join(work, control.id); if (control.id === 'file-symlink') assert.ok(fs.lstatSync(directory).isDirectory()); else fs.mkdirSync(directory);
  for (const file of control.files) {
    const filename = path.join(directory, file.name);
    if (file.type === 'directory') fs.mkdirSync(filename);
    else if (file.type === 'symlink') { assert.ok(fs.lstatSync(filename).isSymbolicLink()); assert.equal(fs.readlinkSync(filename), path.join(directory, file.target)); }
    else {
      const bytes = Buffer.from(file.raw ?? file.base64, 'base64'); written += bytes.length;
      assert.ok(written < 64 * 1024 * 1024); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: file.mode }); fs.chmodSync(filename, file.mode);
    }
  }
  return directory;
}
function execute(control, directory, label = control.id) {
  for (const route of ['helper', 'composed']) {
    assert.ok(performance.now() - start < 45000, 'child finite control deadline');
    const { manifest } = boundManifest(control.id), supplied = transform(manifest, control.transform);
    let actual, reason;
    try { actual = route === 'helper' ? { bytes: readCapture(directory, 'synthetic', control.id, supplied) } : dataAdmission(control.id, supplied); }
    catch (caught) { reason = caught; }
    const admitted = actual !== undefined;
    let verificationError;
    try {
      assert.equal(admitted, control.accepted, 'frozen admission expectation');
      if (!admitted) {
        assert.equal(reason?.code, 'CAPTURE_ADMISSION', 'rejection must arise at real admission, not permission/setup/parser');
      } else {
        assert.equal(actual.bytes.toString('base64'), control.id === 'empty' ? '' : controls.originalC01Expected.stdoutBase64);
        if (route === 'composed') {
          const entries = actual.entries.map(entry => ({ mode: entry.mode, type: entry.type, oid: entry.blob, pathHex: entry.pathBytes.toString('hex') }));
          assert.deepEqual(entries, control.id === 'empty' ? [] : controls.originalC01Expected.entries);
          assert.equal(actual.root, control.id === 'empty' ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' : controls.expectedRoot);
        }
      }
      assert.equal(getterCalls, 0);
    } catch (caught) { verificationError = caught; }
    results.push({ id: label, route, expectedAccepted: control.accepted, admitted, status: verificationError ? 'FAIL' : 'PASS', bytes: actual?.bytes.length, sha256: actual ? sha256(actual.bytes) : undefined, entries: actual?.entries?.length, root: actual?.root, rejection: reason ? { name: reason.name, code: reason.code, message: reason.message } : null, failure: verificationError?.message });
  }
}
for (const control of controls.cases) execute(control, fixture(control));
const original = controls.cases.find(control => control.id === 'c18-original');
fs.unlinkSync(path.join(work, original.id, controls.restore.remove));
execute({ ...original, accepted: true }, path.join(work, original.id), 'c18-restored');
assert.equal(results.filter(row => row.route === 'helper').length, controls.expected.helper);
assert.equal(results.filter(row => row.route === 'composed').length, controls.expected.composed);
console.log(JSON.stringify({ schema: 'c18-author-data-observations-v3', results, getterCalls, writtenBytes: written, elapsedMs: performance.now() - start, productActual: 0, runtimeDispatches: 0, helper: { total: controls.expected.helper, passed: results.filter(row => row.route === 'helper' && row.status === 'PASS').length }, composed: { total: controls.expected.composed, passed: results.filter(row => row.route === 'composed' && row.status === 'PASS').length } }));
process.exitCode = results.some(row => row.status === 'FAIL') ? 1 : 0;
