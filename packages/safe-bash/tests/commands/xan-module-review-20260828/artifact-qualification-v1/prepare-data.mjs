import { readFile, writeFile, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const owned = dirname(fileURLToPath(import.meta.url));
const review = dirname(owned);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const check = (value, message) => { if (!value) throw new Error(message); };
const json = bytes => JSON.parse(bytes.toString('utf8'));
const specifications = [
  ['denial-specificity-v1/SEAL.json', '7a1a54ff1250f55b556dc76727679579651e251cb8cb3634bdd358739cbf4682', 'b9df433534cd3f0de9163453226a4d83e266a449'],
  ['denial-specificity-v1/CASE-EVIDENCE.json', '3d6f412d8d7f46a78d57833de8c02b04f6a42ab4e9974a6d4a474763546845f9', 'b9df433534cd3f0de9163453226a4d83e266a449'],
  ['denial-specificity-v1/REPORT.md', 'cc5cdfc5f88633454ac840f19f906925c67c2492495f80de4a5ce6209d3e6a1a', 'b9df433534cd3f0de9163453226a4d83e266a449'],
  ['denial-specificity-v1/ORIGINAL-REQUEST.txt', '253747e33b24988a80cb00e090d5e83b953462ef09d81667b45db1b4cc5eba5d', 'b9df433534cd3f0de9163453226a4d83e266a449'],
  ['denial-specificity-v1/LOG-EXCERPTS.json', '639e379c28b0879f67716065ba17de55632d2a37e546be027e47028f3e4272e7', 'b9df433534cd3f0de9163453226a4d83e266a449'],
  ['diagnosis-v1/CASES.json', 'a06d2279cebad1cd5806909918197cb73e2f94a3f5f10e7a6447b31791d0137b', '04fae50ae2ac224eba32cdb6ed84c43d2ee671ea'],
  ['diagnosis-v1/F11.md', 'ee163e085e383074fc0e1bdcf9ea34ca13327e6ff26d67ac95a6b9e180777d4b', '04fae50ae2ac224eba32cdb6ed84c43d2ee671ea'],
  ['diagnosis-v1/CONTINUATION.md', '8a4551770beb25127af38320e13771b413db908345b226b22a3b7698f53a5138', '04fae50ae2ac224eba32cdb6ed84c43d2ee671ea'],
  ['actual-review-v2/OBLIGATION-REVIEW.json', '93b2e6c489998bff8dcd56b5c9d97a9e836c7adb6e6b09787dbb3f02bf2e0c61', 'dad2b08ce6bba02d3c404e7a55da5f4163b39d77'],
  ['actual-review-v2/adapter.mjs', '2431b7ce8e6b7328445f6636a1c1210ccae417525bfe5a1750fda6eeb5319ff2', 'dad2b08ce6bba02d3c404e7a55da5f4163b39d77'],
  ['actual-review-v2/CONTINUATION-EVIDENCE.jsonl.gz', '05619a20fc1ce8012b5dd3539b3e37a47070fb9c799b39d13248fdc8d44e88d8', 'dad2b08ce6bba02d3c404e7a55da5f4163b39d77'],
  ['source-audit-v1/AUDIT.json', 'ef28591b7ccef180b50f75bc834d4fec76ff82519a5d38875acb715fd84217ba', 'e3d2cec5f4e3dbe2e06b40caf2b35f0811f0bebf'],
  ['source-audit-v1/PINNED-INPUTS.json', '8aaac1c8562575ce03b217003b164c25a34554b3ccc223de4325f623a595c6c6', 'e3d2cec5f4e3dbe2e06b40caf2b35f0811f0bebf'],
  ['source-audit-v1/REPORT.md', 'a6deb1a8de405468bcb8ec563cd653890015813093abcca408bb3e0dae231744', 'e3d2cec5f4e3dbe2e06b40caf2b35f0811f0bebf'],
  ['f11-reconciliation-v1/PROFILE.json', '4a0f9b6c458406767ea59a57027161b1c491d32d83ed35da4edd93086b7db749', 'e4af03ea0d0296a5eddecfb59c8f3710482cca5c'],
  ['f11-reconciliation-v1/HANDOFF.md', '0cd104efe5a4dcee708c5605ca25f54fa9314369619d2c287e7e7a6d1cc109b3', 'e4af03ea0d0296a5eddecfb59c8f3710482cca5c'],
  ['static-repros-v1/PRE-SEAL.json', 'fae62845e4754eadd1bb2b7c42ebe81e29f59484e8adef0dc0b0540bc993aa33', '08dd69d06a2f40edd31263631605ae153a9cf318'],
  ['static-repros-interruption-v1/AUDIT.md', '4695e51b71460be98ce40399f85b56a1e0547ce17dee81a7fa80c1d5834ee055', '06bfa5c918bf66ad36b106d4586d3dafa59f6f82'],
];
const inputBytes = new Map();
const inputs = [];
for (const [path, expectedSha, revision] of specifications) {
  const bytes = await readFile(join(review, path));
  check(sha(bytes) === expectedSha, `input hash mismatch ${path}`);
  inputBytes.set(path, bytes);
  inputs.push({ path, revision, sha256: sha(bytes), bytes: bytes.length, blob: blob(bytes) });
}
const specificity = json(inputBytes.get('denial-specificity-v1/CASE-EVIDENCE.json'));
const diagnosis = json(inputBytes.get('diagnosis-v1/CASES.json'));
const obligationReview = json(inputBytes.get('actual-review-v2/OBLIGATION-REVIEW.json'));
const f11Profile = json(inputBytes.get('f11-reconciliation-v1/PROFILE.json'));
const sourcePins = json(inputBytes.get('source-audit-v1/PINNED-INPUTS.json'));
const sourceAudit = json(inputBytes.get('source-audit-v1/AUDIT.json'));
const staticPreseal = json(inputBytes.get('static-repros-v1/PRE-SEAL.json'));
check(specificity.cases.length === 15 && diagnosis.cases.length === 195 && obligationReview.obligations.length === 161, 'fixed input denominators');
const archive = new Map();
for (const line of gunzipSync(inputBytes.get('actual-review-v2/CONTINUATION-EVIDENCE.jsonl.gz')).toString('utf8').trimEnd().split('\n')) {
  const entry = JSON.parse(line);
  check(!archive.has(entry.path), `duplicate archive entry ${entry.path}`);
  if (/^(SOURCE|INSTALLED_MOVED)-\d+(\.json|\/stdout.raw)$/.test(entry.path)) archive.set(entry.path, Buffer.from(entry.base64, 'base64'));
}
const pointer = (value, path) => path.split('/').slice(1).reduce((row, key) => row[key], value);
const lineAt = (path, number) => archive.get(path).toString('utf8').split('\n')[number - 1];
const verifyRaw = binding => {
  const bytes = archive.get(binding.path);
  check(bytes && bytes.length === binding.bytes && sha(bytes) === binding.sha256, `raw file ${binding.path}`);
  const observationLine = lineAt(binding.path, binding.observationLine);
  const outcomeLine = lineAt(binding.path, binding.outcomeLine);
  check(sha(observationLine) === binding.observationLineSha256, 'observation line hash');
  check(sha(outcomeLine) === binding.outcomeLineSha256, 'outcome line hash');
  return { observationLine, outcomeLine };
};
const candidateBlobs = sourcePins.inputs.filter(row => row.id.startsWith('candidate/')).map(({ path, blob: sourceBlob, sha256 }) => ({ path, blob: sourceBlob, sha256 }));
check(candidateBlobs.length === 10, 'ten candidate overlays');
const held = [];
for (const row of specificity.cases) {
  const kind = row.id.includes('header-column') ? 'H' : row.id.includes('B01-R4') ? 'O' : row.id.includes('B01-R6') ? 'C' : 'S';
  for (const layout of row.layouts) {
    const raw = verifyRaw(layout.rawBinding);
    check(raw.observationLine === layout.rawObservationLine && raw.outcomeLine === layout.rawOutcomeLine, 'exact existing lines');
    const jobBytes = archive.get(layout.archivedJob.path);
    check(jobBytes.length === layout.archivedJob.bytes && sha(jobBytes) === layout.archivedJob.sha256, 'exact job');
    const job = json(jobBytes);
    const jobEntry = pointer(job, layout.archivedJob.jobPointer);
    const frozenRow = pointer(job, layout.archivedJob.rowPointer);
    check(same(jobEntry, layout.archivedJob.jobEntry), 'job pointer');
    check(same(jobEntry.argv ?? frozenRow.argv, row.exactArgv) && same(layout.archivedJob.argv, row.exactArgv), 'exact argv');
    const observation = JSON.parse(raw.observationLine).observation;
    const outcome = JSON.parse(raw.outcomeLine);
    check(observation.stderrBase64 === layout.diagnosticBase64, 'exact diagnostic');
    const input = Buffer.from(frozenRow.stdin.utf8, 'utf8');
    const binding = { candidate: specificity.candidate, base: specificity.base, freeze: specificity.freeze, inventory: f11Profile.inventory, package: f11Profile.package, candidateBlobs, id: row.id, command: 'xan', argv: row.exactArgv, layout: layout.layout, kind, inputHex: input.toString('hex'), inputSha256: sha(input), frozenCaseSha256: sha(JSON.stringify(row.frozenCase)), obligationBindings: row.obligations.map(({ revision, input: path, pointer: reference, subtreeSha256 }) => ({ revision, path, pointer: reference, subtreeSha256 })), job: layout.archivedJob, rawBinding: layout.rawBinding };
    const expected = { binding, kind, command: row.exactArgv[0], status: row.frozenCase.expected.status, stdoutBase64: Buffer.from(row.frozenCase.expected.stdoutUtf8).toString('base64'), files: {}, beforeIO: kind === 'S' || kind === 'C', requiredFamily: row.frozenCase.requiredDiagnosticFamily ?? null, diagnosticByteCap: 65536 };
    held.push({ key: `${layout.layout}/${row.id}`, expected, datum: { binding, observation, outcomeIntact: outcome.intact, outcomeClosed: outcome.closed }, raw, originalStatus: outcome.status, frozenCase: row.frozenCase, originalUnqualified: row.unqualified, classification: 'EXISTING_RAW_DATA_NOT_CORRECTED_RUNTIME_PASS' });
  }
  check(row.layouts[0].diagnosticBase64 === row.layouts[1].diagnosticBase64, 'SOURCE/MOVED byte equality');
}
const guards = [];
const guardIds = new Set(['T06S/P0', 'T06L/P0', 'T07S/P0', 'T07L/P0', 'T08S/P0', 'T08L/P0', 'B01-R7-invalid-plural/P0']);
for (const [path, bytes] of archive) {
  if (!path.endsWith('/stdout.raw')) continue;
  const lines = bytes.toString('utf8').split('\n');
  for (let index = 0; index < lines.length; index++) {
    let entry;
    try { entry = JSON.parse(lines[index]); } catch { continue; }
    if (entry.stage !== 'RAW_OBSERVATION' || !guardIds.has(entry.id)) continue;
    const jobPath = path.replace('/stdout.raw', '.json');
    const job = json(archive.get(jobPath));
    const row = job.rows.find(candidate => `${candidate.id}/P0` === entry.id);
    const outcome = JSON.parse(lines[index + 1]);
    check(row && outcome.id === entry.id && outcome.stage === 'CASE', 'guard evidence pairing');
    const kind = entry.id.startsWith('T') ? 'M' : 'I';
    const input = Buffer.from(row.stdin.utf8);
    const binding = { candidate: specificity.candidate, base: specificity.base, freeze: specificity.freeze, candidateBlobs, command: 'xan', argv: row.argv, id: entry.id, layout: job.layout, kind, inputHex: input.toString('hex'), inputSha256: sha(input), job: { path: jobPath, sha256: sha(archive.get(jobPath)) }, rawBinding: { archiveSha256: specificity.archive.sha256, path, sha256: sha(bytes), observationLine: index + 1, observationLineSha256: sha(lines[index]), outcomeLine: index + 2, outcomeLineSha256: sha(lines[index + 1]) } };
    guards.push({ key: `${job.layout}/${entry.id}`, expected: { binding, kind, command: row.argv[0], status: row.expected.status, stdoutBase64: Buffer.from(row.expected.stdout.utf8).toString('base64'), files: {}, beforeIO: false, diagnosticByteCap: 65536, exactStderrBase64: kind === 'M' ? Buffer.from(row.expected.stderr.utf8).toString('base64') : null }, datum: { binding, observation: entry.observation, outcomeIntact: outcome.intact, outcomeClosed: outcome.closed }, raw: { observationLine: lines[index], outcomeLine: lines[index + 1] }, originalStatus: outcome.status, frozenExpected: row.expected, labelRequirement: row.stderrAdditionalSemanticAssertion ?? null, classification: 'HISTORICAL_GUARD_EVIDENCE_NOT_IN_FIFTEEN_CLASS_RELAXATION' });
  }
}
check(held.length === 30 && guards.length === 14, 'held and guard receipt counts');
const controls = [];
const commonNegatives = ['wrong-class', 'wrong-subcommand', 'wrong-command', 'wrong-status', 'wrong-output', 'wrong-argv', 'wrong-layout', 'wrong-input', 'wrong-candidate', 'wrong-blob', 'wrong-class-binding', 'wrong-receipt', 'wrong-job', 'missing-cleanup', 'cleanup-failure', 'not-drained', 'not-closed', 'not-intact', 'escaping-failure', 'readonly-change', 'write-event', 'borrowed-return', 'missing-phase', 'overbudget', 'invalid-utf8', 'invalid-base64', 'empty-diagnostic'];
const add = (row, operation, accept, family) => controls.push({ id: `${family}/${row.key}/${operation}`, key: row.key, operation, expectedQualified: accept, family, origin: 'SYNTHETIC_DATA_NOT_PRODUCT_OBSERVATION' });
for (const row of held) {
  add(row, 'unchanged', true, 'held-counterexample-controls');
  for (const operation of commonNegatives) add(row, operation, false, 'held-counterexample-controls');
  if (row.expected.beforeIO) add(row, 'wrong-phase', false, 'held-counterexample-controls');
  if (row.expected.kind === 'S') add(row, 'class-without-family', !row.expected.requiredFamily, 'held-counterexample-controls');
}
for (const row of guards) {
  add(row, 'unchanged', true, 'outside-relaxation-controls');
  for (const operation of ['wrong-status', 'wrong-output', 'missing-cleanup', 'overbudget', 'invalid-utf8', row.expected.kind === 'M' ? 'wrong-M-bytes' : 'wrong-I-label']) add(row, operation, false, 'outside-relaxation-controls');
  if (row.expected.kind === 'I') add(row, 'plural-I-with-incidental-i', true, 'outside-relaxation-controls');
}
const methods = {
  DIAGNOSTIC_SPECIFICITY_HOLD: ['New class DATA qualification only; later phase/cleanup assertions were fail-fast unexecuted.', 'Original continuation assertions and missing runtime observations, only if independently authorized.'],
  DIAGNOSTIC_EQUIVALENT_WORDING: ['Ten wording-equivalent corrections per layout prepared, not executed.', 'Preserved status/bytes/phase/cleanup assertions under versioned corrected verifier; future authorization required.'],
  OUTPUT_FLAGS_AFTER_DOUBLE_DASH: ['45 file-phase recipes per layout have misplaced output options; correction prepared only.', 'Correctly bound file-phase effects and cleanup observations; future authorization required.'],
  MIDDLEWARE_DISCARDS_COMMAND_RESULT: ['Five middleware recipes per layout discard results; correction prepared only.', 'Actual result preservation through middleware and unchanged assertions; future authorization required.'],
  ASYNC_BRIDGE_AND_MIDDLEWARE_LOSE_PROVENANCE: ['Two provenance recipes per layout confound Promise identity/results; correction prepared only.', 'Public readiness, exact Promise identity and provenance observations; future authorization required.'],
  F11_DIAGNOSTIC_VERSUS_WORK_CAPACITY: ['F11 policy reconciled; primary-limit identity and counter telemetry remain absent.', 'Independent actual primary-limit/counter/cleanup and precedence evidence, not static annotations; future authorization required.'],
  DEFAULT_WORK_CAPACITY_LEDGER_UNIMPLEMENTED: ['12 combined default-work/capacity cases lack executed independent ledgers.', 'Bound normative work/live-capacity observations and matching semantic effects; currently static/data only.'],
  GENERATOR_OMITS_DEPTH_ONE: ['Four combined configured-depth-one recipes omitted.', 'Distinct legal configuration/refusal evidence; future authorization required.'],
  NO_LEGAL_DEPTH_THREE_WITNESS: ['Four combined depth-three runtime witnesses unavailable in bounded grammar.', 'Explicit unreachable-runtime versus invalid-configuration distinction; no invented witness or pass.'],
  GENERATOR_ONLY_EVEN_OUTPUT_SERIALIZATION: ['Eight combined odd-output generator misses.', 'Disclosed legal generator/input correction and independent exact effects; future authorization required.'],
  TWO_AUTHORITY_CONFLICT_NOT_INJECTED: ['Two combined authority-conflict cases were not injected.', 'Truthfully bound distinct backing authorities and actual refusal/effects; future authorization required.'],
  COOPERATIVE_35_SECOND_ABORT: ['Seven combined deadline-aborted cases are nonpasses, not semantic completions.', 'Complete bounded receipts with exact cancellation/cleanup provenance; future authorization required.'],
};
const matrixCases = diagnosis.cases.map((row, index) => {
  check(methods[row.cause], `unmapped diagnosis cause ${row.cause}`);
  const remaining = row.cause === 'DIAGNOSTIC_SPECIFICITY_HOLD' ? ['Original subsequent phase/cleanup assertions were fail-fast unexecuted; raw field checks are DATA only.', 'Unrecorded temporal ordering and full runtime resource closure remain unknown.'] : row.cause === 'F11_DIAGNOSTIC_VERSUS_WORK_CAPACITY' ? ['Actual primary internal limit identity and first failed admission', 'Actual W/R/O counter balances and charged reservations', 'Full independent normative work/live-allocation ledger', 'Cleanup admission/completion/identity and failure precedence', 'No masking caller abort, parentBudget/control, actual sink or cleanup failure', 'Independent adequate-resource identifying-diagnostic control'] : row.unqualified;
  return { key: `${row.layout}/${row.id}`, layout: row.layout, id: row.id, diagnosisPointer: `/cases/${index}`, originalStatus: row.originalStatus, originalExecuted: row.executed, cause: row.cause, category: row.category, diagnosisMappingProvenance: row.obligationMapProvenance, obligationKeys: row.obligations.map(item => `${item.kind}/${item.id}`), rawBinding: row.rawBinding, originalUnqualifiedSubassertions: row.unqualified, stillUnqualifiedSubassertions: remaining, newDisposition: methods[row.cause][0], evidenceNeeded: methods[row.cause][1], allowedNextMethod: 'CURRENT static artifact/source or benign JSON/string/math DATA only. NO product execution/repair; any future runtime method requires new authorization.' };
});
const families = Object.keys(methods).map(cause => ({ cause, count: matrixCases.filter(row => row.cause === cause).length, layouts: Object.fromEntries(['SOURCE', 'INSTALLED_MOVED'].map(layout => [layout, matrixCases.filter(row => row.cause === cause && row.layout === layout).length])), caseKeys: matrixCases.filter(row => row.cause === cause).map(row => row.key), evidenceNeeded: methods[cause][1] }));
const obligationMatrix = obligationReview.obligations.map((row, index) => ({ key: `${row.kind}/${row.id}`, kind: row.kind, id: row.id, originalPointer: `/obligations/${index}`, input: row.input, pointer: row.pointer, subtreeSha256: row.subtreeSha256, originalActualIds: row.actualIds, originalLayouts: row.layouts, originalCertification: row.certification, originalInterpretation: row.interpretation, diagnosisCaseKeys: matrixCases.filter(item => item.obligationKeys.includes(`${row.kind}/${row.id}`) || row.actualIds?.includes(item.id)).map(item => item.key), currentQualification: 'NO_NEW_RUNTIME_CERTIFICATION; linked diagnosis subassertions remain open; empty links mean no row in the 195-nonpass map, not universal acceptance.', allowedNextMethod: 'Read exact frozen/archived DATA and source only; no newly authorized execution.' }));
const f11 = diagnosis.cases.filter(row => row.cause === 'F11_DIAGNOSTIC_VERSUS_WORK_CAPACITY').map(row => {
  const raw = verifyRaw(row.rawBinding);
  const observation = JSON.parse(raw.observationLine).observation;
  check(same(observation, row.observation), 'F11 exact raw');
  const jobPath = row.rawBinding.path.replace('/stdout.raw', '.json');
  const jobBytes = archive.get(jobPath);
  const job = json(jobBytes);
  const jobIndex = job.jobs.findIndex(item => item.id === row.id);
  const entry = job.jobs[jobIndex];
  const isWork = row.id.includes('maxWork');
  check(entry.kind === 'ledger' && entry.name === (isWork ? 'maxWork' : 'maxRetainedBytes') && entry.delta === -1, 'F11 archived invocation configuration');
  const configuredCaps = { ...f11Profile.defaults, [entry.name]: observation.limit };
  const path = f11Profile.cases.find(item => item.id === (isWork ? 'F11-W14' : 'F11-R63'));
  return { key: `${row.layout}/${row.id}`, originalStatus: row.originalStatus, rawBinding: row.rawBinding, raw, jobBinding: { path: jobPath, sha256: sha(jobBytes), pointer: `/jobs/${jobIndex}`, entry }, invocation: { argv: ['count'], inputHex: '610a', inputSha256: sha(Buffer.from('610a', 'hex')), source: 'READ-ONLY adapter.mjs:171-178; job kind ledger; not RAW argv/counter telemetry' }, configuredCaps, capProvenance: 'archive job override + bound factory defaults; configuration not observed counter balance', observed: { result: observation.result, failed: observation.failed, stdoutBase64: observation.stdoutBase64, stderrBase64: observation.stderrBase64, events: observation.events, inputEvents: observation.inputEvents, fsEvents: observation.fsEvents, closed: observation.closed, files: observation.files }, adapterAnnotationsNotTelemetry: { exact: observation.exact, limit: observation.limit, ledger: observation.ledger, scope: observation.scope }, staticDerivedOnly: path.staticPath, assessment: 'OBSERVED_STATUS_1_EMPTY_STDOUT_EMPTY_STDERR_CLOSED; STATIC_POLICY_COMPATIBILITY_ONLY; RUNTIME_PRIMARY_LIMIT_AND_LEDGER_UNQUALIFIED', subassertions: { statusAndOutput: 'OBSERVED', coarseRootDrainAndClosed: 'OBSERVED', actualPrimaryLimitIdentity: 'UNQUALIFIED', actualFirstFailedAdmission: 'UNQUALIFIED', actualWRORemainingAndReservations: 'UNQUALIFIED', fullNormativeWorkAllocation: 'UNQUALIFIED', cleanupPromiseIdentityAdmissionAndFailurePrecedence: 'UNQUALIFIED', noMaskingCallerParentSinkCleanup: 'UNQUALIFIED', ampleResourceDiagnosticControl: 'ABSENT_FROM_THESE_RAW_CASES' }, absent: ['counter telemetry', 'actual primary LimitError identity', 'measured W/R/O ledger', 'actual allocation trace', 'independent ample-resource control', 'actual caller/parentBudget/control/sink/cleanup-failure precedence control'] };
});
const counters = { existingDiagnosticChecks: held.length, syntheticControls: controls.length, syntheticPositive: controls.filter(row => row.expectedQualified).length, syntheticNegative: controls.filter(row => !row.expectedQualified).length, separatelyRetainedGuardReceipts: guards.length, f11ArtifactAssessments: f11.length, diagnosisRows: matrixCases.length, obligations: obligationMatrix.length, newProductCases: 0 };
const artifacts = {
  'INPUTS.json': { classification: 'AUTHENTICATED_READ_ONLY_INPUTS_NOT_EXECUTED', inputs },
  'DATA.json': { classification: 'EXACT_OLD_RECEIPTS_PLUS_NEW_EXPECTED_DATA_PROFILE_NOT_RUNTIME_RESCORE', held, guards },
  'CONTROLS.json': { classification: 'FINITE_NEW_SYNTHETIC_DATA_CONTROLS', counters, controls },
  'STILL-UNQUALIFIED.json': { classification: 'DIAGNOSIS_MAPPING_NOT_PRODUCT_OUTCOMES', originalOutcomes: { SOURCE: '569/79/19', INSTALLED_MOVED: '570/79/18' }, counts: diagnosis.counts, families, cases: matrixCases, obligations: obligationMatrix, originalFamilyLimits: obligationReview.familyLimits, originalUnrun: obligationReview.unrun, preparedUnrun: { mechanicalPerLayout: { filephase: 45, middleware: 5, provenance: 2, wordingEquivalents: 10 }, heldClassPerLayout: 15, F11PerLayout: 2, blockedCombined: { defaultWorkCapacity: 12, generatorMisses: 16, authorityConflicts: 2, deadlineAbort: 7 }, futureDirect: f11Profile.cases.map(row => ({ id: row.id, status: 'HELD_UNEXECUTED', layouts: 2 })), futureFinding: staticPreseal.cases.map(row => ({ id: row.id, status: 'HELD_UNEXECUTED', layouts: 2 })), parentOverlayControls: { historicalOnly: 74, positive: 18, negative: 56, runtimeClosure: false, rerun: false } } },
  'F11-ASSESSMENT.json': { classification: 'EXACT_TWO_CASES_TIMES_TWO_LAYOUTS_ONLY_NO_OMISSION_PASS', profile: { version: f11Profile.version, policyVerbatim: f11Profile.policy, sha256: sha(inputBytes.get('f11-reconciliation-v1/PROFILE.json')) }, cases: f11, futureCasesExecuted: 0, historicalControlsRerun: 0 },
  'SOURCE-FINDINGS.json': { classification: 'PINNED_SOURCE_ONLY_NOT_RUNTIME_OR_CYBER_FINDINGS_NO_REPAIR_AUTHORIZATION', auditCommit: 'e3d2cec5f4e3dbe2e06b40caf2b35f0811f0bebf', candidate: specificity.candidate, sourceBindings: sourcePins.inputs.filter(row => row.id.startsWith('candidate/')), findings: sourceAudit.findings.map(row => ({ id: row.id, topic: row.topic, normative: row.normative, sites: row.sites, proof: row.proof, staticLedger: row.staticLedger ?? null, status: 'STATIC_ONLY_FUTURE_OBSERVATIONS_HELD', next: 'Conceptual falsifiers and future evidence in SOURCE-FINDINGS.md; no executable workload authorized.' })), preparedCaseIds: staticPreseal.cases.map(row => row.id), preparedLayouts: 2, observedRuntimeResults: 0 },
};
async function durableNew(path, value) {
  await writeFile(join(owned, path), JSON.stringify(value) + '\n', { flag: 'wx' });
  const handle = await open(join(owned, path), 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}
for (const [path, value] of Object.entries(artifacts)) await durableNew(path, value);
const entries = [];
for (const path of (await readdir(owned)).sort()) {
  check(!path.includes('/') && path !== 'attempt-1', 'preseal files only');
  const bytes = await readFile(join(owned, path));
  entries.push({ path, bytes: bytes.length, sha256: sha(bytes), blob: blob(bytes) });
}
const executable = await readFile(process.execPath);
await durableNew('PRE-SEAL.json', { classification: 'NEW_DATA_ONLY_RECIPE_PRESEAL', date: '2026-08-28', attemptLimit: 1, entries, tool: { path: process.execPath, sha256: sha(executable), version: process.version }, inputs, counters, candidateExecutionsBeforeSeal: 0, oldValidatorsExecuted: 0, boundary: 'No candidate/product imports, dynamic evaluation, subprocess workloads, build/compiler/native probes, network or new dependencies. Artifact-only DATA.', appendAware: 'Qualification enumerates owned files before and after; input postchecks hash exactly listed read-only artifacts, not an append-proof external tree.' });
console.log(JSON.stringify({ prepared: true, counters, predicateExecuted: false }));
