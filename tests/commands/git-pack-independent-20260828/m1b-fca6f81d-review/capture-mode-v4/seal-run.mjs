import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const routeBytes = await fs.readFile(path.join(directory, 'activation/ROOT-ROUTE.json'));
const routeIdentity = JSON.parse(await fs.readFile(path.join(directory, 'activation/ROUTE-IDENTITY.json')));
const route = JSON.parse(routeBytes);
const root = route.outputRoot;
const destination = path.join(directory, 'actual-run');
const end = BigInt(route.originHrtimeNs) + 7200000000000n;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let metadataBytes = 0;
function demand(condition, label) { if (!condition) throw new Error(label); }
function clock() { demand(process.hrtime.bigint() < end, 'FRESH_REVIEW_DEADLINE'); }
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
async function publish(name, value) {
  clock();
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  demand(metadataBytes + bytes.length <= 8388608, 'FINALIZATION_METADATA_CAP');
  metadataBytes += bytes.length;
  await fs.writeFile(path.join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
  demand(hash(await fs.readFile(path.join(destination, name))) === hash(bytes), 'PUBLISHED_IDENTITY');
}
clock();
demand(hash(routeBytes) === routeIdentity.sha256 && route.outputRoot === routeIdentity.outputRoot && route.originHrtimeNs === routeIdentity.originHrtimeNs, 'EXACT_ACTIVATION_ROUTE');
demand(/^\/private\/tmp\/git-m1b-fca-independent-20260828-mode4-[a-f0-9]{16}$/.test(root) && await fs.realpath(root) === root, 'EXACT_OWNED_ROOT');
const rootStat = await fs.lstat(root);
demand(rootStat.isDirectory() && !rootStat.isSymbolicLink() && rootStat.dev === (await fs.stat(directory)).dev, 'SAME_DEVICE_OWNED_ROOT');
const final = JSON.parse(await fs.readFile(path.join(root, 'outer/FINAL.json')));
demand(final.coordinator.closed === true && final.knownOutstanding.length === 0 && final.result.active === 0, 'KNOWN_RETIREMENT_BEFORE_ARCHIVE');
demand(final.result.captureCharged <= 255852544, 'RUNTIME_CAPTURE_CAP');
await fs.mkdir(destination, { mode: 0o700 });
const before = await inventory(root);
const total = before.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
demand(total + 16777216 <= 1073741824, 'COMBINED_WORKING_HEADROOM');
await publish('MATERIALIZED-BEFORE-CLEANUP.json', { root, rootDevice: rootStat.dev, rootInode: rootStat.ino, files: before, totalBytes: total });
const selected = before.filter(row => row.kind === 'file' && (row.path.startsWith('raw/') || row.path.startsWith('outer/') || row.path.startsWith('control/') || row.path === 'candidate.tgz'));
for (const row of selected) {
  clock();
  const source = path.join(root, row.path);
  const target = path.join(destination, row.path);
  demand(await fileHash(source) === row.sha256, 'RAW_SOURCE_BEFORE_TRANSFER');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.rename(source, target);
  const stat = await fs.lstat(target);
  demand(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === row.mode && stat.size === row.bytes && await fileHash(target) === row.sha256, 'RAW_TRANSFER_IDENTITY');
}
const selectedNames = new Set(selected.map(row => row.path));
const after = await inventory(root);
demand(JSON.stringify(before.filter(row => !selectedNames.has(row.path))) === JSON.stringify(after), 'ONLY_DECLARED_RAW_MOVED');
const afterRoot = await fs.lstat(root);
demand(afterRoot.dev === rootStat.dev && afterRoot.ino === rootStat.ino, 'ROOT_OWNERSHIP_STABILITY');
const evidence = await inventory(destination);
for (const row of selected) demand(JSON.stringify(evidence.find(entry => entry.path === row.path)) === JSON.stringify(row), 'COMPLETE_RETAINED_RAW_IDENTITY');
await publish('EVIDENCE-MANIFEST.json', { role: 'EXACT_SAME_DEVICE_RAW_MOVE_NO_REEXECUTION', files: evidence, selectedRawFiles: selected.length, transferredBytes: selected.reduce((sum, row) => sum + row.bytes, 0), rawCaptureNotDuplicated: true });
clock();
await fs.rm(root, { recursive: true });
const absent = await fs.lstat(root).then(() => false, error => error.code === 'ENOENT');
demand(absent, 'OWNED_ROOT_CLEANUP');
await publish('CLEANUP.json', { sourceRoot: root, knownRetirementBeforeTransfer: true, transferredRawFiles: selected.length, originalFileBytes: total, originalFiles: before.filter(row => row.kind === 'file').length, originalEntries: before.length, unchangedRemainingFullMembership: true, removedRootAbsent: absent, metadataBytesBeforeCleanupReceipt: metadataBytes, elapsedMsFromFreshOrigin: Number(process.hrtime.bigint() - BigInt(route.originHrtimeNs)) / 1000000, deadlineMs: 7200000, additionalCleanupProcesses: 1, targetExecutions: 0, noRetry: true });
