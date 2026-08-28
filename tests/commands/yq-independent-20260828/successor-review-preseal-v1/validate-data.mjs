import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const load = (name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalHash = (value) => digest(JSON.stringify(value));
const inputs = load('INPUTS.json').entries;
const inputCache = new Map();
const pointer = (value, location) => location.split('/').slice(1).reduce((current, token) => current[token.replaceAll('~1', '/').replaceAll('~0', '~')], value);

for (const entry of inputs) {
  assert.match(entry.revision, /^[a-f0-9]{40}$/);
  assert(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
  const bytes = execFileSync('git', ['show', `${entry.revision}:${entry.path}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(digest(bytes), entry.sha256, entry.path);
  assert(lstatSync(resolve(repository, entry.path)).isFile(), entry.path);
  assert.equal(digest(readFileSync(resolve(repository, entry.path))), entry.sha256, entry.path);
  inputCache.set(entry.path, bytes);
}

const external = (suffix) => {
  const matches = inputs.filter((entry) => entry.path.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  return JSON.parse(inputCache.get(matches[0].path));
};
const original = external('/execution/DECLARED-JOBS-149.json');
const priorInventory = external('/runtime/recipe/inventory.json');
const ledger = load('LEDGER-194.json');
const cohort = load('JOBS.json');
const schedule = load('SCHEDULE.json');
const obligations = load('OBLIGATIONS.json');
const candidate = load('CANDIDATE-ADMISSION.json');
const jobs = cohort.outerJobs;
const jobMap = new Map(jobs.map((job) => [job.id, job]));
const originalJobs = new Map(original.jobs.map((job) => [job.id, job]));

assert.equal(ledger.rows.length, 194);
assert.equal(new Set(ledger.rows.map((row) => row.id)).size, 194);
assert.deepEqual(ledger.rows.map((row) => row.id), priorInventory.rows.map((row) => row.id));
const roleCounts = {};
for (const row of ledger.rows) {
  roleCounts[row.primaryRole] = (roleCounts[row.primaryRole] ?? 0) + 1;
  const previous = priorInventory.rows.find((entry) => entry.id === row.id);
  for (const field of ['primaryRole', 'frozen', 'currentOverlay', 'missingBindings']) assert.deepEqual(row[field], previous[field], row.id + ':' + field);
  const frozen = JSON.parse(inputCache.get(row.frozen.path));
  assert.equal(canonicalHash(pointer(frozen, row.frozen.pointer)), row.frozen.recordSha256);
  assert.equal(row.fullRecordPass, false);
  for (const jobId of row.successorJobs) assert(jobMap.get(jobId)?.recordIds.includes(row.id), jobId);
}
assert.deepEqual(roleCounts, ledger.roleCounts);
assert.deepEqual(Object.values(roleCounts).sort((left, right) => left - right), [4, 5, 6, 11, 23, 34, 111]);
assert.deepEqual(ledger.rows.filter((row) => row.currentOverlay).map((row) => row.id).sort(), [...ledger.overlays].sort());
assert.equal(ledger.overlays.length, 8);
assert.equal(ledger.rows.filter((row) => row.missingBindings.length).length, 80);
assert.equal(ledger.eligibility.completeProjection, 94);
assert.equal(ledger.eligibility.partial, 17);
assert.equal(canonicalHash(original.jobs), cohort.frozenRuntimeJobsSha256);
assert.equal(cohort.frozenRuntimeJobsSha256, 'c48185f7b165ab97d689f3a88e308b0cf1df39d93d7ab304dc8ad15ad9098f27');

for (const environment of ['source-built-direct', 'installed-moved-direct']) {
  const selected = jobs.filter((job) => job.environment === environment && job.frozenJobReference);
  assert.equal(selected.length, 149);
  assert.equal(new Set(selected.flatMap((job) => job.recordIds)).size, 132);
  for (const job of selected) {
    const frozen = pointer(original, job.frozenJobReference.pointer);
    assert.equal(canonicalHash(frozen), job.frozenJobReference.sha256);
    assert.equal(job.obligationGroup, frozen.id);
    assert.equal(job.recordIds[0], frozen.recordId);
    assert.equal(job.semanticFullRecordPass, false);
  }
}
assert.equal(jobs.length, 335);
assert.equal(jobMap.size, jobs.length);
assert.equal(schedule.maxOuterJobSlots, jobs.length);
assert(jobs.every((job) => job.executionAuthorized === false && job.state.startsWith('UNRUN')));
const scheduled = [];
let cutoff = 0;
for (const phase of schedule.phases) {
  assert.equal(phase.startOffsetMs, cutoff);
  cutoff += phase.capMs;
  assert.equal(phase.absoluteCutoffOffsetMs, cutoff);
  assert.equal(phase.jobIds.reduce((sum, jobId) => sum + jobMap.get(jobId).slotCapMs, 0), phase.capMs, phase.id);
  for (const jobId of phase.jobIds) {
    const job = jobMap.get(jobId);
    assert.equal(job.phase, phase.id);
    assert.equal(job.phaseAbsoluteCutoffOffsetMs, cutoff);
    scheduled.push(jobId);
  }
}
assert.equal(new Set(scheduled).size, jobs.length);
assert.equal(cutoff, 23625000);
assert.equal(cutoff, schedule.globalMonotonicCapMs);
assert.equal(schedule.retryAllowance, 0);
assert.equal(schedule.maxCompilerDescendants, 12);
assert.equal(jobs.reduce((sum, job) => sum + (job.maxCompilerDescendants ?? 0), 0), 12);

assert.equal(obligations.obligations.length, 371);
assert.equal(obligations.missingBindings.length, 135);
assert.equal(new Set(obligations.missingBindings.map((row) => row.recordId)).size, 80);
assert.equal(obligations.historicalUnfulfilled.length, 31);
for (const obligation of obligations.obligations) {
  const frozen = originalJobs.get(obligation.jobId);
  assert(frozen, obligation.jobId);
  const value = pointer(frozen, obligation.expectedPointer);
  assert.deepEqual(value, obligation.declaredValue);
  assert.equal(canonicalHash(value), obligation.declaredValueSha256);
  assert.equal(obligation.fullRecordPass, false);
}
const obligationIds = new Set(obligations.obligations.map((row) => row.id));
const missingIds = new Set(obligations.missingBindings.map((row) => row.id));
for (const row of ledger.rows) {
  for (const identity of row.obligationIds) assert(obligationIds.has(identity));
  for (const identity of row.missingObligationIds) assert(missingIds.has(identity));
}
assert.equal(candidate.execute, false);
for (const binding of [candidate.rootGO, ...Object.values(candidate.slots)]) {
  assert.equal(binding.state, 'UNBOUND_DENY');
  assert.equal(binding.value, null);
}
const types = load('TYPES.json').fixtures;
assert.equal(types.filter((fixture) => fixture.mode !== 'PUBLIC_ONLY').length, 6);
assert.equal(types.filter((fixture) => fixture.mode === 'PUBLIC_ONLY').length, 5);
const source = load('SOURCE-PROOFS.json');
assert.equal(source.designated.length, 23);
assert.equal(source.repairIds.length, 4);
assert(source.repairIds.every((identity) => source.designated.some((row) => row.id === identity)));
assert.equal(source.secondaryAnnotations.length, 2);
const loaded = load('LOADED-CONTROLS.json');
assert.equal(loaded.maximumChildren, 10);
assert.equal(loaded.mutants.length, 4);
assert(loaded.mutants.every((mutant) => originalJobs.has(mutant.witness) && mutant.preimageHash === null && mutant.postimageHash === null));
assert.equal(load('CONTROLS.json').controls.length, 18);
assert.equal(load('CONTROLS.json').cmd22.count, 31);

const actualTree = (root, prefix = '') => readdirSync(resolve(root, prefix)).flatMap((name) => {
  const relative = prefix ? `${prefix}/${name}` : name;
  const status = lstatSync(resolve(root, relative));
  assert(!status.isSymbolicLink(), relative);
  return status.isDirectory() ? [relative, ...actualTree(root, relative)] : [relative];
}).sort();
const peers = load('BINDINGS-PENDING.json');
for (const peer of [peers.cmd22, peers.artifactHandoff]) {
  assert.equal(digest(inputCache.get(peer.receipt)), peer.expectedHash);
  const seal = JSON.parse(inputCache.get(peer.receipt));
  const root = dirname(resolve(repository, peer.receipt));
  const entries = seal.entries ?? seal.files;
  const expected = entries.filter((entry) => entry.path !== '.').map((entry) => entry.path).concat(peer.receipt.split('/').at(-1)).sort();
  assert.deepEqual(actualTree(root), expected);
  for (const entry of entries) {
    const status = lstatSync(resolve(root, entry.path));
    assert.equal(status.mode & 0o777, entry.mode);
    if (entry.sha256) assert.equal(digest(readFileSync(resolve(root, entry.path))), entry.sha256);
  }
}
console.log(JSON.stringify({ classification: 'AUTHOR_STATIC_DATA_CHECK_ONLY', selectedGitReferences: inputs.length, originalIds: 194, overlays: 8, immutableJobsPerEnvironment: 149, uniqueRuntimeIds: 132, outerSlots: jobs.length, compilerDescendants: 12, globalCapMs: cutoff, obligationRows: 371, missingBindings: 135, gapRecords: 80, sourceRows: 23, repairRows: 4, directFixtures: 6, publicGapFixtures: 5, loadedSlots: 10, cmd22Definitions: 31, candidateAuthorization: 'DENY', productImports: 0, proposedExecutorRuns: 0, controlExecutions: 0, semanticPasses: 0 }));
