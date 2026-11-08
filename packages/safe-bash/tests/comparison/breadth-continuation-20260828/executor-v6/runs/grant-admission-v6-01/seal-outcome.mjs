import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { authenticatePacket } from '../../authorization.mjs';
import { boundFile, authenticateView, inspectTree, parseStage } from '../../projection.mjs';
import { parseTransport } from '../../../executor-v3/transport.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const repository = path.resolve(root, '../../../..');
const runRoot = path.join(root, 'runs/admission-v6-01');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename));
const relative = filename => path.relative(repository, filename);
const save = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
const preflight = read(path.join(directory, 'PREFLIGHT.json'));
const inputBinding = read(path.join(directory, 'INPUTS-PRE.json'));
const projection = read(path.join(root, '../executor-v3/PROJECTION.json'));
const result = read(path.join(runRoot, 'RESULT.json'));
const launch = read(path.join(directory, 'LAUNCH-RECEIPT.json'));
const audit = { kind: 'POST_ONLY_INTEGRITY_AND_CAPTURE_AUDIT', created: new Date().toISOString(), productImports: 0, engineExecutions: 0, controlsRerun: 0, failures: [], inputs: [], tools: [], namespaces: [], views: [], children: [], oldResultRescored: false };
const verify = (label, operation) => {
  try { return operation(); }
  catch (error) { audit.failures.push({ label, code: error.code ?? null, message: String(error.message).slice(0, 8192) }); return null; }
};
const absent = identifier => {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
};
for (const entry of inputBinding.inputs) verify(`input:${entry.path}`, () => {
  assert.notEqual(path.basename(entry.path), 'AGENTS.md');
  boundFile(path.join(repository, entry.path), entry);
  audit.inputs.push({ path: entry.path, sha256: entry.sha256, unchanged: true });
});
for (const tool of preflight.tools) verify(`tool:${tool.role}`, () => {
  boundFile(tool.path, tool);
  audit.tools.push({ ...tool, unchanged: true });
});
verify('recipe', () => { audit.recipeSha256 = authenticatePacket(root); assert.equal(audit.recipeSha256, preflight.recipeSha256); });
const before = read(path.join(repository, preflight.inventory.path));
for (const [prefix, expected] of Object.entries(before.namespace)) verify(`namespace:${prefix}`, () => {
  const base = path.resolve(root, prefix);
  const found = [];
  const visit = subpath => {
    for (const name of fs.readdirSync(path.join(base, subpath)).sort()) {
      const member = path.join(subpath, name);
      const info = fs.lstatSync(path.join(base, member));
      assert.equal(info.isSymbolicLink(), false);
      found.push({ path: member, directory: info.isDirectory() });
      assert.ok(found.length <= expected.length);
      if (info.isDirectory() && member !== 'runs') visit(member);
    }
  };
  visit('');
  assert.deepEqual(found, expected);
  audit.namespaces.push({ prefix, entries: found.length, unchanged: true, excluded: 'runs descendants only' });
});
verify('grant-and-launch-bindings', () => {
  const grant = fs.readFileSync(path.join(directory, 'GRANT.json'));
  const authorization = fs.readFileSync(path.join(directory, 'AUTH.json'));
  assert.equal(hash(grant), preflight.grantSha256);
  assert.equal(hash(authorization), launch.authSha256);
  assert.equal(read(path.join(directory, 'AUTH.json')).grant.sha256, hash(grant));
  assert.equal(hash(fs.readFileSync(path.join(directory, 'launch.mjs'))), preflight.launchWrapperSha256);
  assert.equal(hash(fs.readFileSync(path.join(directory, 'ROOT-MESSAGE.txt'))), JSON.parse(grant).authoritySource.sha256);
  assert.deepEqual(launch.command, [...preflight.commandArgvTemplate.slice(0, -1), path.join(directory, 'AUTH.json')]);
});
const staged = verify('staged-binding', () => parseStage(fs.readFileSync(path.join(runRoot, 'STAGED.json')), result.stagedSha256));
if (staged) for (const view of Object.values(staged.views)) verify(`view:${view.name}`, () => {
  authenticateView(projection, view);
  const census = inspectTree(view.root, view.files);
  if (view.oldOrigin) assert.equal(fs.existsSync(view.oldOrigin), false);
  audit.views.push({ name: view.name, ...census, oldOriginAbsent: view.oldOrigin ? true : null, projectionUnchanged: true });
});
verify('original-comparator-closure', () => {
  const exclusions = projection.baseline.excluded;
  const files = projection.baseline.closure.files.filter(entry => !exclusions.some(omit => omit.path === entry.path));
  audit.baselineClosure = inspectTree(projection.baseline.closure.root, files, exclusions, null);
  audit.instructionHandling = 'Excluded instruction file metadata only; no instruction plaintext read or materialized';
});
audit.archives = [];
for (const [kind, archive] of [['target-pack', projection.target.pack], ['pinned-comparator-package', projection.baseline.archive]]) verify(kind, () => {
  boundFile(archive.physical, archive);
  audit.archives.push({ kind, bytes: archive.bytes, sha256: archive.sha256, unchanged: true });
});
for (const child of result.children) verify(`child:${child.ordinal}`, () => {
  const stem = `child-${String(child.ordinal).padStart(3, '0')}`;
  const configBytes = fs.readFileSync(path.join(runRoot, `${stem}.json`));
  const receiptBytes = fs.readFileSync(path.join(runRoot, `${stem}.receipt.json`));
  assert.equal(hash(configBytes), child.configSha);
  assert.equal(hash(receiptBytes), child.receiptSha);
  const config = JSON.parse(configBytes);
  const receipt = JSON.parse(receiptBytes);
  const claim = read(path.join(runRoot, `operation-${child.operationId}.claim`));
  assert.equal(claim.operation.id, child.operationId);
  assert.equal(claim.recipe, preflight.recipeSha256);
  assert.equal(receipt.pid, child.pid);
  assert.ok(receipt.reaped && absent(child.pid) && absent(-child.pid));
  const streams = {};
  for (const [channel, key, cap] of [['stdout', 'stdout', 65536], ['stderr', 'stderr', 65536], ['records', 'rawRecords', 262144]]) {
    const bytes = Buffer.from(receipt[key], 'base64');
    assert.equal(bytes.length, receipt.captureBytes[channel]);
    assert.ok(bytes.length <= cap);
    streams[channel] = { bytes: bytes.length, sha256: hash(bytes), complete: true };
  }
  assert.deepEqual(parseTransport(Buffer.from(receipt.rawRecords, 'base64')), receipt.records);
  const loads = receipt.records.filter(row => row.kind === 'nextLoad');
  for (const loaded of loads) {
    const bound = config.view.files.find(entry => entry.path === loaded.path);
    assert.ok(bound);
    assert.equal(loaded.sha256, bound.sha256);
    assert.equal(loaded.bytes, bound.bytes);
    assert.equal(loaded.origin, 'actual-nextLoad-source');
  }
  const report = receipt.records.at(-1).report;
  const entryEdges = report.loads.entryResolutions;
  const bareEdges = report.loads.consumerResolutions;
  assert.equal(entryEdges.length, 1);
  assert.equal(bareEdges.length, 1);
  assert.equal(entryEdges[0].accepted, true);
  assert.equal(bareEdges[0].accepted, true);
  assert.equal(report.resources.pending, 0);
  assert.equal(report.resources.descriptors, 0);
  assert.equal(report.postGuard, true);
  audit.children.push({ ordinal: child.ordinal, operationId: child.operationId, view: config.view.name, pid: child.pid, exit: receipt.exit, close: receipt.close, pidAndGroupAbsent: true, receiptSha256: hash(receiptBytes), streams, actualLoadObservations: loads.length, actualLoadPaths: new Set(loads.map(row => row.path)).size, consumerEvaluated: report.exportEvaluation, factoryCalled: report.exportFactoryCall, semanticExecCalls: report.semanticExecCalls, setupExecCalls: report.setupExecCalls, entryEdges, bareEdges, pending: report.resources.pending, descriptors: report.resources.descriptors, violations: report.resources.violations, postGuard: report.postGuard, late: report.late, safeQualification: result.probes.rows[child.ordinal - 1].pass === true });
});
verify('coordinator-closure-and-capture', () => {
  assert.ok(launch.reaped && absent(launch.pid) && absent(-launch.pid));
  const stdout = fs.readFileSync(path.join(directory, 'coordinator.stdout'));
  const stderr = fs.readFileSync(path.join(directory, 'coordinator.stderr'));
  assert.equal(hash(stdout), launch.stdoutSha256);
  assert.equal(hash(stderr), launch.stderrSha256);
  audit.coordinator = { pid: launch.pid, exit: launch.exit, close: launch.close, pidAndGroupAbsent: true, errors: launch.errors, stdoutObservedBytes: launch.captureBytes.stdout, stdoutRetainedBytes: stdout.length, stdoutUnretainedBytes: launch.captureBytes.stdout - stdout.length, stdoutComplete: launch.captureBytes.stdout === stdout.length, stderrObservedBytes: launch.captureBytes.stderr, stderrRetainedBytes: stderr.length, missingBytesReconstructed: false, rawResultRetainedSeparately: true };
});
audit.checkedInputs = audit.inputs.length;
audit.integrityAndClosureQualified = audit.failures.length === 0;
audit.admissionQualified = false;
audit.status = result.status;
audit.newRunOnly = { launched: result.children.length, planned: result.plannedOperations.length, probesQualified: result.probes.rows.filter(row => row.pass === true).length, controlsExecuted: result.controls?.rows.length ?? 0, c11Setups: result.setupCalls, semanticCalls: result.productCohortCalls, unlaunchedOperations: result.plannedOperations.filter(row => row.launch === null).map(row => row.id) };
save(path.join(directory, 'POST-AUDIT.json'), audit);
const captureNames = ['AUTHORIZATION.json', 'RESULT.json', 'STAGED.json', ...result.children.flatMap(child => { const stem = `child-${String(child.ordinal).padStart(3, '0')}`; return [`${stem}.json`, `${stem}.receipt.json`, `operation-${child.operationId}.claim`]; })];
const rawFiles = [...captureNames.map(name => path.join(runRoot, name)), ...['LAUNCH-INTENT.json', 'LAUNCHED.json', 'LAUNCH-RECEIPT.json', 'coordinator.stdout', 'coordinator.stderr'].map(name => path.join(directory, name)), path.join(root, `runs/authority-${preflight.grantSha256}.lock`)];
const members = rawFiles.map(filename => {
  const info = fs.lstatSync(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  const bytes = fs.readFileSync(filename);
  return { path: relative(filename), bytes: bytes.length, mode: info.mode & 0o7777, sha256: hash(bytes), base64: bytes.toString('base64') };
});
const serialized = Buffer.from(`${JSON.stringify({ kind: 'EXACT_RAW_CAPTURE_ARCHIVE_V1', instructionPlaintext: false, productTreesIncluded: false, members })}\n`);
assert.ok(serialized.length < 32 * 1024 * 1024);
const compressed = gzipSync(serialized, { level: 9 });
assert.deepEqual(gunzipSync(compressed), serialized);
for (const entry of JSON.parse(gunzipSync(compressed)).members) {
  const bytes = Buffer.from(entry.base64, 'base64');
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256);
}
const archivePath = path.join(directory, 'raw-evidence.json.gz');
fs.writeFileSync(archivePath, compressed, { flag: 'wx', mode: 0o644 });
const manifest = { schema: 'V6_ONE_ADMISSION_FAILURE_EVIDENCE', recipeCommit: preflight.recipeCommit, recipeSha256: preflight.recipeSha256, grantCommit: read(path.join(directory, 'AUTH.json')).grant.commit, grantSha256: preflight.grantSha256, authSha256: launch.authSha256, runId: result.runId, resultSha256: hash(fs.readFileSync(path.join(runRoot, 'RESULT.json'))), launchReceiptSha256: hash(fs.readFileSync(path.join(directory, 'LAUNCH-RECEIPT.json'))), postAuditSha256: hash(fs.readFileSync(path.join(directory, 'POST-AUDIT.json'))), archive: { path: relative(archivePath), bytes: compressed.length, sha256: hash(compressed), expandedBytes: serialized.length, members: members.map(({ base64, ...entry }) => entry), roundTripVerified: true }, qualifications: { admissionAccepted: false, previousCohortsUnchanged: true, missingCoordinatorStdoutNotReconstructed: true, projectionNotBuild: true, semanticCohortAuthorized: false } };
save(path.join(directory, 'EVIDENCE-MANIFEST.json'), manifest);
console.log(JSON.stringify({ status: result.status, auditQualified: audit.integrityAndClosureQualified, failures: audit.failures, counts: audit.newRunOnly, inputs: audit.checkedInputs, views: audit.views, closure: audit.baselineClosure, archiveBytes: compressed.length, archiveMembers: members.length, resultSha256: manifest.resultSha256, coordinator: audit.coordinator }));
if (audit.failures.length) process.exitCode = 1;
