import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { composeFuture } from './compose-future.mjs';
import { canonical } from '../path-transport-v2-review/review-reference.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const prior = path.join(own, '../path-transport-v2'), review = path.join(own, '../path-transport-v2-review');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const captureJson = value => Buffer.from(JSON.stringify(value));
const oldControls = JSON.parse(fs.readFileSync(path.join(review, 'CONTROLS.json'))).controls;
const original = oldControls.find(row => row.id === 'C18'), positive = oldControls.find(row => row.id === 'C01');
assert.equal(original.input.records.length, 6); assert.equal(original.input.fragments.length, 5);
assert.deepEqual(original.input.records.slice(0, 5), positive.input.records);
assert.deepEqual(original.input.records[5], positive.input.records[0]);
const cases = [], manifests = {}, bindings = {};
const baseFiles = () => {
  const input = positive.input;
  return [{ name: 'synthetic.json', value: { id: 'synthetic', code: 0, signal: null, fault: null, closeObserved: true, groupAbsent: true, knownChildCleanup: true, bytes: input.bytes, stdoutSha256: input.stdoutSha256, stderrSha256: input.stderrSha256, fragments: input.fragments.map(({ recordIndex, ...rest }) => rest) } }, ...input.fragments.map(item => ({ name: item.name, value: input.records[item.recordIndex] }))].map(file => ({ ...file, mode: 0o644, type: 'file' }));
};
const manifestFor = files => ({ version: 3, files: files.map(file => ({ name: file.name, kind: file.name === 'synthetic.json' ? 'receipt' : 'fragment', mode: file.mode, bytes: captureJson(file.value).length, sha256: hash(captureJson(file.value)) })).sort((left, right) => left.name < right.name ? -1 : 1), captures: [{ id: 'synthetic', receipt: 'synthetic.json', fragments: files[0].value.fragments.map(item => item.name) }] });
function add(id, accepted, mutate = () => {}, rebind = false, transform = null) {
  const files = structuredClone(baseFiles()); let manifest = manifestFor(files);
  const state = { files, manifest }; mutate(state);
  manifest = rebind ? manifestFor(state.files) : state.manifest;
  cases.push({ id, accepted, transform, files: state.files.map(({ value, ...file }) => ({ ...file, base64: captureJson(value).toString('base64') })) });
  manifests[id] = manifest;
}
add('positive', true);
add('cross-realm', true, undefined, false, 'cross-realm');
add('null-prototype', true, undefined, false, 'null-prototype');
add('c18-original', false, state => state.files.push({ name: 'unreferenced-record-5.json', value: original.input.records[5], type: 'file', mode: 0o644 }));
add('unknown-extra', false, state => state.files.push({ name: 'unknown.json', value: {}, type: 'file', mode: 0o644 }));
add('missing', false, state => state.files.splice(1, 1));
add('truncated', false, state => { state.files[1].raw = 'e30='; });
add('file-hash', false, state => { state.files[1].value.channel = 'stdouX'; });
add('file-mode', false, state => { state.files[1].mode = 0o600; });
add('file-directory', false, state => { state.files[1].type = 'directory'; });
add('file-symlink', false, state => { state.files[1].type = 'symlink'; state.files[1].target = 'synthetic.json'; });
add('unreferenced-manifest-record', false, state => {
  state.files.push({ name: 'unreferenced-record-5.json', value: original.input.records[5], type: 'file', mode: 0o644 });
}, true);
add('referenced-duplicate', false, state => { state.files[0].value.fragments.push(structuredClone(state.files[0].value.fragments[0])); }, true);
add('receipt-reference-order', false, state => { state.files[0].value.fragments.reverse(); }, true);
add('receipt-reference-unknown', false, state => { state.files[0].value.fragments[0].name = 'unknown.json'; }, true);
add('receipt-count', false, state => { state.files[0].value.fragments.pop(); }, true);
for (const [id, value] of [['dot-alias', './synthetic-stdout-0.json'], ['dotdot-alias', '../synthetic-stdout-0.json'], ['absolute-alias', '/synthetic-stdout-0.json'], ['slash-alias', 'sub//synthetic-stdout-0.json'], ['unicode-alias', 'synthetic-stdout-é.json']]) {
  add(id, false, state => { state.manifest.files[0].name = value; });
}
for (const [id, mutate] of [
  ['record-extra', value => { value.extra = true; }], ['record-missing', value => { delete value.channel; }],
  ['record-channel', value => { value.channel = 1; }], ['record-offset-type', value => { value.offset = '0'; }],
  ['record-offset-negative', value => { value.offset = -1; }], ['record-offset-fraction', value => { value.offset = 0.5; }],
  ['record-total-type', value => { value.totalBytes = null; }], ['record-total-truncated', value => { value.totalBytes++; }],
  ['record-base64-type', value => { value.base64 = []; }], ['record-base64-canonical', value => { value.base64 += '\n'; }],
  ['record-length', value => { value.base64 = ''; }], ['record-hash', value => { value.sha256 = '0'.repeat(64); }],
  ['record-hash-type', value => { value.sha256 = 4; }]
]) add(id, false, state => mutate(state.files[1].value), true);
for (const [id, mutate] of [
  ['receipt-extra', value => { value.extra = false; }], ['receipt-bytes-type', value => { value.bytes = '126'; }],
  ['receipt-bytes', value => { value.bytes++; }], ['receipt-hash', value => { value.stdoutSha256 = '0'.repeat(64); }],
  ['receipt-outcome', value => { value.code = '0'; }], ['descriptor-extra', value => { value.fragments[0].extra = true; }],
  ['descriptor-size', value => { value.fragments[0].bytes++; }], ['descriptor-hash', value => { value.fragments[0].sha256 = '0'.repeat(64); }]
]) add(id, false, state => mutate(state.files[0].value), true);
for (const [id, mutate] of [
  ['manifest-extra', value => { value.extra = true; }], ['manifest-version-type', value => { value.version = '3'; }],
  ['manifest-file-type', value => { value.files[0].bytes = '1'; }], ['manifest-file-hash', value => { value.files[0].sha256 = false; }],
  ['manifest-kind', value => { value.files[0].kind = 'directory'; }], ['manifest-file-duplicate', value => { value.files.push(value.files[0]); }],
  ['manifest-file-order', value => { value.files.reverse(); }], ['manifest-mode', value => { value.files[0].mode = 512; }]
]) add(id, false, state => mutate(state.manifest));
for (const transform of ['getter', 'array-getter', 'hole', 'array-extra', 'symbol', 'nonenumerable', 'inherited', 'nan', 'boxed', 'wrong-order', 'self-asserted-hash']) add(`object-${transform}`, false, undefined, false, transform);
add('empty', true, state => {
  state.files.splice(1); const receipt = state.files[0].value;
  receipt.bytes = 0; receipt.fragments = []; receipt.stdoutSha256 = positive.input.stderrSha256;
}, true);
add('stderr', true, state => {
  const bytes = Buffer.from('harmless diagnostic\n'), name = 'synthetic-stderr-0.json';
  state.files[0].value.bytes += bytes.length; state.files[0].value.stderrSha256 = hash(bytes);
  state.files[0].value.fragments.push({ name, bytes: bytes.length, sha256: hash(bytes) });
  state.files.push({ name, value: { channel: 'stderr', offset: 0, totalBytes: bytes.length, base64: bytes.toString('base64'), sha256: hash(bytes) }, type: 'file', mode: 0o644 });
}, true);
for (const id of ['joined-namespace', 'other-receipt-invalid']) add(id, id === 'joined-namespace', state => {
  const value = { ...structuredClone(state.files[0].value), id: 'zeta', bytes: id === 'joined-namespace' ? 0 : '0', fragments: [], stdoutSha256: positive.input.stderrSha256 };
  state.files.push({ name: 'zeta.json', value, type: 'file', mode: 0o644 });
  state.manifest.files.push({ name: 'zeta.json', kind: 'receipt', mode: 0o644, bytes: captureJson(value).length, sha256: hash(captureJson(value)) });
  state.manifest.captures.push({ id: 'zeta', receipt: 'zeta.json', fragments: [] });
});
const sealBytes = fs.readFileSync(path.join(prior, 'EXECUTION-SEAL.json'));
assert.equal(hash(sealBytes), 'c05afd4ca977cc32e81d0ea4cff9311b44e6475a72c54ebf7bcdba7f47a2b116');
const seal = JSON.parse(sealBytes), captures = [];
const futureFiles = Object.entries(seal.files).filter(([name]) => name.startsWith('inventory-v1/')).map(([name, entry]) => {
  const basename = name.slice('inventory-v1/'.length);
  const kind = ['ACTUAL98.json', 'TOOLS.json', 'FINAL.json'].includes(basename) ? 'auxiliary' : /-(stdout|stderr)-[0-9]+\.json$/.test(basename) ? 'fragment' : 'receipt';
  if (kind === 'receipt') {
    const bytes = fs.readFileSync(path.join(prior, name)); assert.equal(hash(bytes), entry.sha256);
    const receipt = JSON.parse(bytes); captures.push({ id: receipt.id, receipt: basename, fragments: receipt.fragments.map(fragment => fragment.name) });
  }
  return { name: basename, kind, ...entry };
}).sort((left, right) => left.name < right.name ? -1 : 1);
manifests['future-inventory'] = { version: 3, files: futureFiles, captures: captures.sort((left, right) => left.id < right.id ? -1 : 1) };
const generated = new Map();
for (const [id, manifest] of Object.entries(manifests)) {
  const bytes = json(manifest), name = `manifests/${id}.json`;
  generated.set(name, bytes); bindings[id] = { manifest: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes), directory: id === 'future-inventory' ? '../path-transport-v2/inventory-v1' : `runs/author-01/work/${id}` };
}
generated.set('manifest-bindings.mjs', Buffer.from(`export const bindings = ${JSON.stringify(bindings, null, 2)};\n`));
generated.set('CONTROLS.json', json({ schema: 'c18-author-controls-v3', cases, restore: { profile: 'c18-original', remove: 'unreferenced-record-5.json', accepted: true }, expected: { helper: cases.length + 1, composed: cases.length + 1 }, originalC18: original, originalC01Expected: positive.expected, expectedRoot: canonical(positive.expected.entries).root.oid }));
const priorController = fs.readFileSync(path.join(prior, 'controller.mjs'));
const composition = composeFuture(priorController, seal.files['controller.mjs'].sha256);
generated.set('FUTURE-COMPOSITION.json', json({ priorCommit: 'd8cbb7d76459e14d20f57e19f7c01ce04fa08702', priorControllerSha256: hash(priorController), derivedControllerSha256: hash(composition), derivedControllerBytes: composition.length, storedDerivedArtifact: false, locationAfterFreshGo: 'future-v3/controller.mjs', admissionImport: '../controller-admission.mjs', admissionBefore: 'first work acquisition, Git child, raw tree parsing and object use', unchangedJobsSha256: hash(json(seal.jobs)), unchangedBounds: seal.bounds, unchangedCounts: seal.counts, authority: seal.authority, generatedProductHashes: null, derivation: seal.repair.futureOutputDerivation, execution: 'HOLD; no product or future controller dispatched' }));
let patch = '*** Begin Patch\n';
for (const [name, bytes] of generated) {
  assert.equal(fs.existsSync(path.join(own, name)), false, 'no overwrite/rebaseline');
  patch += `*** Add File: ${path.relative(repository, path.join(own, name))}\n` + bytes.toString('utf8').trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n';
}
patch += '*** End Patch\n';
const applied = spawnSync('apply_patch', [], { input: patch, cwd: repository, encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(applied.status, 0, applied.stderr); console.log(JSON.stringify({ generated: generated.size, cases: cases.length, expectedPerRoute: cases.length + 1, productExecutions: 0 }));
