import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { own, read, sha, hashFile, save, inventory, privateState, gitReceipts } from './common.mjs';

const result = read(join(own, 'RESULT.json')), rawManifest = read(join(own, 'RAW-MANIFEST.json'));
const raw = join(own, 'raw-01'), work = join(own, 'node_modules/attempt-01');
assert.equal(hashFile(join(own, 'RAW.json.gz')), rawManifest.sha256);
const archive = JSON.parse(gunzipSync(fs.readFileSync(join(own, 'RAW.json.gz')), { maxOutputLength: 32 * 1024 ** 2 }));
for (const row of archive.rows) { assert.equal(sha(Buffer.from(row.base64, 'base64')), row.sha256); assert.equal(hashFile(join(raw, row.path)), row.sha256); }
assert.deepEqual(inventory(raw).filter(row => row.kind === 'file'), rawManifest.rawInventory);
const staged = read(join(raw, 'MATERIALIZED.json')), prefix = 'moved/deep/consumer';
assert.deepEqual(inventory(join(work, prefix)), staged);
const workRows = inventory(work);
assert.deepEqual(workRows.filter(row => !row.path.startsWith(prefix + '/')).map(row => ({ path: row.path, kind: row.kind })), [
  { path: 'installed', kind: 'directory' }, { path: 'moved', kind: 'directory' }, { path: 'moved/deep', kind: 'directory' }, { path: prefix, kind: 'directory' },
]);
const privateBefore = privateState(); assert.deepEqual(privateBefore, result.privateBefore);
fs.rmSync(raw, { recursive: true }); fs.rmSync(work, { recursive: true });
assert.equal(fs.existsSync(raw), false); assert.equal(fs.existsSync(work), false);
assert.deepEqual(privateState(), privateBefore);
const manifest = read(join(own, 'MANIFEST.json'));
for (const row of manifest.files) assert.equal(hashFile(join(own, row.path)), row.sha256);
save(join(own, 'CLOSURE.json'), {
  at: new Date().toISOString(), archiveSHA256: rawManifest.sha256, rawFilesVerifiedAndRemoved: archive.rows.length,
  stagedEntriesVerifiedAndRemoved: workRows.length, privateUnchangedAfterCopyRemoval: true,
  removedOnly: ['raw-01', 'node_modules/attempt-01'], originalRecipeFilesUnchanged: true,
  postExecutionGitChildren: gitReceipts, productExecutions: 0,
});
const files = fs.readdirSync(own).sort().filter(name => name !== 'node_modules' && name !== 'EVIDENCE-MANIFEST.json').map(path => {
  const target = join(own, path), stat = fs.lstatSync(target); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  return { path, bytes: stat.size, mode: stat.mode & 511, sha256: hashFile(target) };
});
save(join(own, 'EVIDENCE-MANIFEST.json'), { schema: 'timeout-curl-safejs-evidence-v1', sealedAt: new Date().toISOString(), recipeCommit: result.recipeCommit, recipeSHA256: result.recipeSHA256, files });
console.log(JSON.stringify({ evidenceSHA256: hashFile(join(own, 'EVIDENCE-MANIFEST.json')), files: files.length, rawFiles: archive.rows.length, removedStagedEntries: workRows.length, postExecutionGitChildren: gitReceipts.length, privateUnchanged: true, productExecutions: 0 }));
