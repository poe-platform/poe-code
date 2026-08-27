import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { own, work, root, hash, json, save, write, inventory, oldBoundary, verifyFreeze } from './common.mjs';
import { originalFreezeCommit, correctedRoot, originalImmutable, correctedImmutable, verifyCorrection } from './correction.mjs';

const correction = verifyCorrection(process.argv[2]);
const freeze = verifyFreeze(originalFreezeCommit);
assert.equal(hash(JSON.stringify(originalImmutable())), freeze.immutableSHA256);
assert.equal(hash(JSON.stringify(correctedImmutable())), correction.immutableSHA256);
assert.deepEqual(oldBoundary(), freeze.boundary);
for (const version of ['v1', 'v2']) {
  const result = json(path.join(own, `evidence-${version}/RESULTS.json`));
  assert.equal(result.knownLiveChildren.length, 0);
  assert(result.children.every(child => child.closed));
}
const evidence = path.join(own, 'evidence-final');
const files = [];
function capture(filename, relative) {
  const bytes = fs.readFileSync(filename);
  files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') });
}
for (const [version, directory] of [['v1', root], ['v2', correctedRoot]]) {
  for (const entry of inventory(path.join(directory, 'logs')).filter(entry => entry.kind === 'file')) capture(path.join(directory, 'logs', entry.path), `${version}/logs/${entry.path}`);
  capture(path.join(directory, 'CURRENT-IMPORTS.json'), `${version}/CURRENT-IMPORTS.json`);
}
for (const name of ['private-preparation-before.json', 'private-preparation-after.json', 'private-shape.json', 'install.stdout']) capture(path.join(work, name), `v1/${name}`);
for (const name of ['private-preparation-before.json', 'private-preparation-after.json']) capture(path.join(correctedRoot, name), `v2/${name}`);
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
const entries = inventory(own);
save(path.join(own, 'EVIDENCE-MANIFEST.json'), { originalFreezeCommit, correctionFreezeCommit: process.argv[2], entries, scratchRemoved: true, additionsChecked: true });
console.log(JSON.stringify({ sealed: true, captures: files.length, scratchRemoved: true, entries: entries.length }));
