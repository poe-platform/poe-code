import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const repository = resolve(root, '../../..');
const read = name => JSON.parse(readFileSync(resolve(directory, name)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHash = '19526e0eb11478107b73026bdcc5d3b309f4cfb38c57a93c7cfea1672e75e923';
const originalBytes = readFileSync(resolve(root, 'MANIFEST.json'));
assert.equal(hash(originalBytes), originalHash);
const original = JSON.parse(originalBytes);
for (const entry of original.files) assert.equal(hash(readFileSync(resolve(root, entry.path))), entry.sha256, entry.path);
assert.deepEqual(readdirSync(root).sort(), [...original.files.map(entry => entry.path), 'MANIFEST.json', 'executor-preparation-v1', 'executor-overlay-v2'].sort());
const seal = read('SEAL.json');
for (const entry of seal.files) {
  const filename = resolve(directory, entry.path);
  const stat = lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o777, entry.mode);
  const bytes = readFileSync(filename);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
assert.deepEqual(readdirSync(directory).sort(), [...seal.files.map(entry => entry.path), 'SEAL.json', 'VALIDATION.json'].sort());
const previousDirectory = resolve(root, 'executor-preparation-v1');
for (const binding of seal.parentManifests) {
  const bytes = readFileSync(resolve(previousDirectory, binding.path));
  assert.equal(hash(bytes), binding.sha256);
  for (const entry of JSON.parse(bytes).files) assert.equal(hash(readFileSync(resolve(previousDirectory, entry.path))), entry.sha256, entry.path);
}
const previous = JSON.parse(readFileSync(resolve(previousDirectory, 'BINDINGS.json')));
assert.equal(realpathSync(process.execPath), previous.tools.find(tool => tool.role === 'node').path);
assert.equal(process.version, 'v22.22.2');
for (const tool of previous.tools) assert.equal(hash(readFileSync(tool.path)), tool.sha256, tool.path);
const git = previous.tools.find(tool => tool.role === 'git').path;
const bindings = read('BINDINGS.json');
for (const entry of bindings.references) {
  assert(!entry.path.split('/').includes('AGENTS.md'));
  const bytes = execFileSync(git, ['show', `${entry.commit}:${entry.path}`], { cwd: repository, timeout: 10000, maxBuffer: 3 * 1024 * 1024 });
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
assert.deepEqual(bindings.peerHistory.latest, { assertions: 402, passed: 400, failed: 2, reason: 'original exact-live-directory membership rejected the then-unsealed peer executor directory' });
assert.equal(bindings.peerHistory.rerun, false);
assert(Object.values(bindings.executionCounts).every(value => value === 0));
for (const name of ['ADAPTER-DELTA.json', 'CONTROL-DELTA.json']) {
  const delta = read(name);
  let source = readFileSync(resolve(directory, delta.base.path), 'utf8');
  assert.equal(hash(source), delta.base.sha256, `${name}:pristine`);
  for (const change of delta.changes) {
    if (change.replaceAllBefore) {
      assert.equal(source.split(change.replaceAllBefore).length - 1, change.expectedCount);
      source = source.replaceAll(change.replaceAllBefore, change.replaceAllAfter);
    } else {
      assert.equal(source.split(change.before).length - 1, 1, `${name}:edit cardinality`);
      source = source.replace(change.before, change.after);
    }
  }
  assert.equal(hash(source), delta.patched.sha256, `${name}:patched`);
  assert.equal(readFileSync(resolve(directory, delta.patched.path), 'utf8'), source);
}
const telemetry = read('TELEMETRY.json');
const row = JSON.parse(readFileSync(resolve(root, 'WORKFLOWS.json'))).rows.find(item => item.id === 'W03');
assert.equal(hash(JSON.stringify(row)), telemetry.originalWorkflowSha256);
assert.equal(hash(JSON.stringify(row.expected)), telemetry.sharedExpectationSha256);
assert.deepEqual(row.expected, telemetry.sharedExpectations);
assert.equal(telemetry.sharedStdinBase64, 'AP9BCg2AAA==');
assert.equal(telemetry.sharedScript, row.script);
assert.equal(telemetry.executions, 0);
assert.deepEqual(telemetry.engines['virtual-bash'].chunkLengths, [1, 2, 1, 3]);
for (const name of ['chunks', 'dispatch', 'iteratorCleanup', 'timers']) assert.equal(telemetry.engines['just-bash'][name], 'UNQUALIFIED');
const namespaces = read('NAMESPACES.json');
for (const [engine, profile] of Object.entries(namespaces.engines)) {
  assert.equal(profile.scaffolding.length, engine === 'just-bash' ? 191 : 4);
  assert.equal(profile.scaffoldingBytes, engine === 'just-bash' ? 6436 : 0);
  assert.equal(profile.maxWorkflowEntries, 64);
  assert.equal(profile.maxTotalEntries, profile.scaffolding.length + 64);
  assert.equal(profile.maxTotalReadBytes, profile.scaffoldingBytes + 65536);
  assert.equal(new Set(profile.scaffolding.map(entry => entry.path)).size, profile.scaffolding.length);
  assert(profile.scaffolding.every(entry => entry.path !== '/fixture' && !entry.path.startsWith('/fixture/')));
  assert.equal(profile.scaffolding.reduce((sum, entry) => sum + (entry.type === 'file' ? entry.size : 0), 0), profile.scaffoldingBytes);
  const reference = profile.provenance;
  const bytes = execFileSync(git, ['show', `${reference.revision}:${reference.path}`], { cwd: repository, timeout: 10000, maxBuffer: 3 * 1024 * 1024 });
  assert.equal(hash(bytes), reference.fileSha256);
  const raw = JSON.parse(bytes).report;
  const stable = entry => ({ path: entry.path, type: entry.type, mode: entry.mode & 0o7777, ...(entry.type === 'file' ? { size: entry.size, sha256: hash(Buffer.from(entry.base64, 'base64')) } : {}), ...(entry.type === 'symlink' ? { target: entry.target } : {}) });
  for (const phase of ['before', 'after']) assert.deepEqual(raw[phase].entries.filter(entry => entry.path !== '/fixture' && !entry.path.startsWith('/fixture/')).map(stable), profile.scaffolding);
}
const controls = read('CONTROL-DELTA.json');
assert.deepEqual(controls.familyIds, Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`));
assert.equal(controls.executed, 0);
assert.equal(bindings.setupAmendment.semanticInvocations, 99);
assert.equal(bindings.setupAmendment.targetSetupExecCeiling, 66);
assert.equal(bindings.setupAmendment.extraC11SetupExecs, 2);
const validation = read('VALIDATION.json');
assert.equal(validation.kind, 'data-only-overlay-validation-no-runtime');
assert.equal(validation.productExecutions, 0);
console.log(JSON.stringify({ status: 'V2_STATIC_BINDINGS_VALID_NOT_EXECUTION_ACCEPTANCE', originalFilesUnchanged: 11, pristineAndPatchedIdentities: 2, legacySelected: 23, legacyUnselected: 31, workflows: 10, controls: 12, workflowEntryCap: 64, scaffoldCounts: { target: 4, baseline: 191 }, preservedPeerResult: '400/402; two original failures', productExecutions: 0, controlExecutions: 0 }));
