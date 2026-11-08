import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, existsSync, lstatSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {createGzip, createGunzip, gunzipSync} from 'node:zlib';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = join(owned, '../../../../..');
const scope = relative(repository, owned);
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const plan = JSON.parse(readFileSync(join(owned, 'PLAN.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(join(owned, path)));
const metadata = args => execFileSync(git, ['--no-replace-objects', ...args], {cwd: repository, timeout: 15000, maxBuffer: plan.limits.metadataBytes});
const blob = (path, revision) => metadata(['show', `${revision}:${path}`]);
const prefix = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const write = (name, value) => {
  const path = scope + '/' + name;
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (existsSync(join(owned, name))) { assert.equal(readFileSync(join(owned, name), 'utf8'), content.endsWith('\n') ? content : content + '\n', 'existing metadata output must be byte-identical'); return; }
  execFileSync('apply_patch', [], {cwd: repository, input: '*** Begin Patch\n*** Add File: ' + path + '\n' + content.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n', maxBuffer: 1024 * 1024});
};
const files = root => readdirSync(root, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
async function identity(path) {
  const sha = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path, {highWaterMark: 65536})) { bytes += chunk.length; sha.update(chunk); }
  return {bytes, sha256: sha.digest('hex')};
}

const initial = read('raw/REPORT.json');
const firstFollowup = read('raw-followup/REPORT.json');
const policyRun = JSON.parse(gunzipSync(readFileSync(join(owned, 'raw-followup2/REPORT.json.gz'))));
const incident = read('POLICY-COPY-INCIDENT.json');
const current = read('raw-followup3/REPORT.json');
assert.equal(current.omittedInstructionFiles.length, 1);
assert.ok(!current.fatal && current.controls.length === 2 && current.controls.every(row => row.status === 'PASS'));
const positive = current.controls.find(row => row.id === 'A10-shared-positive').evidence;
const duplicate = current.controls.find(row => row.id === 'A10-real-duplicate').evidence;
const typing = positive.typing;
const emit = read('raw-followup3/positive-emit.json');
const observer = read('raw/observer-raw.json');
const probe = read('raw/observer-probe.json');
assert.equal(probe.controls.length, 13); assert.ok(probe.controls.every(row => row.status === 'PASS'));
assert.equal(hash(JSON.stringify(emit)), 'f628eb40fdd27ec3980f98c6b026238b316d345fc0eb759584c0b82d22a675b4');
const profile = JSON.parse(gunzipSync(Buffer.from(blob(prefix + 'PROFILE.json.gz.base64', plan.bindings.driver).toString().trim(), 'base64')));
const external = JSON.parse(gunzipSync(Buffer.from(blob(prefix + 'EXTERNAL.json.gz.base64', plan.bindings.driver).toString().trim(), 'base64')));
const entries = metadata(['ls-tree', '-rlz', plan.bindings.candidate]).toString().split('\0').filter(Boolean).map(row => {
  const split = row.indexOf('\t'); const [mode, type, object, bytes] = row.slice(0, split).trim().split(/\s+/u); assert.equal(type, 'blob');
  return {path: row.slice(split + 1), mode, blob: object, bytes: Number(bytes)};
});
assert.deepEqual(entries, profile.scopeInputs);
const member = new Map(entries.map(entry => [entry.path, entry]));
for (const entry of plan.sliceClosure.entries) { assert.deepEqual(entry, member.get(entry.path)); assert.notEqual(entry.path.split('/').at(-1), 'AGENTS.md'); }
const authorized = ['tests/commands/split/integration.test.ts', 'tests/commands/stream-format-author-stress/contracts.test.ts', 'tests/integration/stream-inspection-public-author/public.test.ts', 'tests/plugins/stream-five-public/consumer.mjs'];
assert.deepEqual(current.fourPaths, authorized);
const fixtures = authorized.map(path => ({path, baseBlob: metadata(['rev-parse', `${plan.bindings.base}:${path}`]).toString().trim(), candidateBlob: member.get(path).blob, baseSha256: hash(blob(path, plan.bindings.base)), candidateSha256: hash(blob(path, plan.bindings.candidate)), exactDiff: metadata(['diff', '--no-ext-diff', '--unified=1', plan.bindings.base, plan.bindings.candidate, '--', path]).toString()}));
const sharedCalls = Object.fromEntries(['execute.mjs', 'review-build-types.mjs'].map(name => {
  const bytes = blob(prefix + name, plan.bindings.driver); const lines = bytes.toString().split('\n');
  return [name, {sha256: hash(bytes), callsites: lines.flatMap((line, index) => /(?:import .*build-types|import .*phase-runner|createBuildAudit\(|createPhaseRunner\(|await runBuildTypes\()/u.test(line) ? [{line: index + 1, source: line.trim()}] : [])}];
}));
const sourceRoot = join(owned, 'work-followup3/source');
const expectedModules = new Map();
for (const [path, entry] of Object.entries(read('raw-followup3/selected-manifest.json').files)) expectedModules.set(join(sourceRoot, path), entry.sha256);
for (const entry of read('raw-followup3/copied-dependencies.json')) expectedModules.set(join(sourceRoot, entry.path), entry.sha256);
for (const entry of external.directories.npm.entries) if (entry.kind === 'file') expectedModules.set(entry.origin, entry.sha256);
expectedModules.set(join(owned, 'work-followup3/harness/build-audit.mjs'), plan.bindings.runtimeFiles['build-audit.mjs']);
expectedModules.set(join(owned, 'work-followup3/harness/import-guard.mjs'), current.guard.sha256);
const moduleRows = files(join(owned, 'raw-followup3/imports')).flatMap(path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
const observedModules = new Map();
for (const row of moduleRows) { assert.equal(row.sha256, expectedModules.get(row.resolved), `unbound actual module ${row.resolved}`); observedModules.set(row.resolved, row.sha256); }
const loadProof = {actualChildLogRows: moduleRows.length, processesWithModuleLogs: files(join(owned, 'raw-followup3/imports')).length, uniqueChildModules: [...observedModules].map(([path, sha256]) => ({path, sha256})), parentLoads: current.parentLoads, qualification: 'Every recorded child resolution digest independently matches selected committed inputs, authenticated copied dependencies, authenticated npm tree, or exact frozen guard/audit. Compiler resolution trace assertions additionally bind consumer declarations. No claim of complete syscall/process-image tracing.'};
write('LOAD-PROOF-2.json', loadProof);

const states = [initial, firstFollowup, policyRun, current];
const recordedProcesses = [...states.flatMap(report => report.controls.flatMap(row => row.evidence?.phases?.flatMap(phase => phase.observed) ?? [])), ...read('raw/slice.json').phases.flatMap(phase => phase.observed), ...read('raw-followup/slice.json').phases.flatMap(phase => phase.observed), ...duplicate.result.observed, ...policyRun.controls.find(row => row.id === 'A10-real-duplicate').evidence.result.observed, ...observer.observed.groups, observer.observed.root, observer.foreignBefore];
const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command='], {encoding: 'utf8', timeout: 2000, maxBuffer: 8 * 1024 * 1024}).split('\n').filter(Boolean).map(line => { const parts = line.trim().split(/\s+/u); return {pid: Number(parts[0]), parent: Number(parts[1]), group: Number(parts[2]), born: parts.slice(3, 8).join(' '), command: parts.slice(8).join(' ')}; });
const unique = [...new Map(recordedProcesses.map(row => [`${row.pid}:${row.born}`, row])).values()];
const survivors = ps.filter(row => unique.some(record => record.pid === row.pid && record.born === row.born));
assert.deepEqual(survivors, []);
const oldHashes = initial.priorHashes;
for (const [path, sha256] of Object.entries(oldHashes)) assert.equal(await identity(join(repository, path)).then(row => row.sha256), sha256, path);
const frozenFiles = metadata(['ls-files', '-z', scope]).toString().split('\0').filter(Boolean);
for (const path of frozenFiles) assert.equal(hash(readFileSync(join(repository, path))), hash(blob(path, 'HEAD')), path);
const workReceipt = [];
for (const name of ['work-followup3']) {
  const root = join(owned, name); const localFiles = files(root); const regular = localFiles.filter(path => !lstatSync(path).isSymbolicLink());
  let bytes = 0; const digest = createHash('sha256'); let agents = 0;
  for (const path of localFiles) {
    const stat = lstatSync(path); if (path.split('/').at(-1) === 'AGENTS.md') agents++;
    if (!stat.isSymbolicLink()) { const row = await identity(path); bytes += row.bytes; digest.update(JSON.stringify({path: relative(root, path), ...row}) + '\n'); }
  }
  assert.equal(agents, 0); assert.ok(bytes <= plan.limits.workBytes);
  workReceipt.push({root: name, files: localFiles.length, regularFiles: regular.length, regularBytes: bytes, regularContentManifestSha256: digest.digest('hex'), agentsFiles: agents});
}
assert.ok(workReceipt.reduce((sum, row) => sum + row.regularBytes, 0) < plan.limits.workBytes);
for (const name of ['work-followup3']) rmSync(join(owned, name), {recursive: true});
assert.ok(['work', 'work-followup', 'work-followup2', 'work-followup3'].every(name => !existsSync(join(owned, name))));
for (const name of [...Object.keys(plan.bindings.runtimeFiles), 'DRIVER.json']) assert.equal(existsSync(join(owned, name)), false);

const rawIndex = [];
let uncompressedBytes = 0;
for (const path of files(join(owned, 'raw-followup3'))) {
  const original = await identity(path); uncompressedBytes += original.bytes;
  const row = {path: relative(owned, path), ...original};
  if (original.bytes > 1024 * 1024) {
    assert.equal(metadata(['ls-files', '--', relative(repository, path)]).length, 0, 'never replace already sealed history');
    const target = path + '.gz';
    await pipeline(createReadStream(path, {highWaterMark: 65536}), createGzip({level: 9, chunkSize: 65536}), createWriteStream(target, {flags: 'wx'}));
    const check = createHash('sha256'); let decodedBytes = 0;
    for await (const chunk of createReadStream(target).pipe(createGunzip())) { decodedBytes += chunk.length; check.update(chunk); }
    assert.equal(decodedBytes, original.bytes); assert.equal(check.digest('hex'), original.sha256);
    row.storedPath = relative(owned, target); row.storage = await identity(target); row.encoding = 'gzip-lossless-raw-text'; rmSync(path);
  } else row.storedPath = row.path;
  rawIndex.push(row);
}
assert.ok(uncompressedBytes < plan.limits.rawEvidenceBytes);
write('RAW-INDEX.json', {rawIndex, originalRawBytes: uncompressedBytes, method: 'Only new uncommitted raw-followup3 files larger than1MiB are gzip-streamed in64KiB chunks, decoded/hash-checked, then originals removed. Every historical file remains unchanged; no archive or compiler payload retained.'});
const bindings = {schema: 'unified76-independent-shared-v6-bindings', ...plan.bindings, driverRawSha256: current.driverRawSha256, driverCanonicalSha256: current.driverCanonicalSha256, sharedCalls, fullCandidateMembership: {entries: entries.length, metadataSha256: hash(JSON.stringify(entries)), equalsPinnedProfile: true, physicallyMaterializedEntries: plan.sliceClosure.entries.length, physicallyMaterializedBytes: plan.sliceClosure.bytes, noAgentsCopies: true, notWholeGateClosureExecution: true}, fixtures, srcTree: current.srcTree, pack: current.carriedPack, qualifiedOS: current.externalBefore.systemBoundary, extraReadableTools: current.extraTools, actualBuildReceipt: {files: emit.files.length, canonicalSha256: hash(JSON.stringify(emit)), filesOnlySha256: hash(JSON.stringify(emit.files)), metadataSha256: typing.candidateBinding.metadataSha256, declarations: typing.candidateBinding.declarations.length}, methods: {sameSharedImplementation: true, fullExecuteImported: false, driverSourceFork: false, counterStub: false, wrapper: 'Transparent Node->sandbox-exec spawn adapter retains exact actual npm/compiler argv, audit/loader, real phaseRunner/supervise. Outer ps remains outside. Read-only pinned source inspected before plan, not blind.', selection: plan.sliceClosure.method, observer: 'Actual frozen attachProcessObserver and createObserverClient; direct-child PID/group/birth capability. Exact two historical backslash candidate paths plus contained link; four real watched Git groups. No native suite or large tar.'}};
write('BINDINGS.json', bindings);
const summary = {schema: 'unified76-independent-shared-v6-results', startedAt: initial.startedAt, finishedAt: current.finishedAt, commandReceipts: [
  {command: initial.command, exitStatus: 1, frozenAt: '271e2cb9', result: 'shared positive FAIL before build: missing /bin/bash sandbox permission; independent observer group PASS'},
  {command: firstFollowup.command, exitStatus: 1, frozenAt: '872bfd39', result: 'cold78; typecheckall1 with0builds: /usr/bin/git Apple shim dispatch; duplicate NOT_EXECUTED'},
  {command: policyRun.command, exitStatus: 0, frozenAt: '9be9e9e9', result: 'Behavioral shared positive and duplicate PASS, but forbidden dependency AGENTS copy invalidates clean-procedure acceptance; preserved separately'},
  {command: current.command, exitStatus: 0, frozenAt: '888f01f4ff8703c5351a6b3ee86353f7a7f96046', result: 'Clean shared positive PASS; real duplicate negative PASS; exact instruction file omitted before phases and no AGENTS copies in source/dependency work tree'},
], distinctCurrentControls: {sharedPositive: 'PASS', realDuplicate: 'PASS', outerObserverTransportForeignIsolation: 'PASS'}, preservedSetupFailures: 2, preservedPolicyViolation: {incident: 'POLICY-COPY-INCIDENT.json', initialNoAgentsClaimsSuperseded: true, compliantReplay: true, actualProductionBuildsAcrossAllAttempts: 4, meaning: 'Two separate positive shared builds and two intentional duplicate negatives; two earlier setups built0. Not one total build across review attempts.'}, omittedInstructionFiles: current.omittedInstructionFiles, hiddenRetries: 0, fullGateLaunched: false, authorControlsUsedAsIndependentPasses: 0, typing: {status: typing.status, phases: typing.phases.map(({label, status}) => ({label, status})), maintainedGroups: typing.consumers.groups, sourceGroups: typing.sourceConsumers.groups, expectedNegativeGroups: typing.consumers.negativeTypes, groupsDenominator: '23 maintained +3 source positive type groups;3 expected-negative diagnostic groups, not29 runtime/product passes', productionBuilds: 1, emittedFiles: 832, declarationFiles: 208, runtimeExecutions: 0, cleaned: typing.cleaned}, duplicate: {compilerExitStatus: duplicate.result.status, auditDefaultMaximum: 1, observedRealBuildEvents: duplicate.events, refusal: duplicate.refusal, APIOutcome: 'Actual readBuildAudit throws, caught by independent expected-negative control. Not a CLI78 claim; compiler itself completed0.', sourceGuardUnchangedAfterDuplicate: true}, transport: {independentSubcontrols: probe.controls.map(({id, status, evidence}) => ({id, status, refusal: evidence?.refusal})), observedGitGroups: observer.observed.groups, outerExit: observer.result, zeroSurvivors: observer.observed.survivors.length === 0, foreignBefore: observer.foreignBefore, foreignAfter: observer.foreignAfter, foreignCleanup: initial.foreignFinalCleanup, lifecycleQualification: 'Positive extraction returns status0/null signal/closed/zero survivors. Negative API calls throw; per-child terminal statuses are not exposed by throwing transport API, not invented. Outer observer verifies watched groups empty. Negative rejection is not positive extraction completion.'}, bounds: {configured: plan.limits, measuredPeakWorkBytes: current.peakWorkBytes, measuredPeakRawBeforeFinalReport: current.peakOutputBytes, finalRawBytes: uncompressedBytes, qualification: 'Cooperative5s disk sampling during followups, actual per-phase360s supervisor; whole-review watchdog starts before phase execution after bounded setup. Not a kernel-hard deadline or complete syscall sandbox. Initial short failed setup and observer have no disk monitor; their fixed input/output bounds and measured tree sizes retained.'}, currentScope: 'A10 now closes only for the new shared implementation and approved one-driver-managed-build/type scope. No universal one total build: intentional duplicate negative is second real build, and test-owned isolated builds remain separate.'};
write('RESULTS.json', summary);
const previousLedger = JSON.parse(readFileSync(join(owned, '../completion-v5/LEDGER.json')));
assert.equal(previousLedger.matrix.length, 22); assert.equal(previousLedger.matrix.filter(row => row.status === 'PASS').length, 21);
const matrix = previousLedger.matrix.map(row => row.id === 'A10' ? {...row, status: 'PASS_SCOPED_NEW_SOURCE', latestEvidence: 'shared-v6/RESULTS.json', qualification: summary.currentScope, priorStatus: row.status} : {...row, status: 'PASS_INHERITED_QUALIFIED', notRerun: true, historicalStatus: row.status});
const seven = previousLedger.sevenNew76Proofs.map(row => row.id === 'u76.binding-complete' ? {...row, status: 'HOLD', limit: 'New shared A10 passed; no valid ROOT_RELEASE or whole pipeline. Root must bind required EXPR/public/private prerequisites to final packet; this leaf does not adjudicate moving root receipts or release authorization.'} : {...row, status: 'PASS_BOUNDED_REFUSAL_INHERITED', notRerun: true, carryQualification: 'Immutable candidate/profile/policy/TAP/inventory validators unchanged; admission change only adds exact new runtime modules to seal. Not a new dynamic root-release or CLI run.'});
write('LEDGER.json', {schema: 'unified76-independent-shared-v6-ledger', source: plan.bindings.driver, priorInitial: {commit: '4b13eeda0588200b849f2c7fd6863c137ef75c70', PASS: 19, HOLD: 3, unchanged: true}, priorCurrent: {commit: '37b3c9c3c9c3e911286d0d8542c494f762e17015', PASS: 21, HOLD: 1, unchanged: true}, currentQualified22: {inheritedPASS: 21, newScopedA10PASS: 1, HOLD: 0, qualification: 'Cumulative qualified group ledger, not22 freshly executed groups or full final-driver execution. Original assertion bytes and preinspection chronology stay immutable; root-approved A02/A10/F01 evolution remains additive.'}, matrix, sevenNew76Proofs: seven, sevenSummary: {inheritedBoundedRefusals: 6, completeBindingHOLD: 1}, transportNewCohort: {PASS: 13, FAIL: 0, source: 'raw/observer-probe.json', oldContainedLinkEPERMUnchanged: true}, allPriorCountsPreserved: ['original Meitner71PASS/7NOT_EXECUTED', 'author56', 'author fixture49/1 then19/19 separate', 'author5 shared review controls', 'old2ff20/1', 'old b0ee/dfcb zero-build backslash and observer failures', 'F01 oldexit1/static10', 'v4 initial19/3', 'v5 current21/1 and outer9PASS/1FAIL'], rootRelease: 'HOLD', wholeGateLaunched: false});
write('CLEANUP.json', {recordedProcessIdentities: unique, checkedAt: new Date().toISOString(), observedMatchingSurvivors: survivors, foreignSentinel: {survivedWatchedGroupCleanup: true, explicitlyStoppedByControllerAfterProof: initial.foreignFinalCleanup}, workBeforeRemoval: workReceipt, ownedTemporaryTreesRemoved: true, priorRemovedWorkTrees: incident.workBeforeRemoval, priorForbiddenCopies: incident.actualCopies, currentInstructionFilesOmitted: current.omittedInstructionFiles, currentAgentsCopies: 0, stagedFrozenDriverRemoved: true, priorArtifactsChecked: Object.keys(oldHashes).length, priorArtifactHashes: oldHashes, preexistingSharedFrozenFilesChecked: frozenFiles.length, priorBytesUnchanged: true, workspaceAtSeal: metadata(['status', '--porcelain=v1', '-uall']).toString(), indexAtSeal: metadata(['diff', '--cached', '--raw']).toString(), qualification: 'Only review-owned work trees and staged exact driver copies removed. No unrelated PID/group signalled, foreign real workspace artifacts/index left untouched. Natural slice children closed without signals; foreign sentinel stopped explicitly after proof.'});
console.log(JSON.stringify({results: 'qualified22 cumulative PASS, six inherited refusal proofs / complete-binding HOLD', source: plan.bindings.driver, observer: '13 new subcontrols PASS', rawOriginalBytes: uncompressedBytes, temporaryTreesRemoved: true, priorPreserved: Object.keys(oldHashes).length, matchingSurvivors: survivors.length}));
