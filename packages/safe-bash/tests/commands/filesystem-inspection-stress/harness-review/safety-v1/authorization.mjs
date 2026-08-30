import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { directory, digest, verifySeal } from './seal.mjs';

export const runtimeFiles = ['cases.mjs', 'seal.mjs', 'oracle.mjs', 'vfs.mjs', 'authorization.mjs', 'child.mjs', 'loader.mjs', 'run.mjs'];
export function harnessIdentity() {
  const files = runtimeFiles.map(path => ({ path, sha256: digest(readFileSync(join(directory, path))) }));
  return { files, sha256: digest(JSON.stringify(files)) };
}

export function checkPremise(entry, proof) {
  if (proof.status === 'invalidated') return;
  if (entry.id === 'T-empty-many') assert.equal(proof.emptyAlternativesNormalized, true);
  if (entry.id === 'T-DP-cumulative' || entry.id === 'F-JSON-cumulative') {
    assert(Number.isSafeInteger(proof.singleEntryMaximumWork) && proof.singleEntryMaximumWork > 0 && proof.singleEntryMaximumWork <= entry.limits.maxSteps);
    assert(Number.isSafeInteger(proof.invocationMinimumWork) && proof.invocationMinimumWork > entry.limits.maxSteps);
    assert.equal(proof.perOperandReset, false);
  }
  if (entry.id === 'T-DP-cumulative') {
    assert.equal(proof.patternEvaluationEliminated, false);
    assert.equal(proof.rejectingPhase, 'filter-before-sort');
  }
  if (entry.id === 'T-sort-many') {
    assert.equal(proof.comparedByteCostMetered, true);
    assert.equal(proof.bothSortPassesMetered, true);
    assert(proof.minimumComparisonByteWork > entry.limits.maxSteps);
  }
  if (entry.id === 'F-JSON-cumulative') {
    assert(Number.isSafeInteger(proof.twoEntryMinimumWork) && proof.twoEntryMinimumWork > entry.limits.maxSteps);
  }
  if (entry.id === 'F-header-many') assert.equal(proof.offsetsBoundedBySample, true);
  if (entry.id === 'F-metadata-many') {
    assert.equal(proof.textAdmittedBeforeExpansion, true);
    assert.equal(proof.cumulativeAccounting, true);
  }
}

export function authorize(path, expectedHash) {
  assert(isAbsolute(path ?? ''), 'Root authorization must be an explicit absolute file path');
  assert(/^[a-f0-9]{64}$/u.test(expectedHash ?? ''), 'Explicit authorization SHA256 required');
  const bytes = readFileSync(path);
  assert(bytes.length <= 8 * 1024 * 1024, 'Bounded authorization document');
  assert.equal(digest(bytes), expectedHash);
  const approval = JSON.parse(bytes);
  assert.equal(approval.approval, 'ROOT_FINAL_SOURCE_FREEZE_EXECUTION_AUTHORIZED');
  assert.equal(approval.harnessSha256, harnessIdentity().sha256, 'Runtime helper identity changed');
  assert.equal(approval.presealSha256, digest(readFileSync(join(directory, 'PRESEAL.json'))));
  const sealed = verifySeal();
  assert.deepEqual(approval.cases, sealed.cases.map(entry => entry.id));
  assert(/^[a-f0-9]{40}$/u.test(approval.sourceCommit));
  const snapshot = realpathSync(approval.snapshot);
  assert(snapshot.startsWith('/tmp/') || snapshot.startsWith('/private/tmp/'), 'Use a root-approved isolated frozen snapshot, never the live source tree');
  assert(Array.isArray(approval.files) && approval.files.length > 0 && approval.files.length <= 50000);
  const files = new Map();
  for (const entry of approval.files) {
    assert(typeof entry.path === 'string' && !isAbsolute(entry.path));
    const target = resolve(snapshot, entry.path);
    assert(target.startsWith(snapshot + sep));
    assert.equal(realpathSync(target), target, 'No redirected snapshot files');
    assert(!files.has(target));
    assert.equal(digest(readFileSync(target)), entry.sha256, target);
    files.set(target, entry.sha256);
  }
  for (const key of ['shell', 'contracts', 'tree', 'file']) {
    const target = resolve(snapshot, approval.entrypoints[key]);
    assert(files.has(target) && target.endsWith('.js'), `Compiled frozen ${key} entrypoint must be hashed`);
  }
  for (const entry of sealed.cases) {
    const proof = approval.proofs?.[entry.expected.proof];
    assert(proof && ['approved', 'invalidated'].includes(proof.status), `Missing static premise review: ${entry.id}`);
    assert.equal(proof.sourceCommit, approval.sourceCommit);
    assert(typeof proof.basis === 'string' && proof.basis.length > 0);
    assert(Array.isArray(proof.files) && proof.files.length > 0);
    for (const reference of proof.files) assert(files.has(resolve(snapshot, reference)), 'Proof must cite hashed frozen files');
    checkPremise(entry, proof);
  }
  return { approval, snapshot, files, sealed };
}
