import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileRecord, json, owned, save, sha256, snapshot } from './auth.mjs';

const outcome = json(join(owned, 'execution/OUTCOME.json'));
assert(outcome.integrity && outcome.knownOwnedReap, 'Unsafe boundary: collect only after intact inputs and known-owned reap');
const root = json(join(owned, 'ROOT-EXECUTION.json'));
const compoundRoots = readdirSync(root.outputParent).map((name) => join(root.outputParent, name));
assert.equal(compoundRoots.length, 1);
const compoundRoot = compoundRoots[0];
const compound = json(join(compoundRoot, 'COMPOUND-RESULT.json'));
assert.deepEqual(compound, outcome.compound);
const destination = join(owned, 'raw-compound');
mkdirSync(destination, { mode: 0o755 });
const copies = [];
function copyTree(source, target) {
  const before = snapshot(source);
  for (const entry of before) {
    const path = entry.path === '.' ? target : join(target, entry.path);
    if (entry.kind === 'directory') mkdirSync(path, { mode: entry.mode });
    else copyFileSync(join(source, entry.path), path);
    chmodSync(path, entry.mode);
  }
  assert.deepEqual(snapshot(source), before);
  assert.deepEqual(snapshot(target), before);
  copies.push({ source, target, digest: sha256(JSON.stringify(before)), files: before.filter((entry) => entry.kind === 'file').length, completeMembershipAndModes: true });
}
for (const name of ['captures', 'metadata', 'scoped-types']) {
  const path = join(compoundRoot, name);
  if (existsSync(path)) copyTree(path, join(destination, name));
}
copyFileSync(join(compoundRoot, 'COMPOUND-RESULT.json'), join(destination, 'COMPOUND-RESULT.json'));
chmodSync(join(destination, 'COMPOUND-RESULT.json'), lstatSync(join(compoundRoot, 'COMPOUND-RESULT.json')).mode & 0o7777);
const inventory = json(join(owned, 'preparation/INVENTORY-194.json'));
const rows = [];
const moves = [];
for (const result of compound.results) {
  const folder = join(result.evidence, result.jobId);
  const local = join(destination, relative(compoundRoot, folder));
  const verdict = existsSync(join(folder, 'verdict.json')) ? json(join(folder, 'verdict.json')) : null;
  const receipt = existsSync(join(folder, 'receipt.json')) ? json(join(folder, 'receipt.json')) : null;
  const obligations = existsSync(join(folder, 'obligations.json')) ? json(join(folder, 'obligations.json')) : null;
  const id = result.jobId.split('--')[0];
  const record = inventory.rows.find((row) => row.id === id);
  const worker = verdict?.metadata ?? null;
  const childSuccess = worker?.exitCode === 0 && worker.signal === null && !worker.timedOut && !worker.overflow && !worker.spawnError;
  const runtime = ['original-runtime', 'moved-runtime'].includes(result.mode);
  const classification = !childSuccess ? 'WORKER_OR_ADMISSION_FAILURE'
    : obligations?.status === 'INCOMPLETE' ? 'UNFULFILLED_OBLIGATIONS'
    : verdict?.outcome === 'PASS' ? 'SCOPED_OBSERVATION_MATCH'
    : result.jobId === 'CMD-22--whole' ? 'FRAMEWORK_PATH_ASSERTION_MISMATCH'
    : 'ASSERTION_MISMATCH_REQUIRES_REVIEW';
  rows.push({ mode: result.mode, jobId: result.jobId, originalId: record?.id ?? null, role: record?.primaryRole ?? result.mode,
    runtime, classification, aggregate: result.aggregate, childSuccess, integrity: verdict?.integrity ?? false, reapProof: verdict?.reapProof ?? false,
    evidence: relative(owned, local), frozen: record?.frozen ?? null, currentOverlay: record?.currentOverlay ?? null,
    unfulfilled: obligations?.unfulfilled ?? [], failures: verdict?.failures ?? [],
    commandStatus: receipt?.capture?.status ?? null, commandRejected: receipt?.capture?.rejected ?? null,
    fullRecordPass: false, semanticAcceptance: false });
  if (receipt?.movement) {
    const movement = receipt.movement;
    const entries = snapshot(movement.root);
    const stat = lstatSync(movement.root);
    assert.equal(stat.ino, movement.directoryIdentity.ino);
    assert.equal(stat.dev, movement.directoryIdentity.dev);
    assert(!existsSync(movement.staging));
    const expected = snapshot(root.packageRoot);
    assert.deepEqual(entries, expected);
    moves.push({ jobId: result.jobId, mode: result.mode, root: movement.root, staging: movement.staging, directoryIdentity: movement.directoryIdentity,
      files: entries.filter((entry) => entry.kind === 'file').length, completeMembershipModesHashes: true, treeDigest: sha256(JSON.stringify(entries)) });
  }
}
const byEnvironment = {};
for (const mode of ['original-runtime', 'moved-runtime']) {
  const cohort = rows.filter((row) => row.mode === mode);
  const roles = {};
  for (const row of cohort) {
    roles[row.role] ??= { jobs: 0, scopedMatches: 0, failures: 0 };
    roles[row.role].jobs++;
    roles[row.role][row.aggregate === 'PASS' ? 'scopedMatches' : 'failures']++;
  }
  byEnvironment[mode] = { jobs: cohort.length, uniqueOriginalIds: new Set(cohort.map((row) => row.originalId)).size,
    scopedMatches: cohort.filter((row) => row.aggregate === 'PASS').length, failedJobs: cohort.filter((row) => row.aggregate !== 'PASS').length,
    unfulfilledJobs: cohort.filter((row) => row.classification === 'UNFULFILLED_OBLIGATIONS').length,
    semanticRoleUniqueIdsObserved: new Set(cohort.filter((row) => row.role === 'command-semantic-runtime').map((row) => row.originalId)).size,
    semanticRoleUniqueIdsAllAdmittedFragmentsMatched: [...new Set(cohort.filter((row) => row.role === 'command-semantic-runtime').map((row) => row.originalId))].filter((id) => cohort.filter((row) => row.originalId === id).every((row) => row.aggregate === 'PASS')).length,
    roles, noFullRecordPassClaim: true };
}
const coverage = inventory.rows.map((record) => {
  const matches = rows.filter((row) => row.originalId === record.id && row.runtime);
  return { ...record, result: 'REVIEWED_WITH_EXPLICIT_GAPS_NOT_ACCEPTED',
    actualOriginalJobs: matches.filter((row) => row.mode === 'original-runtime').length,
    actualMovedJobs: matches.filter((row) => row.mode === 'moved-runtime').length,
    actualScopedMatches: matches.filter((row) => row.aggregate === 'PASS').length,
    actualFailures: matches.filter((row) => row.aggregate !== 'PASS').length,
    actualSourceStatic: record.primaryRole === 'source-static-counterproof',
    sourceCriticalAnnotationOnly: ['ENC-07', 'WRK-22'].includes(record.id),
    fullRecordPass: false, missingBindingsUnchanged: true };
});
save(join(owned, 'execution/CAPTURE-PRESERVATION.json'), { copies, compoundSource: fileRecord(join(compoundRoot, 'COMPOUND-RESULT.json')), compoundCopy: fileRecord(join(destination, 'COMPOUND-RESULT.json')), rawBytesUnchanged: true, packageCopiesRetainedExternallyNotDeleted: true });
save(join(owned, 'execution/MATERIALIZATION-AUDIT.json'), { moves, noReplayOfPriorMoves: true, completeAddedEntryGuards: true });
save(join(owned, 'execution/OBSERVATIONS.json'), rows);
save(join(owned, 'execution/COVERAGE-194.json'), coverage);
save(join(owned, 'execution/COUNTS.json'), { originalIds: 194, overlays: inventory.overlays, roleCounts: inventory.roleCounts,
  aggregate: compound.aggregate, stopped: compound.stopped, admittedChildren: rows.length, runtimeJobs: rows.filter((row) => row.runtime).length,
  runtimeUniqueOriginalIds: new Set(rows.filter((row) => row.runtime).map((row) => row.originalId)).size,
  byEnvironment, workerFailures: rows.filter((row) => !row.childSuccess).length,
  loadedCodeChildren: rows.filter((row) => row.mode === 'loaded-code').length, typeWorkerChildren: rows.filter((row) => row.mode === 'types').length,
  sourceStaticDesignatedIds: 23, sourceStaticCounterproofIds: ['WRK-06', 'WRK-07', 'WRK-13', 'WRK-17'],
  semanticEligibilityNotResults: { completeProjection: 94, partial: 17 }, missingBindings: compound.missingBindings,
  fullRecordPasses: 0, publicIntegration: false, noOverallAcceptance: true, noAddedRuntimeProbes: true, genuineFailedCaseRetries: 0 });
console.log(JSON.stringify({ aggregate: compound.aggregate, stopped: compound.stopped, children: rows.length, byEnvironment, preservedCaptureTrees: copies.length }));
