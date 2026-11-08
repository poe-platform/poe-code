import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.dirname(own);
const root = path.dirname(parent);
const prior = path.join(root, 'path-transport-v2');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => fs.readFileSync(filename);
const json = filename => JSON.parse(read(filename));
const check = (filename, expected) => {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  assert.equal(stat.size, expected.bytes, `${filename}: bytes`);
  assert.equal(stat.mode & 0o777, expected.mode, `${filename}: mode`);
  assert.equal(sha256(read(filename)), expected.sha256, `${filename}: hash`);
};
const git = (args, input) => execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], {
  input, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' },
});
const futureBytes = read(path.join(parent, 'FUTURE-EXECUTION-SEAL.json'));
assert.equal(sha256(futureBytes), 'ec2f19e1825970b662d60a99f2128158ab7ab494b4161ce2a4b0f121f4dcc8e5');
const future = JSON.parse(futureBytes);
const priorBytes = read(path.join(prior, 'EXECUTION-SEAL.json'));
assert.equal(sha256(priorBytes), future.repair.previousExecutionSealSha256);
const previous = JSON.parse(priorBytes);
let priorTotal = 0;
for (const [name, expected] of Object.entries(previous.files)) {
  assert.ok(!name.split('/').includes('AGENTS.md'));
  check(path.resolve(prior, name), expected);
  priorTotal += expected.bytes;
}
assert.equal(Object.keys(previous.files).length, 275);
assert.equal(priorTotal, 26639996);
assert.equal(Object.keys(future.files).length, 280);
assert.deepEqual(future.jobs, previous.jobs);
assert.deepEqual(future.bounds, previous.bounds);
assert.deepEqual(future.counts, previous.counts);
assert.equal(future.jobs.length, 70);
const composePath = path.join(parent, 'compose-future.mjs');
assert.deepEqual(read(composePath), git(['show', '33e2b4c7fb14c2ab5ad23be50ac07bcc4bfed848:tests/commands/apply-patch-independent-20260828/capture-membership-v3/compose-future.mjs']));
for (const [name, expected] of Object.entries(future.files)) {
  assert.ok(!name.split('/').includes('AGENTS.md'));
  if (name === 'controller.mjs') continue;
  if (previous.files[name]) assert.deepEqual(expected, previous.files[name]);
  else check(path.resolve(own, name), expected);
}
const { composeFuture } = await import(composePath);
const controller = composeFuture(read(path.join(prior, 'controller.mjs')));
assert.equal(controller.length, future.files['controller.mjs'].bytes);
assert.equal(sha256(controller), future.files['controller.mjs'].sha256);
const metadataBytes = read(path.join(prior, 'METADATA.json'));
assert.equal(sha256(metadataBytes), future.metadataSha256);
const metadata = JSON.parse(metadataBytes);
assert.equal(metadata.candidate, '58be2d6c5706f3e90f01d48e695ecfd9daa52669');
assert.equal(metadata.evidence, '767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5');
assert.equal(process.execPath, metadata.tools[0].path);
assert.equal(process.version, metadata.nodeVersion);
let toolFiles = 0;
let toolDirectories = 0;
for (const group of metadata.tools) {
  for (const entry of group.entries ?? [group]) {
    const filename = path.resolve(entry.path);
    if (entry.type === 'directory') {
      const stat = fs.lstatSync(filename);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      assert.equal(stat.mode & 0o777, entry.mode);
      toolDirectories++;
    } else { check(filename, entry); toolFiles++; }
  }
  if (group.directory) {
    const names = [];
    const walk = directory => {
      for (const name of fs.readdirSync(directory)) {
        const filename = path.join(directory, name);
        names.push(path.relative(process.cwd(), filename));
        if (fs.lstatSync(filename).isDirectory()) walk(filename);
      }
    };
    walk(path.resolve(group.directory));
    assert.deepEqual(names.sort(), group.entries.map(entry => entry.path).sort());
  }
}
for (const entry of [...metadata.matrix, ...metadata.preparation]) check(path.resolve(entry.path), entry);
const { parseTree, treeHash, verifyProjection, batchObjects } = await import(path.join(prior, 'path-bytes.mjs'));
const { admitCapturedTree } = await import(path.join(parent, 'controller-admission.mjs'));
const captured = admitCapturedTree(path.join(prior, 'inventory-v1'), 'candidate', 'future-inventory');
assert.equal(captured.root, metadata.transport.candidateTree);
assert.equal(captured.entries.length, 50002);
assert.deepEqual(git(['ls-tree', '-rz', '--full-tree', metadata.candidate]), captured.bytes);
const baseEntries = parseTree(git(['ls-tree', '-rz', '--full-tree', metadata.baseManifest.base]));
assert.equal(treeHash(baseEntries), metadata.baseManifest.baseTree);
const inputs = verifyProjection([...metadata.baseManifest.inputs, ...metadata.sourceEntries], baseEntries, captured.entries, metadata);
assert.equal(inputs.length, 274);
const revisions = [...new Set([metadata.baseManifest.base, metadata.candidate, metadata.evidence, ...inputs.map(entry => entry.revision)])];
const requests = [...new Set([...revisions, ...inputs.map(entry => entry.blob)])];
const objects = batchObjects(git(['cat-file', '--batch'], requests.join('\n') + '\n'), requests);
for (const revision of revisions) assert.equal(objects.get(revision).kind, 'commit');
assert.equal(objects.get(metadata.candidate).payload.toString().split('\n')[0], `tree ${captured.root}`);
assert.equal(objects.get(metadata.baseManifest.base).payload.toString().split('\n')[0], `tree ${metadata.baseManifest.baseTree}`);
const overrideInventories = new Map();
for (const entry of inputs) {
  assert.ok(!entry.path.split('/').includes('AGENTS.md'));
  const object = objects.get(entry.blob);
  assert.equal(object.kind, 'blob');
  assert.equal(object.payload.length, entry.bytes);
  assert.equal(sha256(object.payload), entry.sha256);
  if (entry.revision !== metadata.baseManifest.base && entry.revision !== metadata.candidate) {
    if (!overrideInventories.has(entry.revision)) overrideInventories.set(entry.revision, parseTree(git(['ls-tree', '-rz', '--full-tree', entry.revision])));
    const match = overrideInventories.get(entry.revision).find(item => item.pathBytes.equals(Buffer.from(entry.path)));
    assert.ok(match);
    assert.equal(match.blob, entry.blob);
    assert.equal(match.mode, entry.mode);
  }
}
const overrides = new Map(metadata.baseManifest.inputs.filter(entry => entry.revision !== metadata.baseManifest.base).map(entry => [entry.path, entry]));
assert.equal(overrides.size, 5);
const composed = baseEntries.map(entry => overrides.get(entry.path) ?? entry);
assert.equal(treeHash(composed), metadata.baseManifest.composedTree);
const compositionTree = treeHash([...composed, ...metadata.sourceEntries]);
const created = [];
for (const [name, expected] of Object.entries(previous.files)) {
  const destination = path.resolve(own, name);
  assert.ok(destination.startsWith(parent + path.sep));
  assert.ok(!fs.existsSync(destination), `new destination required: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (name === 'controller.mjs') fs.writeFileSync(destination, controller, { flag: 'wx', mode: expected.mode });
  else fs.copyFileSync(path.resolve(prior, name), destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, expected.mode);
  created.push(path.relative(process.cwd(), destination));
}
const executionSeal = path.join(own, 'EXECUTION-SEAL.json');
fs.writeFileSync(executionSeal, futureBytes, { flag: 'wx', mode: 0o644 });
created.push(path.relative(process.cwd(), executionSeal));
for (const [name, expected] of Object.entries(future.files)) check(path.resolve(own, name), expected);
assert.deepEqual(fs.readdirSync(path.join(own, 'inventory-v1')).sort(), Object.keys(future.files).filter(name => name.startsWith('inventory-v1/')).map(name => name.slice('inventory-v1/'.length)).sort());
const result = {
  checkedAt: new Date().toISOString(), priorFiles: 275, priorBytes: priorTotal, futureFiles: 280,
  sealSha256: sha256(futureBytes), controllerSha256: sha256(controller), controllerBytes: controller.length,
  toolFiles, toolDirectories, inputFiles: inputs.length, candidateEntries: captured.entries.length,
  candidateTree: captured.root, derivedBaseTree: treeHash(composed), derivedCompositionTree: compositionTree,
  storedDerivedObjectRequired: false, sourceBodiesMaterialized: false, instructionBodiesMaterialized: false,
  runtimeJobs: 0, acceptedC18ProofRerun: false, created,
};
fs.writeFileSync(path.join(own, 'runs', 'materialization.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, created: created.length }, null, 2));
