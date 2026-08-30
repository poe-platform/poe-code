import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { own, work, hash, json, save, write, inventory, privateShape } from './common.mjs';

assert(!fs.existsSync(path.join(own, 'FREEZE.json')));
const guard = await import(pathToFileURL(path.join(work, 'helpers/safejs-execution-v1/private-guard.mjs')));
const before = json(path.join(work, 'private-preparation-before.json'));
const after = guard.privateSnapshot();
assert.deepEqual(after, before);
assert.deepEqual(privateShape(), json(path.join(work, 'private-shape.json')));
const entries = inventory(work);
const raw = Buffer.from(JSON.stringify({ before, after, entries }) + '\n');
const compressed = gzipSync(raw, { level: 9 });
write(path.join(own, 'preparation-attempt-02-closure.json.gz.base64'), compressed.toString('base64') + '\n');
save(path.join(own, 'preparation-attempt-02-closure.json'), { privateUnchanged: true, eligibleAdditionsChecked: true, sourceOrEngineExecutions: 0, failure: 'Reviewer assumed npm existed beside the pinned Node24 binary; actual existing npm is Node22 installation', rawSHA256: hash(raw), compressedSHA256: hash(compressed), entries: entries.length, cleanup: 'Only exact enumerated owned scratch, authenticated immediately before removal' });
assert.deepEqual(inventory(work), entries);
for (const entry of [...entries].sort((left, right) => right.path.split('/').length - left.path.split('/').length)) {
  const filename = path.join(work, entry.path);
  if (entry.kind === 'directory') fs.rmdirSync(filename);
  else { assert.equal(hash(fs.readFileSync(filename)), entry.sha256); fs.unlinkSync(filename); }
}
fs.rmdirSync(work);
console.log('Preparation02 private guard unchanged; owned partial scratch authenticated and removed.');
