import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sealBytes = fs.readFileSync(path.join(root, 'SEAL.json'));
assert.equal(digest(sealBytes), '2b1dfbf24d2251a1b2edf4617a97d737c21bfd99cfcb9115c1b2423eaacee3b4');
assert.equal(fs.readFileSync(path.join(root, 'runs/ATTEMPT.lock'), 'utf8'), `${digest(sealBytes)}\n`);
const seal = JSON.parse(sealBytes);
for (const entry of [...seal.files, seal.node]) {
  const filename = path.resolve(root, entry.path);
  const info = fs.lstatSync(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(info.size, entry.bytes); assert.equal(info.mode & 0o7777, entry.mode);
  assert.equal(digest(fs.readFileSync(filename)), entry.sha256);
}
const read = filename => JSON.parse(fs.readFileSync(path.join(root, filename)));
const result = read('runs/synthetic-v1-01/RESULT.json');
const launch = read('runs/LAUNCH.json');
const absent = identifier => { try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
const children = [...result.ledger, { pid: launch.pid, exit: launch.exit, close: launch.close, reaped: launch.reaped }];
for (const child of children) assert.ok(child.pid && child.exit && child.close && child.reaped && absent(child.pid) && absent(-child.pid));
const files = [];
let totalBytes = 0;
const visit = directory => {
  for (const name of fs.readdirSync(directory).sort()) {
    assert.notEqual(name.toLowerCase(), 'agents.md');
    const filename = path.join(directory, name), info = fs.lstatSync(filename);
    assert.equal(info.isSymbolicLink(), false);
    if (info.isDirectory()) { visit(filename); continue; }
    assert.ok(info.isFile() && files.length < 200 && info.size <= 262145);
    const bytes = fs.readFileSync(filename); totalBytes += bytes.length;
    assert.ok(totalBytes <= 268435456);
    const relative = path.relative(root, filename);
    const negativeInput = relative === 'runs/synthetic-v1-01/R10/oversize.json';
    if (!negativeInput) assert.ok(bytes.length <= 262144);
    files.push({ path: relative, bytes: bytes.length, mode: info.mode & 0o7777, sha256: digest(bytes), role: negativeInput ? 'INTENTIONAL_OVERSIZE_INPUT_NOT_QUALIFIED_RECORD' : 'RAW_SYNTHETIC_ARTIFACT', base64: bytes.toString('base64') });
  }
};
visit(path.join(root, 'runs'));
const expanded = Buffer.from(`${JSON.stringify({ kind: 'RAW_SYNTHETIC_REPORT_REPAIR_ARCHIVE', members: files })}\n`);
const compressed = gzipSync(expanded, { level: 9 });
assert.ok(compressed.length <= 262144);
assert.deepEqual(gunzipSync(compressed), expanded);
for (const member of JSON.parse(gunzipSync(compressed)).members) { const bytes = Buffer.from(member.base64, 'base64'); assert.equal(bytes.length, member.bytes); assert.equal(digest(bytes), member.sha256); }
fs.writeFileSync(path.join(root, 'raw-synthetic-evidence.json.gz'), compressed, { flag: 'wx' });
const summary = { schema: 'REPORT_REPAIR_ACTUAL_SYNTHETIC_EVIDENCE', candidateCommit: '4d5d28b62c3253a613fd19cde11d7f2df0f98b1d', diagnosisCommit: '096c204c38fd7f1b6c096b9cb09e0ea877737fec', sealSha256: digest(sealBytes), attempts: 1, pass: result.rows.filter(row => row.status === 'PASS').length, fail: result.rows.filter(row => row.status === 'FAIL').length, unrun: result.rows.filter(row => row.status.startsWith('UNRUN')).length, dataOverlayApplications: 3, engineExecutions: 0, builtinPolicyImplemented: false, actualAdmissionAuthorized: false, stubChildren: result.ledger.map(entry => ({ kind: entry.kind, pid: entry.pid, exit: entry.exit, close: entry.close, reaped: entry.reaped, persisted: entry.persisted, errors: entry.errors })), controlsDriver: { pid: launch.pid, exit: launch.exit, close: launch.close, reaped: launch.reaped, stdoutBytes: launch.stdoutBytes, stderrBytes: launch.stderrBytes, beforeBindings: launch.beforeBindings, afterBindings: launch.afterBindings }, postBindings: seal.files.length, nodeUnchanged: true, allFivePidGroupsAbsent: true, rawResultSha256: digest(fs.readFileSync(path.join(root, 'runs/synthetic-v1-01/RESULT.json'))), launchSha256: digest(fs.readFileSync(path.join(root, 'runs/LAUNCH.json'))), archive: { path: 'raw-synthetic-evidence.json.gz', bytes: compressed.length, sha256: digest(compressed), expandedBytes: expanded.length, memberCount: files.length, rawBytes: totalBytes, members: files.map(({ base64, ...entry }) => entry) }, originalV6: { resultBytes: 531954, resultExceedsRecordCap: true, stdoutObserved: 359581, stdoutRetained: 65536, stdoutIrrecoverable: 294045, reconstructed: false, rescore: false }, remaining: ['No builtin capability adjudication or implementation', 'No complete successor recipe, authorization interface or real engine composition', 'Out-of-store evidence accounting and pre-tail failure boundaries require successor full-recipe review', 'No semantic cohort authority'] };
const summaryBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`);
assert.ok(summaryBytes.length <= 262144);
fs.writeFileSync(path.join(root, 'EVIDENCE.json'), summaryBytes, { flag: 'wx' });
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail, unrun: summary.unrun, childGroupsAbsent: 5, archiveBytes: compressed.length, archiveSha256: summary.archive.sha256, evidenceSha256: digest(summaryBytes), rawMembers: files.length, rawBytes: totalBytes }));
