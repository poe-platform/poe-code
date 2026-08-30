import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { own, repo, work, candidate, hash, git, inventory } from './harness.mjs';
import { authenticateBoundary, members } from './boundary.mjs';

const evidence = path.join(own, 'evidence-v1');
const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'MANIFEST.json')));
const objectId = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = fs.readFileSync(path.join(evidence, name));
  assert.equal(hash(bytes), expected.sha256, name);
  assert.equal(bytes.length, expected.bytes, name);
}
const compressed = Buffer.from(fs.readFileSync(path.join(evidence, 'RAW.json.gz.base64'), 'utf8').trim(), 'base64');
assert.equal(hash(compressed), manifest.compressedSHA256);
const raw = gunzipSync(compressed);
assert.equal(raw.length, manifest.rawBytes);
assert.equal(hash(raw), manifest.rawSHA256);
const captures = new Map();
for (const entry of JSON.parse(raw).files) {
  assert(!captures.has(entry.path));
  const bytes = Buffer.from(entry.base64, 'base64');
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256, entry.path);
  assert(!/(^|\/)engine\//u.test(entry.path));
  captures.set(entry.path, bytes);
}
assert.equal(captures.size, manifest.rawCaptureFiles);
const capturedJson = name => JSON.parse(captures.get(name));
const binding = capturedJson('BINDING.json');
const packed = capturedJson('PACKAGE.json');
assert.equal(binding.candidate, candidate);
assert.equal(objectId('commit', fs.readFileSync(path.join(evidence, 'candidate.commit.data'))), candidate);
assert.equal(objectId('tree', fs.readFileSync(path.join(evidence, 'candidate.root-tree.data'))), binding.candidateTree);
const actualBlobs = git('ls-tree', '-r', '-z', candidate, '--', ...binding.selected).toString().split('\0').filter(Boolean).map(record => { const tab = record.indexOf('\t'); const [mode, kind, oid] = record.slice(0, tab).split(' '); return { path: record.slice(tab + 1), mode, kind, oid }; });
assert.deepEqual(actualBlobs, binding.selectedBlobs);

function tarFiles(tar) {
  const result = new Map();
  let offset = 0, extension = {};
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/su, '').trim();
    const size = Number.parseInt(field(124, 12), 8);
    assert(Number.isSafeInteger(size) && size >= 0);
    const type = field(156, 1);
    const prefix = field(345, 155);
    let name = (prefix ? prefix + '/' : '') + field(0, 100);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    assert.equal(body.length, size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'g') continue;
    if (type === 'x') {
      extension = {};
      let position = 0;
      while (position < body.length) {
        const space = body.indexOf(32, position);
        const length = Number(body.subarray(position, space).toString());
        assert(Number.isSafeInteger(length) && length > 0);
        const record = body.subarray(space + 1, position + length - 1).toString();
        const equals = record.indexOf('=');
        extension[record.slice(0, equals)] = record.slice(equals + 1);
        position += length;
      }
      continue;
    }
    name = extension.path ?? name;
    extension = {};
    assert(!name.startsWith('/') && !name.split('/').includes('..'));
    if (type === '5') continue;
    assert(type === '' || type === '0', `unsupported tar type ${type}`);
    assert(!result.has(name), `duplicate tar path ${name}`);
    result.set(name, { bytes: body.length, sha256: hash(body), oid: objectId('blob', body) });
  }
  return result;
}
const archive = gunzipSync(fs.readFileSync(path.join(evidence, 'candidate.tar.gz')));
assert.equal(hash(archive), manifest.candidateArchiveRawSHA256);
const sources = tarFiles(archive);
assert.deepEqual([...sources.keys()].sort(), actualBlobs.map(entry => entry.path).sort());
for (const entry of actualBlobs) assert.equal(sources.get(entry.path).oid, entry.oid, entry.path);
const packageBytes = fs.readFileSync(path.join(evidence, 'public-package.tgz'));
assert.equal(hash(packageBytes), packed.tarballSHA256);
const packages = tarFiles(gunzipSync(packageBytes));
const expectedInstalled = Object.entries(packed.installed).filter(([,entry]) => entry.kind === 'file');
assert.deepEqual([...packages.keys()].sort(), expectedInstalled.map(([name]) => 'package/' + name).sort());
for (const [name, entry] of expectedInstalled) assert.equal(packages.get('package/' + name).sha256, entry.sha256, name);
const boundaries = authenticateBoundary();
const phases = JSON.parse(fs.readFileSync(path.join(evidence, 'PROCESSES.json')));
for (const row of phases) assert(row.closeAwaited && row.signal === null && row.termination === null && row.error === null);
for (const [label, pass] of [['runtime83', 83], ['focused-final-02', 42], ['legacy-core-final-02', 505], ['legacy-state-final', 203], ['middleware-corrected-v3', 1], ['host-boundaries-v1', 3]]) {
  const row = phases.find(row => row.label === label);
  assert.equal(row.counts.pass, pass);
  assert.equal(row.counts.fail, 0);
}
assert.equal(phases.find(row => row.label === 'independent-public').counts.fail, 1);
assert.equal(phases.filter(row => row.label.startsWith('holdout-') && row.status === 0).length, 36);
for (const name of ['cursor-publication', 'task-checkpoint-v2']) {
  const output = captures.get(`logs/mutant-${name}/stdout`).toString();
  assert(/^  code: 'ERR_ASSERTION'$/mu.test(output));
  assert.equal(capturedJson(`mutant-${name}-binding.json`).originalSHA256, packed.installed['dist/shell/runtime.js'].sha256);
}
assert(captures.get('logs/mutant-task-checkpoint/stdout').toString().includes('single authenticated mutation anchor'));
const scratchSnapshot = path.join(evidence, 'SCRATCH.json');
if (fs.existsSync(work) && fs.existsSync(scratchSnapshot)) assert.deepEqual(inventory(work), JSON.parse(fs.readFileSync(scratchSnapshot)).entries);
const finalManifest = path.join(own, 'LAYERED-MANIFEST.json');
if (fs.existsSync(finalManifest)) {
  const expected = JSON.parse(fs.readFileSync(finalManifest));
  const found = members(own, name => name === '.work' || name.startsWith('.work/') || name === 'LAYERED-MANIFEST.json');
  assert.deepEqual(found, expected.entries, 'final review membership/hash drift, including additions');
}
if (process.argv[2] === '--committed') {
  const commit = process.argv[3];
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const review = path.relative(repo, own);
  const records = git('ls-tree', '-r', '-z', commit, '--', review).toString().split('\0').filter(Boolean);
  const found = members(own, name => name === '.work' || name.startsWith('.work/'));
  const files = Object.entries(found).filter(([,entry]) => entry.kind === 'file');
  assert.equal(records.length, files.length);
  for (const record of records) { const tab = record.indexOf('\t'); const oid = record.slice(0, tab).split(' ')[2]; const name = record.slice(tab + 1).slice(review.length + 1); assert.equal(found[name]?.oid, oid, name); }
}
console.log(JSON.stringify({ verified: true, candidate, sourceArchiveFiles: sources.size, installedPackageFiles: packages.size, rawCaptures: captures.size, closedSupervisors: phases.length, boundaries, exactReviewMembershipSealed: fs.existsSync(finalManifest), scratchPresent: fs.existsSync(work), scope: 'Artifact integrity and preserved execution evidence only; no product/native/private execution during verification.' }, null, 2));
