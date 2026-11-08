import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const owned = process.argv[2];
const parent = 'tests/compatibility/bash-ere-core-transport-rebind-20260829';
assert.equal(owned, parent + '/producer-go-attempt-v1');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= 16777216, 'bounded regular DATA file');
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return bytes;
};
const save = (name, value) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  assert(bytes.length <= 16777216);
  fs.writeFileSync(owned + '/' + name, bytes, { flag: 'wx' });
  return { path: owned + '/' + name, bytes: bytes.length, sha256: hash(bytes) };
};
const sealBytes = read(parent + '/PRESEAL.json');
const sealSha256 = hash(sealBytes);
assert.equal(sealSha256, '02c98960983bfeffabf43ba11d5a594c498623c2befe3a06136c12d99d2dfd17');
const seal = JSON.parse(sealBytes);
const authenticated = seal.files.map(row => {
  assert(!path.isAbsolute(row.path) && !row.path.split('/').includes('..'));
  const bytes = read(parent + '/' + row.path);
  assert.equal(bytes.length, row.size);
  assert.equal(hash(bytes), row.sha256, row.path);
  return { path: parent + '/' + row.path, bytes: bytes.length, sha256: hash(bytes) };
});
const composition = JSON.parse(read(parent + '/COMPOSITION.json'));
assert.equal(composition.derivedTree, 'ff0c86a560da56b58437928c499ca7f5b9d25d70');
const source = read(parent + '/producer.mjs').toString();
const expectedGate = "  assert(/^[a-f0-9]{40}$/.test(grant.independentProducerReview) && /^[a-f0-9]{40}$/.test(grant.transportSourceReview));";
const lines = source.split('\n');
const matches = lines.map((line, index) => ({ line, number: index + 1 })).filter(row => row.line === expectedGate);
assert.equal(matches.length, 1);
const authorization = {
  schema: 'root-producer-go-record-with-explicit-review-waiver-v1',
  action: 'PRODUCE-CORE-TWO-SOURCE-OVERLAY',
  authorizedArtifactCommit: 'c5a45fec840135ed38ac5533b8a15f1b64dafb2c',
  presealSha256: sealSha256,
  composition: composition.derivedTree,
  outputRoot: path.resolve(parent, 'future-producer-v1'),
  transportSourceReview: 'f17d8dec11190ef40ecac6c175b208a2e29c7fbf',
  producerPreexecReview: 'EXPLICITLY_WAIVED_BY_ROOT_CURRENT_GO',
  independentActualProducerBindingAudit: 'REQUIRED_AFTERWARD',
  limits: { millisecondsIncludingPublication: 1200000, knownOsMaximum: 48, knownOsPeak: 3, captureBytes: 100663296, logicalWorkBytes: 536870912, perDataFileMaximumBytes: 16777216, cleanCompilerBuilds: 1, offlineIgnoreScriptsPackageProducers: 1 },
  archiveAndProducerReceiptMustBeCommittedBeforeFirstDecode: true,
  actualCoreAuthority: false,
};
assert.equal(Object.hasOwn(authorization, 'independentProducerReview'), false);
assert.equal(/^[a-f0-9]{40}$/.test(authorization.independentProducerReview), false);
const authorizationReceipt = save('ROOT-GO-RECORD.json', authorization);
const stop = {
  schema: 'sealed-producer-launch-contract-stop-v1',
  disposition: 'STOP_BEFORE_PRODUCER_COMMAND',
  at: new Date().toISOString(),
  started: '2026-08-29T15:38:28Z',
  publicationDeadline: '2026-08-29T15:58:28Z',
  presealSha256: sealSha256,
  authorizedArtifactCommit: authorization.authorizedArtifactCommit,
  derivedComposition: composition.derivedTree,
  authenticatedSealedFiles: authenticated,
  rootGoRecord: authorizationReceipt,
  missingField: 'grant.independentProducerReview',
  enforcingPath: parent + '/producer.mjs',
  enforcingLine: matches[0].number,
  enforcingSource: expectedGate,
  reason: 'The immutable authorized executable requires a 40-hex independent producer-review receipt, while current ROOT GO expressly waives a new preexecution review. No waiver-capable grant branch exists in this executable. Do not fabricate a review receipt or silently amend the preseal.',
  requiredResolution: 'Bind an explicitly authorized, versioned waiver-aware launch contract; this STOP is not a demand for a new preexecution review contrary to ROOT authorization.',
  fullyAuthenticatedBeforeStop: 'preseal and all its listed DATA/code files only',
  selectedGitInputsAndLiveToolOriginsReauthentication: 'NOT_REACHED; must complete before any future compiler command',
  producerInvocations: 0,
  compilerInvocations: 0,
  packageProducerInvocations: 0,
  decodeInvocations: 0,
  layoutMaterializations: 0,
  productInvocations: 0,
  Workers: 0,
  selectedOutputRootAlreadyExists: fs.existsSync(authorization.outputRoot),
  archiveCreated: false,
  producerArchiveCommit: null,
  finalBindingCommit: null,
  approvedCompilerOrPackAttemptConsumed: false,
  oldProducerAndResultsModified: false,
  sourceOverlayModified: false,
  noGrantReceiptInvented: true,
  producerCodeImportedOrExecuted: false,
  admissionHelperInvocations: 1,
};
const receipt = save('STOP.json', stop);
console.log(JSON.stringify({ phase: stop.disposition, missingField: stop.missingField, enforcingLine: stop.enforcingLine, authenticatedFiles: authenticated.length, receipt, selectedOutputRootAlreadyExists: stop.selectedOutputRootAlreadyExists, compiler: 0, pack: 0, decode: 0, at: stop.at }));
