import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { authorize as originalAuthorize } from '../safety-v1/authorization.mjs';
import { directory, digest, verifySeal } from './seal.mjs';

export const runtimeFiles = ['cases.mjs', 'seal.mjs', 'oracle.mjs', 'vfs.mjs', 'authorization.mjs', 'child.mjs', 'loader.mjs', 'run.mjs'];
export const baseHash = 'e4d048afb4784f802047de589212519465bb7589ccdb99e10ba677add39cee1c';
export function harnessIdentity() {
  const files = runtimeFiles.map(path => ({ path, sha256: digest(readFileSync(join(directory, path))) }));
  return { files, sha256: digest(JSON.stringify(files)) };
}
export function checkPremise(entry, proof) {
  assert.equal(proof.status, 'approved');
  assert.equal(proof.shellReturnsStatusOne, true);
  assert.equal(proof.phaseTraceReviewed, true);
  assert.equal(proof.perOperandReset, false);
  if (entry.id === 'T-DP-cumulative') {
    assert.equal(entry.limits.maxSteps, 16384);
    assert.equal(proof.singleEntryMaximumWork, 4573);
    assert.equal(proof.fourFiltersDemandedWork, 18123);
    assert.equal(proof.acceptedWorkBeforeFailure, 16317);
    assert.equal(proof.attemptedWorkAtFailure, 16575);
    assert.equal(proof.failedTokenOrdinal, 11);
    assert.equal(proof.patternEvaluationEliminated, false);
    assert.equal(proof.rejectingPhase, 'fourth-filter-before-sort');
  } else {
    assert.equal(entry.id, 'T-sort-many');
    assert.equal(entry.limits.maxSteps, 4096);
    assert.equal(proof.comparedByteCostMetered, true);
    assert.equal(proof.bothSortPassesMetered, true);
    assert.equal(proof.comparisonReservation, 1025);
    assert.equal(proof.acceptedWorkBeforeFailure, 3141);
    assert.equal(proof.attemptedWorkAtFailure, 4166);
    assert.equal(proof.rejectingPhase, 'fourth-name-comparison-before-child-stat');
  }
}
export function authorize(path, expectedHash) {
  assert(isAbsolute(path ?? ''));
  assert(/^[a-f0-9]{64}$/u.test(expectedHash ?? ''));
  const bytes = readFileSync(path);
  assert(bytes.length <= 8 * 1024 * 1024);
  assert.equal(digest(bytes), expectedHash);
  const correction = JSON.parse(bytes);
  assert.equal(correction.approval, 'ROOT_TWO_ROW_CORRECTION_EXECUTION_AUTHORIZED');
  assert.equal(correction.harnessSha256, harnessIdentity().sha256);
  assert.equal(correction.sealSha256, digest(readFileSync(join(directory, 'SEAL.json'))));
  assert.equal(correction.baseAuthorization.sha256, baseHash);
  const original = originalAuthorize(correction.baseAuthorization.path, baseHash);
  assert.equal(original.approval.proofs.dpNonEliminated.status, 'invalidated');
  assert.equal(original.approval.proofs.sortByteCost.status, 'invalidated');
  assert.equal(correction.sourceCommit, original.approval.sourceCommit);
  const sealed = verifySeal();
  assert.deepEqual(correction.cases, sealed.cases.map(entry => entry.id));
  assert.deepEqual(correction.caseHashes, sealed.cases.map(entry => ({ id: entry.id, sha256: digest(JSON.stringify(entry)) })));
  assert.equal(correction.maximumNewProductInvocations, 2);
  assert.equal(correction.maximumTotalProductInvocations, 6);
  const previousBytes = readFileSync(correction.previousRun.path);
  assert.equal(digest(previousBytes), correction.previousRun.sha256);
  assert.equal(correction.previousRun.sha256, sealed.manifest.originalRunSummarySha256);
  const previous = JSON.parse(previousBytes);
  assert.equal(previous.sourceCommit, correction.sourceCommit);
  assert.equal(previous.authorizationSha256, baseHash);
  assert.equal(previous.childStarts, 4);
  assert.equal(previous.observedCommandStarts, 4);
  assert.equal(previous.incompleteChildrenHaveUnknownFinalProductEffects, false);
  assert.deepEqual(previous.rows.map(row => row.status), ['pass', 'HOLD', 'HOLD', 'pass', 'pass', 'pass']);
  assert.deepEqual(correction.reuseWithoutRerun, previous.rows.filter(row => row.status === 'pass').map(row => row.id));
  assert.equal(correction.executionClaim, '/tmp/safe-bash-inspection-derived-two-436bda3-execution-claim.json');
  for (const entry of sealed.cases) {
    const proof = correction.proofs[entry.expected.proof];
    checkPremise(entry, proof);
    assert.equal(proof.sourceCommit, correction.sourceCommit);
    assert(typeof proof.basis === 'string' && proof.basis.length > 0);
    assert(Array.isArray(proof.files) && proof.files.length > 0);
    for (const reference of proof.files) assert(original.files.has(resolve(original.snapshot, reference)));
    assert(typeof proof.independentReviewPath === 'string' && isAbsolute(proof.independentReviewPath));
    assert(/^[a-f0-9]{64}$/u.test(proof.independentReviewSha256 ?? ''));
    assert.equal(digest(readFileSync(proof.independentReviewPath)), proof.independentReviewSha256);
  }
  return { ...original, sealed, approval: { ...original.approval, ...correction }, previous };
}
export function claimExecution(authorized, authHash) {
  writeFileSync(authorized.approval.executionClaim, `${JSON.stringify({ authorizationSha256: authHash, previous: 4, maximumNew: 2, cases: authorized.approval.cases })}\n`, { flag: 'wx' });
}
