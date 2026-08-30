import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync, deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { HERE, REPO, sha, objectHash, need, now, inventory, put } from './common.mjs';
import { small, set } from './fixtures.mjs';

const started = now();
const binding = JSON.parse(await fs.readFile(path.join(HERE, 'BINDING.json')));
const sealBytes = await fs.readFile(path.join(HERE, 'PRESEAL.json'));
const seal = JSON.parse(sealBytes);
const rawRun = await fs.readFile(path.join(HERE, 'RESULT.json'));
const run = JSON.parse(rawRun);
need(run.status === 'FATAL_STOP' && run.children.length === 3 && run.children.every(row => row.closed), 'exact stopped cohort and known direct child closure');
need(now() < binding.measuredDeadlineMs, 'same aggregate deadline includes evidence/cleanup');
const commit = execFileSync('/usr/bin/git', ['cat-file', 'commit', run.preseal], { cwd: REPO, timeout: 5000, maxBuffer: 65536 });
need(objectHash('commit', commit) === run.preseal, 'actual stored preseal commit');
const committedSeal = execFileSync('/usr/bin/git', ['show', `${run.preseal}:tests/commands/git-independent-20260828/m1a-review-v5/PRESEAL.json`], { cwd: REPO, timeout: 5000, maxBuffer: 1024 * 1024 });
assert.deepEqual(committedSeal, sealBytes, 'preseal unchanged after execution');
for (const row of seal.files) need(sha(await fs.readFile(path.join(HERE, row.path))) === row.sha256, `sealed input post hash ${row.path}`);
for (const tool of binding.tools) assert.deepEqual(await inventory(tool.root), tool.rows, 'tool post complete namespace/file hashes');
need(sha(await fs.readFile(binding.node.path)) === binding.node.sha256, 'Node post hash');
need(sha(await fs.readFile(path.join(REPO, 'package-lock.json'))) === binding.lock.sha256, 'lock post hash');
need(sha(await fs.readFile(binding.records.path)) === binding.records.sha256, 'neutral source data post hash');
const sourceRoot = path.join(HERE, 'working-v1/source');
const source = await inventory(sourceRoot);
const sourceFiles = source.filter(row => !row.directory);
const expected = new Map([...binding.selected.map(row => [row.path, { ...row, mode: typeof row.mode === 'number' ? row.mode : Number.parseInt(row.mode, 8) & 0o777 }]), ...binding.members.filter(row => row.path.startsWith('dist/')).map(row => [row.path, row])]);
need(sourceFiles.length === expected.size, 'actual snapshot contains no extra files');
for (const row of sourceFiles) {
  const expectedRow = expected.get(row.path); need(expectedRow && row.bytes === expectedRow.bytes && row.mode === expectedRow.mode && row.sha256 === expectedRow.sha256, `source/emitted post ${row.path}`);
}
const expectedDirectories = new Set([...expected.keys()].flatMap(name => { const parts = name.split('/'); return parts.slice(0, -1).map((_, position) => parts.slice(0, position + 1).join('/')); }));
assert.deepEqual(source.filter(row => row.directory).map(row => row.path).sort(), [...expectedDirectories].sort(), 'post snapshot directory additions also detected');
const captureRoot = path.join(HERE, 'capture-v1');
const rows = [];
for (const plan of seal.cases) {
  const filename = path.join(captureRoot, 'source', plan.id + '.json');
  try { const bytes = await fs.readFile(filename); const data = JSON.parse(bytes); rows.push({ id: data.id, status: data.status, safety: data.safety, observations: data.observations.length, plannedInvocations: plan.plannedInvocations, bytes: bytes.length, sha256: sha(bytes), nativeZlib: data.nativeZlib }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const failure = JSON.parse(await fs.readFile(path.join(captureRoot, 'source/H09.json')));
const fixture = small();
const member = `.git/objects/${fixture.items[0].oid.slice(0, 2)}/${fixture.items[0].oid.slice(2)}`;
set(fixture.files, member, deflateSync(Buffer.from('blob 8388609\0')));
const fixtureFiles = [...fixture.files].map(([name, value]) => ({ path: '/repo/' + name, mode: value.mode, bytes: value.data.length, sha256: sha(value.data), base64: value.data.toString('base64') }));
for (const file of fixtureFiles) {
  const observed = failure.observations[0].before.find(row => row.path === file.path);
  need(observed && observed.bytes === file.bytes && observed.sha256 === file.sha256 && observed.mode === file.mode, 'reconstructed failure bytes match actual pre-effect snapshot');
}
await put(path.join(HERE, 'H09-FIXTURE.json'), JSON.stringify({ classification: 'DATA_ONLY_POSTRUN_RECONSTRUCTION_NOT_REEXECUTION', inputs: fixtureFiles, command: failure.observations[0].args, expected: { code: 128, stdoutBase64: '' }, actual: { code: failure.observations[0].exitCode, stdoutBase64: failure.observations[0].stdoutBase64, stderrBase64: failure.observations[0].stderrBase64 }, actualSnapshotSha256: sha(JSON.stringify(failure.observations[0].before)) }, null, 2) + '\n');
async function archive(root, filename) {
  const before = await inventory(root), entries = [];
  for (const row of before) entries.push(row.directory ? row : { ...row, base64: (await fs.readFile(path.join(root, row.path))).toString('base64') });
  const bytes = Buffer.from(JSON.stringify({ classification: 'IMMUTABLE_CAPTURE_DATA_NOT_CANONICAL_TYPESCRIPT_INPUTS', entries }) + '\n');
  need(bytes.length < 64 * 1024 * 1024, 'archive decoded bound');
  const compressed = gzipSync(bytes), encoded = Buffer.from(compressed.toString('base64') + '\n');
  await put(path.join(HERE, filename), encoded);
  assert.deepEqual(gunzipSync(Buffer.from((await fs.readFile(path.join(HERE, filename))).toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }), bytes, 'archive roundtrip bytes');
  assert.deepEqual(await inventory(root), before, 'archive inputs unchanged including additions');
  return { file: filename, encodedSha256: sha(encoded), gzipSha256: sha(compressed), decodedSha256: sha(bytes), encodedBytes: encoded.length, decodedBytes: bytes.length, files: before.filter(row => !row.directory).length, contentBytes: before.reduce((total, row) => total + (row.bytes ?? 0), 0), inventorySha256: sha(JSON.stringify(before)), directories: before.filter(row => row.directory).length };
}
const capture = await archive(captureRoot, 'RAW.json.gz.base64');
const working = await archive(path.join(HERE, 'working-v1'), 'WORKING.json.gz.base64');
const loads = (await fs.readFile(path.join(captureRoot, 'source/loads.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const productLoads = loads.filter(row => row.file.startsWith(sourceRoot + '/src/'));
const closeSource = process.binding('natives')['internal/streams/destroy'];
const start = closeSource.indexOf('function _destroy('), end = closeSource.indexOf('function emitErrorCloseNT(', start);
const nodeExcerpt = closeSource.slice(start, end + 450);
await put(path.join(HERE, 'NODE-CLOSE-STATIC.json'), JSON.stringify({ classification: 'BOUND_NODE_BUNDLED_JS_STATIC_TEXT_NOT_NATIVE_HANDLE_PROOF', nodeSha256: binding.node.sha256, module: 'internal/streams/destroy', moduleSha256: sha(closeSource), excerpt: nodeExcerpt }, null, 2) + '\n');
const tree = await inventory(HERE);
const bytesBeforeCleanup = tree.reduce((total, row) => total + (row.bytes ?? 0), 0);
need(bytesBeforeCleanup < 512 * 1024 * 1024 && capture.contentBytes + capture.encodedBytes < 128 * 1024 * 1024, 'actual working/capture including archives under limits');
const audit = { schema: 'different-m1a-v5-poststop-data-audit', status: 'STOPPED_NO_RETRY', source: binding.source, evidence: binding.evidence, base: binding.base, presealCommit: run.preseal, rawResultSha256: sha(rawRun),
  checks: { storedPresealAuthenticated: true, sealedInputHashesUnchanged: true, sourceSnapshotExact: true, actualEmittedExact: true, newFilesAndDirectoriesChecked: true, toolsAndLockUnchanged: true, decodedArchivesRoundtrip: true },
  build: run.build, package: { sha256: binding.packageSha256, authoredPackageFiles: 898, authenticatedBaselineUnchanged: 858, actualManualStaging: false, actualMove: false, ownPackExecuted: false },
  source: { plannedRows: 71, capturedRows: rows.length, assertionPassRows: rows.filter(row => row.status === 'PASS').length, assertionFailRows: rows.filter(row => row.status === 'FAIL').length, endOfRowCloseEventGuardClear: rows.filter(row => !row.safety).length, safetyStopRows: rows.filter(row => row.safety).map(row => row.id), unexecutedRows: seal.cases.filter(plan => !rows.some(row => row.id === plan.id)).map(row => row.id), plannedInvocations: 180, actualRecordedInvocations: rows.reduce((total, row) => total + row.observations, 0), uniqueAuthenticatedProductModules: new Set(productLoads.map(row => row.file)).size, actualLoadedEntry: productLoads.find(row => row.file.endsWith('/commands/git/index.ts')), traceSha256: sha(await fs.readFile(path.join(captureRoot, 'source/loads.jsonl'))), rows },
  unexecuted: { compiledRows: 71, manualStagedRows: 71, physicallyMovedRows: 71, strictTypeChildren: 5, loadedMutantChildren: 3, bindingRefusalChildren: 3, M1B: 12, nativeGitOracle: 6 },
  lifecycle: { actualChildren: run.children.map(row => ({ label: row.label, pid: row.pid, born: row.born, pgid: row.pgid, code: row.code, signal: row.signal, closed: row.closed, signals: row.signals })), plannedChildren: 17, actualChildrenCount: 3, unexecutedChildren: 14, nativeZlibAtStop: failure.nativeZlib, firstMaxUnobservedCloseEventsAboveOne: rows.find(row => row.nativeZlib.maxConcurrent > 1)?.id,
    qualification: '289 createInflate events and288 close events observed at H09 settlement; stream.closed/native handle state was not recorded. Event-notification lateness is not proof of native work leakage. Peak2 unobserved-close streams first A29; preseal assumed1 but did not gate this maximum. Direct source process was SIGTERM-closed; no OS descendant census claim.' },
  archives: { capture, working }, failureFixture: { file: 'H09-FIXTURE.json', sha256: sha(await fs.readFile(path.join(HERE, 'H09-FIXTURE.json'))), replayed: false },
  storage: { bytesBeforeCleanupIncludingArchives: bytesBeforeCleanup, reusedReadOnlyDependencyBytes: binding.tools.flatMap(tool => tool.rows).reduce((total, row) => total + (row.bytes ?? 0), 0), captureContentBytes: capture.contentBytes },
  measuredPreparationRunAuditMs: now() - binding.startMonotonicMs, priorUnmeasuredInspectionReservedMs: binding.priorInspectionReserveMs, auditElapsedMs: now() - started,
  cleanup: { removesOnly: ['working-v1', 'capture-v1'], preRemovalArchivedAndRoundtripped: true, preventsCapturedProductionTsFromEnteringCanonicalDiscovery: true } };
await put(path.join(HERE, 'AUDIT.json'), JSON.stringify(audit, null, 2) + '\n');
for (const name of ['working-v1', 'capture-v1']) {
  const root = path.join(HERE, name); need(root.startsWith(HERE + '/') && (await fs.lstat(root)).isDirectory(), 'owned staging cleanup only');
  await fs.rm(root, { recursive: true, force: false });
  await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
}
await put(path.join(HERE, 'CLEANUP.json'), JSON.stringify({ status: 'OWNED_STAGING_REMOVED_AFTER_VERIFIED_ARCHIVE', removed: ['working-v1', 'capture-v1'], allThreeDirectChildrenPreviouslyClosed: true, monotonicMs: now(), measuredPreparationRunAuditCleanupMs: now() - binding.startMonotonicMs, priorInspectionReserveMs: binding.priorInspectionReserveMs, aggregateAccountedMs: now() - binding.startMonotonicMs + binding.priorInspectionReserveMs, limitMs: 6600000 }, null, 2) + '\n');
console.log(JSON.stringify({ status: audit.status, sourceRows: audit.source.capturedRows, actualInvocations: audit.source.actualRecordedInvocations, uniqueProductModules: audit.source.uniqueAuthenticatedProductModules, storage: audit.storage, cleanup: 'complete', audit: path.join(HERE, 'AUDIT.json') }));
