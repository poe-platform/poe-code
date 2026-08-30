import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { own, work, root, hash, json, save, write, inventory, immutable, oldBoundary, verifyFreeze } from './common.mjs';

const freeze = verifyFreeze(process.argv[2]);
assert.equal(hash(JSON.stringify(immutable())), freeze.immutableSHA256);
assert.deepEqual(oldBoundary(), freeze.boundary);
const result = json(path.join(own, 'evidence-v1/RESULTS.json'));
assert.equal(result.knownLiveChildren.length, 0);
assert(result.children.length <= 1 && result.children.every(child => child.closed));
const evidence = path.join(own, 'evidence-v1');
const files = [];
function capture(filename, relative) {
  const bytes = fs.readFileSync(filename);
  files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') });
}
for (const entry of inventory(path.join(root, 'logs')).filter(entry => entry.kind === 'file')) capture(path.join(root, 'logs', entry.path), `logs/${entry.path}`);
for (const name of ['private-preparation-before.json', 'private-preparation-after.json', 'private-shape.json', 'install.stdout']) capture(path.join(work, name), name);
capture(path.join(root, 'CURRENT-IMPORTS.json'), 'CURRENT-IMPORTS.json');
const raw = Buffer.from(JSON.stringify({ files }) + '\n');
const compressed = gzipSync(raw, { level: 9 });
write(path.join(evidence, 'RAW.json.gz.base64'), compressed.toString('base64') + '\n');
save(path.join(evidence, 'RAW-MANIFEST.json'), { rawSHA256: hash(raw), compressedSHA256: hash(compressed), rawBytes: raw.length, files: files.length, privateSourceIncluded: false });
const scratch = inventory(work);
const scratchBytes = Buffer.from(JSON.stringify(scratch) + '\n');
const scratchCompressed = gzipSync(scratchBytes, { level: 9 });
write(path.join(evidence, 'SCRATCH.json.gz.base64'), scratchCompressed.toString('base64') + '\n');
save(path.join(evidence, 'SCRATCH-MANIFEST.json'), { root: '.scratch', entries: scratch.length, rawSHA256: hash(scratchBytes), compressedSHA256: hash(scratchCompressed), enumeratedOwnershipOnly: true, checkedImmediatelyBeforeRemoval: true });
assert.deepEqual(inventory(work), scratch);
for (const entry of [...scratch].sort((left, right) => right.path.split('/').length - left.path.split('/').length)) {
  const filename = path.join(work, entry.path);
  if (entry.kind === 'directory') fs.rmdirSync(filename);
  else { assert.equal(hash(fs.readFileSync(filename)), entry.sha256); fs.unlinkSync(filename); }
}
fs.rmdirSync(work);
assert(!fs.existsSync(work));
save(path.join(own, 'EVIDENCE-MANIFEST.json'), { freezeCommit: process.argv[2], entries: inventory(own), scratchRemoved: true, additionsChecked: true });
console.log(JSON.stringify({ sealed: true, captures: files.length, scratchRemoved: true }));
