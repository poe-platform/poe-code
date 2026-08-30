import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] ?? '--check';
if (!['--check', '--plan'].includes(mode) || process.argv.length > 3) {
  process.stderr.write('PREPARATION ONLY: use --check or --plan; candidate execution is unavailable.\n');
  process.exitCode = 2;
} else {
  await prepare();
}

async function prepare() {
  const reviewDirectory = new URL('./', import.meta.url);
  const historicalDirectory = new URL('../', reviewDirectory);
  const plan = JSON.parse(await readFile(new URL('case-plan.json', reviewDirectory), 'utf8'));
  const freezeBytes = await readFile(new URL('FREEZE.md', reviewDirectory));
  assert.equal(sha256(freezeBytes), plan.freezeSha256);
  assert.equal(plan.productExecutions, 0);
  assert.equal(plan.candidateIdentity, null);
  assert.equal(plan.declarationIdentity, null);
  assert.equal(plan.authorActualClosedAuthenticated, false);
  assert.equal(plan.immutableReadyMarkerAuthenticated, false);
  assert.equal(plan.logicalCaseCount, 12);
  assert.equal(plan.cases.length, 12);
  assert.deepEqual(plan.cases.map(definition => definition.id),
    Array.from({ length: 12 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`));
  assert.equal(plan.cases.filter(definition => definition.family === 'explicit-api-optin-positive').length, 5);
  assert.equal(plan.cases.filter(definition => definition.family === 'independent-control').length, 7);
  assert.deepEqual(plan.cases.slice(0, 5).map(definition => definition.original), [
    'first-read-local', 'first-read-s3', 'first-read-webdav',
    'first-read-curl-body', 'first-read-curl-headers'
  ]);
  for (const definition of plan.cases) {
    assert.equal(definition.binding, null);
    assert.ok(definition.parameters.length > 0);
    assert.equal(new Set(definition.parameters).size, definition.parameters.length);
  }

  const manifestBytes = await readFile(new URL('evidence/inputs.json', historicalDirectory));
  const manifestGitBlob = createHash('sha1')
    .update(`blob ${manifestBytes.byteLength}\0`).update(manifestBytes).digest('hex');
  assert.equal(manifestGitBlob, plan.originalInputs.manifestGitBlob);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const preservedInputs = [];
  for (const input of manifest.manifest) {
    const archivedUrl = new URL(`preserved/${input.path}.data`, historicalDirectory);
    assert.ok(archivedUrl.href.startsWith(new URL('preserved/', historicalDirectory).href));
    assert.equal(fileURLToPath(archivedUrl), input.archive);
    const archivedBytes = await readFile(archivedUrl);
    const digest = sha256(archivedBytes);
    assert.equal(digest, input.sha256, input.path);
    assert.equal(archivedBytes.byteLength, input.bytes, input.path);
    preservedInputs.push({ path: input.path, bytes: archivedBytes.byteLength, sha256: digest });
  }
  for (const [originalPath, expectedHash] of [
    ['tests/shell/first-read-probe.ts', plan.originalInputs.probeSha256],
    ['tests/shell/remote-close.test.ts', plan.originalInputs.wrapperSha256],
    ['tests/stress/remote-cancellation/helpers.ts', plan.originalInputs.deadlineHelperSha256]
  ]) {
    assert.equal(preservedInputs.find(input => input.path === originalPath)?.sha256, expectedHash);
  }

  const observations = plan.cases.flatMap(definition => definition.parameters.map(parameter => ({
    caseId: definition.id,
    parameter,
    status: 'NOT_RUN_UNBOUND',
    bindingEvidence: null,
    publicResult: null,
    operationClosed: null,
    cleanupSettled: null,
    stageAbort: null,
    callerAbort: null,
    inputOwnerLive: null,
    positiveEffects: null,
    events: []
  })));
  const report = {
    classification: 'scaffold and archival-integrity checks only; not product proof',
    freezeCommit: plan.freezeCommit,
    freezeSha256: plan.freezeSha256,
    logicalAcceptanceCases: plan.cases.length,
    plannedParameterizedRecords: observations.length,
    productExecutions: 0,
    casePasses: 0,
    caseFailures: 0,
    casesUnrun: plan.cases.length,
    candidateIdentity: null,
    authorReadyMarkerRead: false,
    historicalManifestGitBlob: manifestGitBlob,
    historicalManifestSha256: sha256(manifestBytes),
    preservedInputCount: preservedInputs.length,
    preservedInputs,
    ...(mode === '--plan' ? { observations } : {})
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
