import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { own, work, hash, json, git, relativeOwn, inventory, oldBoundary, verifyFreeze } from './common.mjs';

const manifest = json(path.join(own, 'EVIDENCE-MANIFEST.json'));
const freeze = verifyFreeze(manifest.freezeCommit);
assert.deepEqual(oldBoundary(), freeze.boundary);
assert(!fs.existsSync(work));
assert.deepEqual(inventory(own, name => name === 'EVIDENCE-MANIFEST.json'), manifest.entries);
const evidence = path.join(own, 'evidence-v1');
const rawManifest = json(path.join(evidence, 'RAW-MANIFEST.json'));
const compressed = Buffer.from(fs.readFileSync(path.join(evidence, 'RAW.json.gz.base64'), 'utf8').trim(), 'base64');
assert.equal(hash(compressed), rawManifest.compressedSHA256);
const raw = gunzipSync(compressed);
assert.equal(hash(raw), rawManifest.rawSHA256); assert.equal(raw.length, rawManifest.rawBytes);
const files = JSON.parse(raw).files;
assert.equal(files.length, rawManifest.files);
assert.equal(new Set(files.map(entry => entry.path)).size, files.length);
for (const entry of files) { const bytes = Buffer.from(entry.base64, 'base64'); assert.equal(hash(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes); assert(!entry.path.startsWith('engine/')); }
if (process.argv[2]) {
  const records = git('ls-tree', '-rz', process.argv[2], '--', relativeOwn).toString().split('\0').filter(Boolean);
  assert.equal(records.length, inventory(own).filter(entry => entry.kind === 'file').length);
  for (const record of records) { const filename = record.split('\t')[1]; assert.deepEqual(fs.readFileSync(path.join(own, filename.slice(relativeOwn.length + 1))), git('show', `${process.argv[2]}:${filename}`)); }
}
console.log(JSON.stringify({ verified: true, candidate: freeze.candidate, oldBoundary: freeze.boundary, ownEntries: manifest.entries.length, rawFiles: files.length, scratchAbsent: true, productExecutions: 0, privateReads: 0 }));
