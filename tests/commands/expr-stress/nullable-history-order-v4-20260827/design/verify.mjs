import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(directory, '../../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = readFileSync(path.join(directory, 'MANIFEST.data'));
const manifest = JSON.parse(manifestBytes);

function inventory(relative = '') {
  const entries = [];
  for (const name of readdirSync(path.join(directory, relative)).sort()) {
    const filename = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(path.join(directory, filename));
    assert.equal(stat.isSymbolicLink(), false, filename);
    if (stat.isDirectory()) {
      entries.push({ path: filename, kind: 'directory' });
      entries.push(...inventory(filename));
    } else {
      assert.ok(stat.isFile(), filename);
      const bytes = readFileSync(path.join(directory, filename));
      entries.push({ path: filename, kind: 'file', bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  return entries;
}

function authenticateOwned() {
  assert.deepEqual(readFileSync(path.join(directory, 'MANIFEST.data')), manifestBytes);
  const entries = inventory();
  assert.deepEqual(entries.filter(entry => entry.path !== 'MANIFEST.data'), manifest.entries);
  return entries;
}

function authenticateBindings() {
  for (const entry of manifest.bindings) {
    const archived = execFileSync('git', ['show', `${entry.commit}:${entry.path}`], { cwd: root, maxBuffer: 4194304 });
    assert.equal(hash(archived), entry.sha256, entry.path);
    assert.equal(archived.length, entry.bytes, entry.path);
    if (entry.currentFile) assert.equal(hash(readFileSync(path.join(root, entry.path))), entry.sha256, entry.path);
  }
}

const before = authenticateOwned();
authenticateBindings();
const captured = JSON.parse(readFileSync(path.join(directory, 'model-01.data')));
const replay = JSON.parse(execFileSync(process.execPath, [path.join(directory, 'run-model.mjs')], { cwd: root, timeout: 30000, maxBuffer: 1048576 }));
assert.deepEqual(replay, captured);
assert.deepEqual(authenticateOwned(), before);
authenticateBindings();
console.log(JSON.stringify({ verified: true, manifestSha256: hash(manifestBytes), ownedEntriesIncludingManifest: before.length, detectsNewFilesAndEmptyDirectories: true, modelReplay: captured.counts, predictionFailuresPreserved: captured.predictionFailures.length, nativeCalls: 0, historicalControlsRerun: 0, childrenSettled: true }));
