import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(base, '../../../../..');
const audit = JSON.parse(readFileSync(resolve(base, 'evidence/audit.json')));
assert(audit.pass && audit.exactClosedChildren === 53 && audit.outerKills === 0);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [path, hash] of Object.entries(audit.sourceHashes)) assert.equal(sha(readFileSync(resolve(root, path))), hash, path);
const files = [];
const directories = [];
function visit(directory) {
  assert(!lstatSync(directory).isSymbolicLink());
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), path);
    if (entry.isDirectory()) visit(path);
    else { assert(entry.isFile(), path); files.push({ path, sha256: sha(readFileSync(path)) }); }
  }
  directories.push(directory);
}
for (const name of ['.scratch', '.scratch-initial']) visit(resolve(base, name));
const inventorySha256 = sha(Buffer.from(JSON.stringify(files.map(entry => ({ path: relative(base, entry.path), sha256: entry.sha256 })))));
for (const entry of files) { assert.equal(sha(readFileSync(entry.path)), entry.sha256); unlinkSync(entry.path); }
for (const directory of directories) rmdirSync(directory);
writeFileSync(resolve(base, 'evidence/cleanup.json'), JSON.stringify({ at: new Date().toISOString(), ownedRoots: ['.scratch', '.scratch-initial'], removedFiles: files.length, removedDirectories: directories.length, inventorySha256, remainingRoots: ['.scratch', '.scratch-initial'].filter(name => existsSync(resolve(base, name))), productSourcesUnchanged: true, processesKilled: 0, exactClosedChildren: audit.exactClosedChildren, inspectedImmediatelyBeforeRemoval: true }, null, 2) + '\n', { flag: 'wx' });
