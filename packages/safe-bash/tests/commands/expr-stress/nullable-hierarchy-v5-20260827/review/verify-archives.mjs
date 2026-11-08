import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inventory = async (directory, prefix = '') => {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isDirectory()) {
      entries.push({ path: relative, type: 'directory' });
      entries.push(...await inventory(path, relative));
    } else if (stat.isFile()) entries.push({ path: relative, type: 'file', sha256: sha256(await readFile(path)), bytes: stat.size });
    else entries.push({ path: relative, type: 'unexpected-entry' });
  }
  return entries;
};
const results = [];
for (const path of process.argv.slice(2)) {
  const authentication = JSON.parse(await readFile(path));
  for (const archive of authentication.archives) {
    const completeAfter = await inventory(archive.root);
    assert.deepEqual(completeAfter, archive.completeBefore, `archive changed: ${archive.label}`);
    results.push({ label: archive.label, commit: archive.commit, files: archive.inventory.length, unchanged: true, additionsDetected: true, completeAfter });
  }
  for (const guard of authentication.guards) assert.equal(sha256(await readFile(guard.path)), guard.sha256, `guard changed: ${guard.path}`);
  for (const control of authentication.controls) assert.equal(sha256(await readFile(control.path)), control.sha256, `control changed: ${control.path}`);
}
console.log(JSON.stringify({ schema: 1, date: new Date().toISOString(), scope: 'Complete entry inventory before/after for only enumerated OS-temp archives, including added entries and types. No whole-repository append-proof claim.', results }, null, 2));
