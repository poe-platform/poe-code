import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { own, work, root, candidate, hash, json, write, save, inventory, oldBoundary, privateShape, verifyFreeze } from './common.mjs';
import { originalFreezeCommit, correctedRoot, correctionFiles, originalImmutable, correctedImmutable } from './correction.mjs';

assert(!fs.existsSync(correctedRoot));
assert(!fs.existsSync(path.join(own, 'FREEZE-v2.json')));
const freeze = verifyFreeze(originalFreezeCommit);
assert.equal(hash(JSON.stringify(originalImmutable())), freeze.immutableSHA256);
assert.deepEqual(oldBoundary(), freeze.boundary);
const beforeResults = json(path.join(own, 'evidence-v1/RESULTS.json'));
assert(beforeResults.children.every(child => child.closed));
const guard = await import(pathToFileURL(path.join(work, 'helpers/safejs-execution-v1/private-guard.mjs')));
const before = guard.privateSnapshot();
guard.verifyPrivatePrecondition(before);
assert.equal(hash(JSON.stringify(before)), freeze.privateSnapshotSHA256);
assert.equal(hash(JSON.stringify(privateShape())), freeze.privateShapeSHA256);
const originalChild = fs.readFileSync(path.join(own, 'child.mjs'), 'utf8');
const correctedChild = fs.readFileSync(path.join(own, 'child-v2.mjs'), 'utf8');
assert.equal(correctedChild, originalChild.replace('  const runtime = {', '  outer.use(product.standardCommands());\n  inner.use(product.standardCommands());\n  const runtime = {'));
fs.mkdirSync(correctedRoot);
try {
  const sourceEntries = inventory(root, name => ['logs', 'tmp', 'home', 'CURRENT-IMPORTS.json'].some(prefix => name === prefix || name.startsWith(prefix + '/')));
  for (const entry of sourceEntries) {
    const destination = path.join(correctedRoot, entry.path);
    if (entry.kind === 'directory') fs.mkdirSync(destination, { recursive: true, mode: entry.mode });
    else write(destination, entry.path === 'consumer/harness/child.mjs' ? correctedChild : fs.readFileSync(path.join(root, entry.path)), entry.mode);
  }
  for (const name of ['logs', 'home', 'tmp']) fs.mkdirSync(path.join(correctedRoot, name));
  const binding = json(path.join(root, 'CURRENT-IMPORTS.json'));
  assert.equal(binding.root, root);
  binding.root = correctedRoot;
  const entry = binding.files.find(entry => entry.path === 'consumer/harness/child.mjs');
  entry.sha256 = hash(correctedChild); entry.bytes = Buffer.byteLength(correctedChild);
  save(path.join(correctedRoot, 'CURRENT-IMPORTS.json'), binding);
  save(path.join(correctedRoot, 'private-preparation-before.json'), before);
  const after = guard.privateSnapshot();
  assert.deepEqual(after, before);
  assert.equal(hash(JSON.stringify(privateShape())), freeze.privateShapeSHA256);
  save(path.join(correctedRoot, 'private-preparation-after.json'), after);
  assert.equal(hash(JSON.stringify(originalImmutable())), freeze.immutableSHA256);
  const entries = correctedImmutable();
  save(path.join(own, 'FREEZE-v2.json'), { candidate, originalFreezeCommit, frozenAt: new Date().toISOString(), earlierActualGuestRuns: 1, earlierResult: beforeResults.counts, correctedGuestRunsBeforeFreeze: 0, inputs: Object.fromEntries(correctionFiles.map(name => [name, hash(fs.readFileSync(path.join(own, name)))])), immutableSHA256: hash(JSON.stringify(entries)), immutableEntries: entries.length, importBindingSHA256: hash(fs.readFileSync(path.join(correctedRoot, 'CURRENT-IMPORTS.json'))), unchangedInputs: ['both guest programs and assertions', 'candidate full public package', 'real engine264 and allowed import63 closure', 'original loader/private/capability guards', 'read-only builtin witness'], changedInputs: ['exact two standardCommands host setup calls', 'explicit new owned regular root and corresponding import binding'], maximumAdditionalGuestRuns: 2 });
  console.log(JSON.stringify({ correctionPrepared: true, correctedGuestRuns: 0, privateUnchanged: true, originalInputsUnchanged: true }));
} catch (error) {
  const after = guard.privateSnapshot();
  save(path.join(correctedRoot, 'private-preparation-failure.json'), after);
  assert.deepEqual(after, before);
  throw error;
}
