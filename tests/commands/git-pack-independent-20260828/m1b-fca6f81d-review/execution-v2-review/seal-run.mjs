import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = '/private/tmp/git-m1b-fca-independent-20260828-1e1c790b5f2ff78c';
const destination = path.join(directory, 'actual-run');
const route = JSON.parse(await fs.readFile(path.join(directory, 'activation/ROOT-ROUTE.json')));
const end = BigInt(route.originHrtimeNs) + 7200000000000n;
let retained = 0;
function demand(condition, label) { if (!condition) throw new Error(label); }
function clock() { demand(process.hrtime.bigint() < end, 'ORIGINAL_REVIEW_DEADLINE'); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileHash(filename) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(filename)) { clock(); digest.update(bytes); }
  return digest.digest('hex');
}
async function inventory(directory, prefix = '', rows = []) {
  for (const name of (await fs.readdir(directory)).sort()) {
    clock();
    demand(rows.length < 20000, 'MEMBERSHIP_CAP');
    const filename = path.join(directory, name);
    const relative = prefix ? prefix + '/' + name : name;
    const before = await fs.lstat(filename);
    demand(!before.isSymbolicLink(), 'NO_SYMLINK');
    if (before.isDirectory()) {
      rows.push({ path: relative, kind: 'directory', mode: before.mode & 0o777 });
      await inventory(filename, relative, rows);
    } else {
      demand(before.isFile() && before.size <= 134217728, 'REGULAR_BOUNDED_FILE');
      const sha256 = await fileHash(filename);
      const after = await fs.lstat(filename);
      demand(before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.size === after.size && before.mtimeMs === after.mtimeMs, 'READ_STABILITY');
      rows.push({ path: relative, kind: 'file', mode: before.mode & 0o777, bytes: before.size, sha256 });
    }
  }
  return rows;
}
async function publish(name, body) {
  clock();
  retained += body.length;
  demand(retained <= 16777216, 'POSTRUN_CAPTURE_CEILING');
  const filename = path.join(destination, name);
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await fs.writeFile(filename, body, { flag: 'wx', mode: 0o600 });
  demand(hash(await fs.readFile(filename)) === hash(body), 'PUBLISHED_IDENTITY');
}
clock();
demand(route.outputRoot === root && await fs.realpath(root) === root, 'OWNED_ROOT');
const rootStat = await fs.lstat(root);
demand(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'ROOT_DIRECTORY');
const final = JSON.parse(await fs.readFile(path.join(root, 'outer/FINAL.json')));
demand(final.coordinator.closed === true && final.knownOutstanding.length === 0 && final.result.active === 0, 'KNOWN_RETIREMENT_BEFORE_ARCHIVE');
await fs.mkdir(destination, { mode: 0o700 });
const before = await inventory(root);
const total = before.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
demand(total + 16777216 <= 1073741824, 'WORKING_HEADROOM');
await publish('MATERIALIZED-BEFORE-CLEANUP.json', Buffer.from(JSON.stringify({ root, rootDevice: rootStat.dev, rootInode: rootStat.ino, files: before, totalBytes: total }, null, 2) + '\n'));
const selected = before.filter(row => row.kind === 'file' && (row.path.startsWith('raw/') || row.path.startsWith('outer/') || row.path.startsWith('control/') || row.path === 'candidate.tgz'));
for (const row of selected) {
  demand(row.bytes <= 8388608, 'CAPTURE_FILE_SIZE');
  const body = await fs.readFile(path.join(root, row.path));
  demand(body.length === row.bytes && hash(body) === row.sha256, 'RAW_SOURCE_IDENTITY');
  await publish(row.path, body);
}
const after = await inventory(root);
demand(JSON.stringify(before) === JSON.stringify(after), 'UNCHANGED_FULL_SOURCE_MEMBERSHIP');
const afterRoot = await fs.lstat(root);
demand(afterRoot.dev === rootStat.dev && afterRoot.ino === rootStat.ino, 'ROOT_OWNERSHIP_STABILITY');
const evidenceFiles = await inventory(destination);
await publish('EVIDENCE-MANIFEST.json', Buffer.from(JSON.stringify({ role: 'EXACT_RAW_COPY_NOT_REEXECUTION', files: evidenceFiles, selectedRawFiles: selected.length }, null, 2) + '\n'));
clock();
await fs.rm(root, { recursive: true });
const absent = await fs.lstat(root).then(() => false, error => error.code === 'ENOENT');
demand(absent, 'OWNED_ROOT_CLEANUP');
clock();
const elapsedMs = Number(process.hrtime.bigint() - BigInt(route.originHrtimeNs)) / 1000000;
await publish('CLEANUP.json', Buffer.from(JSON.stringify({ sourceRoot: root, knownRetirementBeforeCopy: true, copiedRawFiles: selected.length, originalFileBytes: total, originalFiles: before.filter(row => row.kind === 'file').length, originalEntries: before.length, beforeAfterFullIdentity: true, removedRootAbsent: absent, retainedEvidenceBytesBeforeCleanupReceipt: retained, elapsedMsFromOriginalOrigin: elapsedMs, deadlineMs: 7200000, addedArchiveCleanupProcesses: 1, candidateExecutions: 0, noRetry: true }, null, 2) + '\n'));
