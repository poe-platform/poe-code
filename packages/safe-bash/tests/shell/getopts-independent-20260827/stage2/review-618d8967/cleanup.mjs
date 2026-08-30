import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { own, work, hash, save, inventory } from './harness.mjs';

await import('./verify-final.mjs');
assert.equal(fs.realpathSync(work), work);
const entries = inventory(work);
save(path.join(own, 'evidence-v1/SCRATCH.json'), { recordedAt: new Date().toISOString(), root: work, entries, classification: 'Exact task-owned scratch membership/hashes, including regular private engine copies by hash only; not vendored engine bytes. Source/package/raw evidence already preserved and verified.' });
let removedFiles = 0, removedDirectories = 0;
for (const [name, entry] of Object.entries(entries).filter(([,entry]) => entry.kind === 'file')) {
  const filename = path.join(work, name);
  assert.equal(fs.realpathSync(filename), filename);
  assert.equal(hash(fs.readFileSync(filename)), entry.sha256, name);
  fs.unlinkSync(filename);
  removedFiles++;
}
for (const [name] of Object.entries(entries).filter(([,entry]) => entry.kind === 'directory').sort(([left], [right]) => right.length - left.length)) {
  fs.rmdirSync(path.join(work, name));
  removedDirectories++;
}
fs.rmdirSync(work);
save(path.join(own, 'evidence-v1/CLEANUP.json'), { completedAt: new Date().toISOString(), removedFiles, removedDirectories: removedDirectories + 1, method: 'Verify exact task-owned snapshot and each regular file hash; unlink only enumerated files and nonrecursively rmdir enumerated directories. Unknown appended entries stop cleanup rather than being recursively deleted.', sourceAndEmittedEvidenceVerifiedBeforeDeletion: true, workAbsent: !fs.existsSync(work), noPrivateRepoOrForeignPathsTouched: true, noKnownLiveOwnedChildren: true });
console.log(JSON.stringify({ cleanup: 'complete', removedFiles, removedDirectories: removedDirectories + 1 }));
