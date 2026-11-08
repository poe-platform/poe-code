import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const prefix = 'benchmarks/reports/current-comparison-20260827/';
const caps = { perFileBytes: 8 * 1024 * 1024, totalBytes: 12 * 1024 * 1024, gitBlobBytes: 262144, gitTimeoutMs: 10000 };
const receipts = [];
const cache = new Map();
let totalBytes = 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function account(name, bytes) {
  totalBytes += bytes.length;
  assert.ok(totalBytes <= caps.totalBytes && bytes.length <= caps.perFileBytes);
  receipts.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
  return bytes;
}
function read(path) {
  assert.ok(path.startsWith(prefix) && !path.split('/').includes('..'));
  if (!cache.has(path)) {
    const filename = resolve(repository, path);
    assert.ok(statSync(filename).size <= caps.perFileBytes);
    cache.set(path, account(path, readFileSync(filename)));
  }
  return cache.get(path);
}
const json = relative => JSON.parse(read(prefix + relative));
function verify(record, path = record.path) {
  const bytes = read(path);
  if (record.bytes !== undefined) assert.equal(bytes.length, record.bytes, path);
  assert.equal(hash(bytes), record.sha256, path);
}
const runner = json('runner/REVISION2.json');
verify(runner.priorRecord);
const archive = JSON.parse(read(runner.priorRecord.path));
for (const record of archive.records) {
  verify(record, record.archivedPath);
  if (record.originalPath.startsWith(prefix + 'verification/')) verify(record, record.originalPath);
}
const initialChecks = json('verification/CHECKS.json');
assert.equal(hash(read(prefix + 'verification/static-check.mjs')), initialChecks.staticAudit.scriptSha256);
for (const record of runner.sourceFiles) verify(record);
for (const record of runner.archivedRevisionEvidence) verify(record, record.archivedPath);
const provenance = json('provenance/REQUEST2_REVISION.json');
for (const record of [...provenance.changes, ...provenance.preservedOriginalFiles]) verify(record);
assert.equal(provenance.aggregateExitCodeUniversallyVetoesReplay, false);
assert.equal(provenance.originalInventoryStatusesChanged, false);
const phase = json('provenance/PHASE_APPLICABILITY.json');
for (const record of phase.sourceEvidence) verify(record);
assert.equal(phase.phases.length, 6);
for (const row of phase.phases) assert.equal(row.executionAuthorized, false);
for (const identifier of ['old224-original-captured-golden-replay', 'old224-aligned-captured-golden-replay']) {
  const row = phase.phases.find(item => item.id === identifier);
  assert.equal(row.captureExecutablesMustStillExist, false);
  assert.equal(row.missingNativeExecutableAloneBlocks, false);
  assert.equal(row.requiresFreshCapture, false);
}
assert.equal(phase.phases.find(row => row.id === 'breadth-declared-intent').universalNativeOracleRequired, false);
assert.equal(phase.phases.find(row => row.id === 'fresh-native-capture-or-live-native-case').missingRequiredNativeExecutableBlocks, true);
const holdouts = phase.phases.find(row => row.id === 'new24-proposed-holdouts');
assert.equal(holdouts.expectations, null);
assert.equal(holdouts.independentCaptureRequiredBeforeMeasurement, true);
assert.equal(phase.closureProfiles.base3842.universalReplayVeto, false);
assert.equal(phase.closureProfiles.base3842.recordedStatus, 'BLOCKED_PREREQUISITE');
assert.equal(phase.closureProfiles.observerInclusive3844.automaticSubstitutionAllowed, false);
const amendment = json('cohorts/amendment-v2.json');
assert.equal(hash(read(prefix + 'verification/REVIEW.md')), amendment.reviewRequest.reviewedSha256);
const amendmentSeal = json('cohorts/AMENDMENT_V2_SEAL.json');
for (const record of amendmentSeal.files) verify(record, prefix + 'cohorts/' + record.path);
assert.deepEqual(amendment.preparationClarifications.knownIntendedAdditions, ['tree', 'file']);
assert.equal(amendment.preparationClarifications.sealedProposedRecipeCount, 24);
assert.equal(amendment.preparationClarifications.sealedProposedTargetNameCount, 12);
assert.equal(amendment.preparationClarifications.coversAll70, false);
assert.deepEqual(amendment.breadthOverrides.sharedOptionalControlIds, ['curl-positive']);
assert.equal(amendment.breadthOverrides.sharedControlIds.length, 4);
const artifactMap = json('cohorts/artifact-manifest.json').artifacts;
const historicalSources = {};
for (const name of ['engine.mjs', 'common.mjs', 'native.mjs']) {
  const revision = '8e09db96b51248137648cd5fd6093e4bc08f2b59';
  const path = 'benchmarks/expanded/' + name;
  const record = artifactMap.find(item => item.revision === revision && item.path === path);
  assert.ok(record && record.bytes <= caps.gitBlobBytes);
  const options = { cwd: repository, maxBuffer: caps.gitBlobBytes, timeout: caps.gitTimeoutMs };
  assert.equal(execFileSync('git', ['rev-parse', `${revision}:${path}`], options).toString().trim(), record.gitBlob);
  const bytes = account(`${revision}:${path}`, execFileSync('git', ['cat-file', 'blob', record.gitBlob], options));
  assert.equal(bytes.length, record.bytes);
  assert.equal(hash(bytes), record.sha256);
  historicalSources[name] = bytes.toString('utf8');
}
assert.match(historicalSources['engine.mjs'], /Buffer\.from\(result\.stderr, "utf8"\)/u);
assert.match(historicalSources['engine.mjs'], /stderr UTF8 public text/u);
assert.match(historicalSources['common.mjs'], /JSON\.stringify\(expected\[field\]\) === JSON\.stringify\(observed\[field\]\)/u);
const invalidByte = Buffer.from([255]);
const textRoundTrip = Buffer.from(invalidByte.toString('utf8'), 'utf8');
assert.notDeepEqual(textRoundTrip, invalidByte);
const currentProtocol = read(prefix + 'runner/PROTOCOL.md').toString('utf8');
const wordingHold = currentProtocol.includes('original four fields: exact stdout bytes,\nstderr bytes');
console.log(JSON.stringify({
  status: 'PASS_BOUNDED_REVISION_CHECKS', originalRequestsClosed: [1, 2, 3, 4],
  remainingWordingHold: wordingHold, caps, totalBytes, preservedInitialReviewAndChecks: true,
  captureQualification: { historicalBaselineStderr: 'UTF8_PUBLIC_TEXT_NOT_ORIGINAL_RAW_BYTES', historicalPredicate: 'Unchanged four-field JSON comparison of captured projected representations', syntheticInvalidByteHex: invalidByte.toString('hex'), syntheticTextRoundTripHex: textRoundTrip.toString('hex'), actualHistoricalCaseCorruptionClaimed: false },
  changedHashBindings: { runner: runner.sourceFiles, provenance: provenance.changes, cohortAmendment: amendmentSeal.files },
  gitHistoricalBlobReads: 3, underlyingPackageDependencyNativeRehash: false,
  engineImports: 0, engineCalls: 0, nativeWorkloads: 0, timingTrials: 0, receipts,
}, null, 2));
