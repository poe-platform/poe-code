import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGzip, gunzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { authenticatePacket, readAuthorization } from '../../authorization.mjs';
import { readDocument } from '../../records.mjs';
import { authenticateView, inspectTree, boundFile } from '../../projection.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const runId = 'admission-v7-r2-01';
const body = path.join(root, 'runs', runId);
const collector = `${body}-supervision`;
const grantRoot = `${body}-grant`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const recipe = 'b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c';
const authSha = '1afde12dabbd7d6fc8d29d5438eaac2c153e0e0cdc7eb2f0c7235ffe8c9347f2';
assert.equal(authenticatePacket(root), recipe);
const authorization = readAuthorization(path.join(grantRoot, 'AUTH.json'), authSha, root);
const launchBytes = fs.readFileSync(path.join(grantRoot, 'LAUNCH.stdout'));
const launch = JSON.parse(launchBytes);
assert.equal(launch.schema, 'BREADTH_V7_LAUNCH');
assert.equal(launch.qualified, false);
assert.equal(launch.unsafe, true);
assert.equal(fs.readFileSync(path.join(grantRoot, 'LAUNCH-SHELL-EXIT.data'), 'utf8'), '1\n');
assert.equal(fs.statSync(path.join(grantRoot, 'LAUNCH.stderr')).size, 0);
const coordinator = readDocument(collector, launch.reference.path, launch.reference.sha256);
const outer = readDocument(collector, launch.summaryReference.path, launch.summaryReference.sha256);
const terminal = JSON.parse(Buffer.from(coordinator.stdout, 'base64'));
assert.equal(terminal.status, 'UNSAFE_STOP');
const result = readDocument(body, terminal.result.path, terminal.result.sha256);
const staged = readDocument(body, 'STAGED.json', result.stagedSha256, 2097152);
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
const views = [];
for (const view of Object.values(staged.views)) {
  authenticateView(projection, view);
  const tree = inspectTree(view.root, view.files);
  if (view.oldOrigin) assert.equal(fs.existsSync(view.oldOrigin), false);
  views.push({ name: view.name, engine: view.engine, ...tree, oldOriginAbsent: view.oldOrigin ? true : null, bytes: view.files.reduce((total, entry) => total + entry.bytes, 0) });
}
for (const tool of projection.tools) boundFile(tool.path, tool);
const captured = [];
const authority = [];
const processes = [];
function inspectReceipt(role, receipt) {
  const retained = { stdout: Buffer.from(receipt.stdout, 'base64').length, stderr: Buffer.from(receipt.stderr, 'base64').length, records: Buffer.from(receipt.rawRecords, 'base64').length };
  assert.deepEqual(retained, receipt.captureBytes);
  assert.ok(retained.stdout <= 65536 && retained.stderr <= 65536 && retained.records <= 262144);
  assert.equal(receipt.reaped, true);
  assert.deepEqual(receipt.failures, []);
  assert.deepEqual(receipt.signals, []);
  assert.deepEqual(receipt.exit, receipt.close);
  const events = receipt.records.reduce((counts, row) => { counts[row.kind] = (counts[row.kind] ?? 0) + 1; return counts; }, {});
  const observed = receipt.records.filter(row => row.kind === 'authority-observed');
  assert.equal(observed.length, 2);
  for (let index = 0; index < observed.length; index++) {
    const row = observed[index], metadata = row.receipt;
    assert.equal(row.sequence, index);
    assert.equal(metadata.role, 'git-authority-metadata');
    assert.equal(metadata.ordinal, index + 1);
    assert.deepEqual(metadata.reference, authorization[index === 0 ? 'review' : 'grant']);
    assert.equal(metadata.stdoutSha256, metadata.reference.sha256);
    assert.equal(metadata.stdoutBytes, index === 0 ? 159 : 951);
    assert.equal(metadata.status, 0);
    assert.equal(metadata.signal, null);
    assert.equal(metadata.errorCode, null);
    assert.equal(metadata.stderrBase64, '');
    assert.equal(metadata.reaped, true);
    authority.push({ parentRole: role, ...metadata });
    processes.push({ role: `${role}/authority-${index + 1}`, pid: metadata.pid, group: metadata.group, disposition: 'spawnSync status0/signalnull, recorded reaped', recordedReaped: metadata.reaped });
  }
  processes.push({ role, pid: receipt.pid, group: -receipt.pid, exit: receipt.exit, close: receipt.close, natural: receipt.natural, recordedReaped: receipt.reaped });
  const final = receipt.records.at(-1);
  captured.push({ role, pid: receipt.pid, exit: receipt.exit, close: receipt.close, natural: receipt.natural, reaped: receipt.reaped, captureBytes: receipt.captureBytes, retainedBytes: retained, events, failures: receipt.failures, signals: receipt.signals, finalKind: final.kind });
  return final;
}
const final = inspectReceipt('coordinator', coordinator);
assert.equal(final.report.children, result.children.length);
assert.equal(final.report.status, result.status);
assert.deepEqual(final.report.result, terminal.result);
assert.deepEqual(result.authorizationMetadata, authority.map(({ parentRole, ...receipt }) => receipt));
const probeRows = [];
for (const entry of result.children) {
  const name = `child-${String(entry.ordinal).padStart(3, '0')}.receipt.json`;
  const receipt = readDocument(body, name, entry.receiptSha);
  const final = inspectReceipt(entry.operationId, receipt);
  assert.deepEqual(final.authorityMetadata, receipt.records.filter(row => row.kind === 'authority-observed').map(row => row.receipt));
  const report = final.report;
  probeRows.push({ operation: entry.operationId, launch: entry.ordinal, view: Object.keys(staged.views)[entry.ordinal - 1], qualifiedProbe: Boolean(report?.exportEvaluation && receipt.natural), nextLoad: receipt.records.filter(row => row.kind === 'nextLoad').length, assetReads: receipt.records.filter(row => row.kind === 'asset-read').length, consumerEvaluated: receipt.records.filter(row => row.kind === 'consumer-evaluated').length, bootstrapEvents: receipt.records.filter(row => row.kind.startsWith('bootstrap-')).length, reportPresent: Boolean(report), postGuard: report?.postGuard ?? null, resources: report ? { pending: report.resources.pending, descriptors: report.resources.descriptors, violations: report.resources.violations, assetReads: report.resources.assets.length } : null, fatal: final.fatal ?? null, denied: receipt.records.filter(row => row.kind === 'offline-denied'), cleanupErrors: final.cleanupErrors, late: final.late });
}
for (const entry of processes) {
  entry.postCaptureAbsence = {};
  for (const [label, identifier] of [['pid', entry.pid], ['group', entry.group]]) {
    try { process.kill(identifier, 0); entry.postCaptureAbsence[label] = 'PRESENT_OR_PID_REUSED'; }
    catch (error) { entry.postCaptureAbsence[label] = error.code === 'ESRCH' ? 'ABSENT' : `UNQUALIFIED_${error.code}`; }
  }
}
const files = [];
let rawBytes = 0;
for (const relative of [`runs/${runId}`, `runs/${runId}-supervision`, `runs/${runId}-grant`]) {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    if (relative === `runs/${runId}` && name === 'views') continue;
    assert.notEqual(name.toUpperCase(), 'AGENTS.MD');
    const filename = path.join(relative, name), info = fs.lstatSync(path.join(root, filename));
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 262144);
    const bytes = fs.readFileSync(path.join(root, filename));
    rawBytes += bytes.length;
    assert.ok(rawBytes <= 8 * 1024 * 1024 && files.length < 1024);
    files.push({ path: filename, bytes: bytes.length, mode: info.mode & 0o7777, sha256: hash(bytes) });
  }
}
const parts = [];
let pending = Buffer.alloc(0), compressedBytes = 0;
function savePart(bytes) {
  const name = `raw-${String(parts.length).padStart(4, '0')}.gzpart`;
  fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx', mode: 0o644 });
  parts.push({ path: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes) });
}
async function* archiveLines() {
  for (const entry of files) {
    const bytes = fs.readFileSync(path.join(root, entry.path));
    assert.equal(hash(bytes), entry.sha256);
    yield `${JSON.stringify({ ...entry, base64: bytes.toString('base64') })}\n`;
  }
}
await pipeline(Readable.from(archiveLines()), createGzip({ level: 9 }), new Writable({ write(bytes, encoding, done) {
  try {
    compressedBytes += bytes.length;
    assert.ok(compressedBytes <= 4 * 1024 * 1024);
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 262144) { savePart(pending.subarray(0, 262144)); pending = Buffer.from(pending.subarray(262144)); }
    done();
  } catch (error) { done(error); }
} }));
if (pending.length) savePart(pending);
const compressed = Buffer.concat(parts.map(entry => { const bytes = fs.readFileSync(path.join(directory, entry.path)); assert.equal(hash(bytes), entry.sha256); return bytes; }));
const restored = gunzipSync(compressed, { maxOutputLength: 12 * 1024 * 1024 }).toString('utf8').trimEnd().split('\n');
assert.equal(restored.length, files.length);
for (let index = 0; index < restored.length; index++) {
  const { base64, ...entry } = JSON.parse(restored[index]);
  assert.deepEqual(entry, files[index]);
  const bytes = Buffer.from(base64, 'base64'), current = fs.lstatSync(path.join(root, entry.path));
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
  assert.equal(current.mode & 0o7777, entry.mode); assert.equal(hash(fs.readFileSync(path.join(root, entry.path))), entry.sha256);
}
assert.equal(authenticatePacket(root), recipe);
readAuthorization(path.join(grantRoot, 'AUTH.json'), authSha, root);
const report = {
  schema: 'V7_R2_ONE_ADMISSION_POSTCAPTURE_EVIDENCE', date: '2026-08-28', runId, attempts: 1,
  status: result.status, admissionQualified: false, unsafe: true, grantConsumed: true,
  grant: authorization.grant, review: authorization.review, authSha256: authSha, recipeSha256: recipe,
  actual: { workers: result.children.length, plannedWorkers: 14, unlaunchedWorkers: 14 - result.children.length, qualifiedProbes: probeRows.filter(row => row.qualifiedProbe).length, C11: result.setupCalls, semanticCalls: result.productCohortCalls, authorityMetadataChildren: authority.length, coordinatorChildren: 1, processesExcludingLauncherAndPostcapture: processes.length, targetNextLoad: probeRows.filter(row => row.view.startsWith('target')).reduce((sum, row) => sum + row.nextLoad, 0), comparatorNextLoad: probeRows.find(row => row.view === 'baseline-installed').nextLoad, nativeDelegations: 0, getterWindowActivated: false },
  primary: result.fatal, fatalPhaseLabel: result.fatalPhase,
  cause: 'Worker installs offline guard at worker.mjs:51 before authenticateBootstrap at55. That helper calls boundFile at bootstrap.mjs:24; its fs.lstatSync is already replaced by offline deny. Actual OFFLINE_DENIED is on the exact baseline consumer wrapper before createQueryWindow/import. Harness ordering contradiction, not comparator/product behavior failure or builtin-capability outcome.',
  sourceQualification: 'The recorded stack establishes the denied authentication call. Moving/narrowly separating preflight from guarded import is only a proposed root-reviewed successor; no repair or retry executed.',
  comparatorResourceQualification: 'Final report is null. cleanupErrors and late are empty and process reaped, but pending/descriptors snapshot was not retained; do not invent zero numeric counters. No bootstrap query window was created on this source path.',
  launch: { bytes: launchBytes.length, sha256: hash(launchBytes), shellExit: 1, qualification: 'Sealed launch summary retained; shell exit is not fabricated asynchronous launcher telemetry.' },
  coordinator: { reference: launch.reference, summaryReference: launch.summaryReference, cleanup: outer.cleanup, publicationFailures: terminal.failures },
  capture: captured, probes: probeRows, authorityMetadata: authority, processes, views,
  stagedProof: staged.proof, originalComparatorMetadataCensus: { before: staged.before, after: staged.after },
  targetPackMembers: projection.target.files.length, comparatorDeclaredInputs: 3843, comparatorInstructionMetadataOnly: projection.baseline.excluded,
  stageQualification: '858 full target pack members plus2 consumer files in each layout;3843 comparator inputs plus2 consumer files. Stage remains locally intact; archive deliberately excludes duplicate stage bytes, retaining authenticated STAGED manifests and all raw receipts. No instruction plaintext materialized/read.',
  evidenceAtTerminal: result.evidence, terminalResult: terminal.result, terminalAccounting: terminal.launchAccounting, unrun: result.tail, operations: result.plannedOperations,
  archive: { files: files.length, rawBytes, compressedBytes, maxPhysicalRawRecordBytes: Math.max(...files.map(entry => entry.bytes)), gzipSha256: hash(compressed), parts, roundTrip: 'ALL_RAW_BYTES_MODES_HASHES_EXACT', stagedBytesCopiedToArchive: 0 },
  postGuard: { recipe: '359_BINDINGS_EXACT', auth: 'EXACT', tools: 'EXACT', views: 'ALL_EXACT_COMPLETE_CENSUS', oldMoveOrigin: 'ABSENT', primaryUnchanged: true },
  collectorSourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  exclusions: ['No retry, policy widening, product repair, extra engine execution or historical rescore', 'No99semanticGO', 'W07 comparator nonexecution UNQUALIFIED/UNCREDITED', 'Prior V6 lost294045 bytes/oversized records and all prior consumed grants unchanged', 'Old30+1/7of8/31of33/F08EPERM unchanged', 'Full248+8MiB quota boundaries STATIC_ONLY;256MiB heap not RSS;75min checked elapsed not hard preemption'],
  files
};
const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
assert.ok(bytes.length <= 262144);
fs.writeFileSync(path.join(directory, 'REPORT.json'), bytes, { flag: 'wx', mode: 0o644 });
process.stdout.write(`${JSON.stringify({ status: report.status, actual: report.actual, archive: report.archive, allRecordedProcessesAbsentNow: processes.every(entry => Object.values(entry.postCaptureAbsence).every(value => value === 'ABSENT')), reportBytes: bytes.length, reportSha256: hash(bytes) })}\n`);
