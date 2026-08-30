import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGzip, gunzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createStore } from '../../records.mjs';
import { createEvidenceBudget, writeReserved } from '../../evidence.mjs';
import { authenticatePacket } from '../../authorization.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const recipe = authenticatePacket(root), files = [], parts = [];
let rawBytes = 0;
function visit(relative) {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    if (name.toUpperCase() === 'AGENTS.MD') throw new Error('NO_INSTRUCTION_ARCHIVE');
    const member = path.join(relative, name), info = fs.lstatSync(path.join(root, member));
    if (info.isSymbolicLink()) throw new Error('NO_SYMLINK_ARCHIVE');
    if (info.isDirectory()) { visit(member); continue; }
    if (!info.isFile() || info.size > 262144 || files.length >= 4096) throw new Error('RAW_RECORD_BOUND');
    const bytes = fs.readFileSync(path.join(root, member)); rawBytes += bytes.length;
    if (rawBytes > 67108864) throw new Error('RAW_TOTAL_BOUND');
    files.push({ path: member, bytes: bytes.length, mode: info.mode & 0o7777, sha256: hash(bytes) });
  }
}
for (const relative of ['runs/ordering-stubs-01', 'runs/ordering-stubs-v2-01', 'runs/ordering-launch-01/evidence', 'runs/control-preparation-v2']) visit(relative);
const budget = createEvidenceBudget(directory, { limit: 8388608 }), store = createStore(directory, { budget });
const script = fileURLToPath(import.meta.url), scriptBytes = fs.readFileSync(script);
budget.reserve(script, scriptBytes.length, fs.statSync(script).mode & 0o7777, hash(scriptBytes), 'archive-source'); budget.finish(script);
async function* lines() {
  for (const entry of files) {
    const bytes = fs.readFileSync(path.join(root, entry.path));
    if (hash(bytes) !== entry.sha256) throw new Error('RAW_CHANGED');
    yield `${JSON.stringify({ ...entry, base64: bytes.toString('base64') })}\n`;
  }
}
let pending = Buffer.alloc(0), compressedBytes = 0;
function save(bytes) {
  const name = `raw-${String(parts.length).padStart(4, '0')}.gzpart`, filename = path.join(directory, name);
  const permit = budget.external(filename, bytes, 0o644, 'compressed-evidence'); writeReserved(permit, bytes); budget.finish(filename);
  parts.push({ path: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes) });
}
await pipeline(Readable.from(lines()), createGzip({ level: 9 }), new Writable({ write(bytes, encoding, done) {
  try {
    compressedBytes += bytes.length;
    if (compressedBytes > 6 * 1024 * 1024) throw new Error('COMPRESSED_BOUND');
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 262144) { save(pending.subarray(0, 262144)); pending = Buffer.from(pending.subarray(262144)); }
    done();
  } catch (error) { done(error); }
} }));
if (pending.length) save(pending);
const compressed = Buffer.concat(parts.map(entry => { const bytes = fs.readFileSync(path.join(directory, entry.path)); if (hash(bytes) !== entry.sha256) throw new Error('PART_HASH'); return bytes; }));
const restored = gunzipSync(compressed, { maxOutputLength: 96 * 1024 * 1024 }).toString('utf8').trimEnd().split('\n');
if (restored.length !== files.length) throw new Error('ROUNDTRIP_COUNT');
for (let index = 0; index < files.length; index++) {
  const { base64, ...entry } = JSON.parse(restored[index]), expected = files[index], bytes = Buffer.from(base64, 'base64');
  if (JSON.stringify(entry) !== JSON.stringify(expected) || bytes.length !== entry.bytes || hash(bytes) !== entry.sha256 || hash(fs.readFileSync(path.join(root, entry.path))) !== entry.sha256 || (fs.statSync(path.join(root, entry.path)).mode & 0o7777) !== entry.mode) throw new Error('ROUNDTRIP_BYTES_MODES');
}
const result = JSON.parse(fs.readFileSync(path.join(root, 'runs/ordering-stubs-v2-01/receipts/RESULT.json')));
const launcher = JSON.parse(fs.readFileSync(path.join(root, 'runs/ordering-launch-01/evidence/OUTCOME.json')));
const absence = [...result.workers.map(entry => ({ role: 'worker', pid: entry.pid, group: entry.group, reaped: entry.reaped })), ...result.metadataStubChildren.map(entry => ({ role: 'metadata-stub-NOT-Git', pid: entry.pid, group: entry.group, reaped: entry.reaped })), ...launcher.runner.map(entry => ({ role: 'test-runner', pid: entry.pid, group: entry.group, reaped: entry.reaped }))];
for (const entry of absence) {
  entry.absence = {};
  for (const [name, identifier] of [['pid', entry.pid], ['group', entry.group]]) { try { process.kill(identifier, 0); entry.absence[name] = 'PRESENT_OR_REUSED'; } catch (error) { entry.absence[name] = error.code === 'ESRCH' ? 'ABSENT' : `UNKNOWN_${error.code}`; } }
}
const manifest = { schema: 'R3_WHOLE_WORKER_STUB_COMPACT_EVIDENCE', recipeSha256: recipe, files, rawBytes, compressedBytes, maxRawRecordBytes: Math.max(...files.map(entry => entry.bytes)), gzipSha256: hash(compressed), parts, pass: result.pass, fail: result.fail, unrun: result.unrun, unsafe: result.unsafe, workers: result.workers.length, metadataStubChildren: result.metadataStubChildren.length, runner: 1, actualNextLoadWitnesses: result.rows.reduce((sum, entry) => sum + entry.observed.sourceLoadWitnesses, 0), guardedHarmlessStubLoads: result.rows.reduce((sum, entry) => sum + entry.observed.guardedStubLoads, 0), processes: absence, roundTrip: 'ALL_RAW_BYTES_MODES_HASHES_VERIFIED', originalPreparationFailurePreserved: true, realEngines: 0, realGitAuthority: 0, actualAdmission: 0, oldResultsRescored: false, source: 'Data-only archive of old partial preparation and one actual8-case stub invocation; production guard and authority validation real, metadata provider fixture-only; no source reconstruction of lost history.' };
const reference = store.save('MANIFEST.json', manifest);
budget.audit();
if (authenticatePacket(root) !== recipe) throw new Error('FINAL_RECIPE_DRIFT');
process.stdout.write(`${JSON.stringify({ files: files.length, rawBytes, compressedBytes, parts: parts.length, reference, pass: result.pass, actualNextLoadWitnesses: manifest.actualNextLoadWitnesses, guardedHarmlessStubLoads: manifest.guardedHarmlessStubLoads, all25RecordedProcessesAbsent: absence.length === 25 && absence.every(entry => entry.reaped && Object.values(entry.absence).every(value => value === 'ABSENT')) })}\n`);
