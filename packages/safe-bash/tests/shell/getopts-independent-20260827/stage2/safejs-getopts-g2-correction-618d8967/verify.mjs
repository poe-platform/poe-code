import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { own, work, hash, json, git, relativeOwn, inventory, oldBoundary, fixtureBinding, verifyFreeze } from './common.mjs';

const manifest = json(path.join(own, 'EVIDENCE-MANIFEST.json'));
const freeze = verifyFreeze(manifest.freezeCommit);
assert.deepEqual(oldBoundary(), freeze.boundary);
assert.deepEqual(fixtureBinding(), freeze.fixture);
assert(!fs.existsSync(work));
assert.deepEqual(inventory(own, name => name === 'EVIDENCE-MANIFEST.json'), manifest.entries);
for (const kind of ['RAW', 'SCRATCH']) {
  const directory = path.join(own, 'evidence-v1');
  const expected = json(path.join(directory, `${kind}-MANIFEST.json`));
  const compressed = Buffer.from(fs.readFileSync(path.join(directory, `${kind}.json.gz.base64`), 'utf8').trim(), 'base64');
  assert.equal(hash(compressed), expected.compressedSHA256);
  const raw = gunzipSync(compressed);
  assert.equal(hash(raw), expected.rawSHA256);
  const parsed = JSON.parse(raw);
  if (kind === 'SCRATCH') assert.equal(parsed.length, expected.entries);
  else {
    assert.equal(raw.length, expected.rawBytes);
    assert.equal(parsed.files.length, expected.files);
    assert.equal(new Set(parsed.files.map(entry => entry.path)).size, expected.files);
    for (const entry of parsed.files) { const bytes = Buffer.from(entry.base64, 'base64'); assert.equal(hash(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes); assert(!/(^|\/)engine\//u.test(entry.path)); }
  }
}
if (process.argv[2]) {
  const records = git('ls-tree', '-rz', process.argv[2], '--', relativeOwn).toString().split('\0').filter(Boolean);
  assert.equal(records.length, inventory(own).filter(entry => entry.kind === 'file').length);
  for (const record of records) { const filename = record.split('\t')[1]; assert.deepEqual(fs.readFileSync(path.join(own, filename.slice(relativeOwn.length + 1))), git('show', `${process.argv[2]}:${filename}`)); }
}
console.log(JSON.stringify({ verified: true, candidate: freeze.candidate, priorFiles: freeze.boundary.files, completePriorSeals: freeze.boundary.layers.length, ownEntries: manifest.entries.length, scratchAbsent: true, productExecutions: 0, privateReads: 0 }));
