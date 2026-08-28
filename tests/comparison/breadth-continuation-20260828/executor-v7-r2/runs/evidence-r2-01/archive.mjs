import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGzip, gunzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [], parts = [];
let rawBytes = 0, witnessedLoads = 0, loadReceipts = 0;
function visit(relative) {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    if (/^AGENTS\.md$/i.test(name)) throw new Error('INSTRUCTION_INPUT');
    const member = path.join(relative, name), info = fs.lstatSync(path.join(root, member));
    if (info.isDirectory()) { visit(member); continue; }
    if (!info.isFile() || info.size > 262144 || files.length >= 4096) throw new Error('ARCHIVE_INPUT_RECORD');
    const bytes = fs.readFileSync(path.join(root, member));
    rawBytes += bytes.length;
    if (rawBytes > 64 * 1024 * 1024) throw new Error('ARCHIVE_INPUT_CAP');
    if (/^loads-[0-9]+\.json$/.test(name)) {
      const receipt = JSON.parse(bytes);
      if (!Array.isArray(receipt.loaded) || receipt.loaded.some(row => row.actualNextLoad !== true)) throw new Error('LOAD_WITNESS');
      witnessedLoads += receipt.loaded.length;
      loadReceipts++;
    }
    files.push({ path: member, bytes: bytes.length, mode: info.mode & 0o7777, sha256: hash(bytes) });
  }
}
visit('runs/affected-r2-01');
visit('runs/launch-r2-01/evidence');
visit('runs/launch-r2-01/driver');
async function* lines() {
  for (const entry of files) {
    const bytes = fs.readFileSync(path.join(root, entry.path));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('ARCHIVE_INPUT_DRIFT');
    yield `${JSON.stringify({ ...entry, base64: bytes.toString('base64') })}\n`;
  }
}
let pending = Buffer.alloc(0), compressedBytes = 0;
function save(bytes) {
  const name = `raw-${String(parts.length).padStart(4, '0')}.gzpart`;
  fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx', mode: 0o644 });
  parts.push({ path: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes) });
}
await pipeline(Readable.from(lines()), createGzip({ level: 9 }), new Writable({ write(bytes, encoding, done) {
  try {
    compressedBytes += bytes.length;
    if (compressedBytes > 8 * 1024 * 1024) throw new Error('ARCHIVE_OUTPUT_CAP');
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 262144) {
      save(pending.subarray(0, 262144));
      pending = Buffer.from(pending.subarray(262144));
    }
    done();
  } catch (error) { done(error); }
} }));
if (pending.length) save(pending);
const compressed = Buffer.concat(parts.map(entry => {
  const bytes = fs.readFileSync(path.join(directory, entry.path));
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('ARCHIVE_PART_DRIFT');
  return bytes;
}));
const decoded = gunzipSync(compressed, { maxOutputLength: 96 * 1024 * 1024 }).toString('utf8').trimEnd().split('\n');
if (decoded.length !== files.length) throw new Error('ARCHIVE_ROUNDTRIP_COUNT');
for (let index = 0; index < files.length; index++) {
  const { base64, ...entry } = JSON.parse(decoded[index]), expected = files[index];
  const bytes = Buffer.from(base64, 'base64'), current = fs.lstatSync(path.join(root, expected.path));
  if (JSON.stringify(entry) !== JSON.stringify(expected) || bytes.length !== expected.bytes || hash(bytes) !== expected.sha256 || !current.isFile() || (current.mode & 0o7777) !== expected.mode || hash(fs.readFileSync(path.join(root, expected.path))) !== expected.sha256) throw new Error('ARCHIVE_ROUNDTRIP');
}
const result = JSON.parse(fs.readFileSync(path.join(root, 'runs/affected-r2-01/receipts/RESULT.json')));
const manifest = {
  schema: 'V7_R2_COMPACT_RAW_EVIDENCE', candidate: '5110550da057398fffd1fb77bf538121c67c731f',
  launcher: '32581a276c50d73aab987880518ce04b77f5c631',
  recipeSha256: 'b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c',
  pass: result.pass, fail: result.fail, unrun: result.unrun, unsafe: result.unsafe,
  rawBytes, compressedBytes, maxRawRecordBytes: Math.max(...files.map(entry => entry.bytes)),
  gzipSha256: hash(compressed), archiveSourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  witnessedLoads, loadReceipts, roundTrip: 'ALL_RAW_BYTES_MODES_HASHES_VERIFIED', parts, files,
  qualification: 'Data-only archival after one completed 15-family synthetic run. No test replay, instruction plaintext, symlinks, real authority, engine imports, staging, C11, admission or semantics. Bootstrap and builtins are pre/post bound, not self-observed nextLoad. Full248+8MiB remains STATIC_ONLY; old cohorts and lost bytes unchanged.'
};
const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
if (bytes.length > 262144) throw new Error('MANIFEST_CAP');
fs.writeFileSync(path.join(directory, 'MANIFEST.json'), bytes, { flag: 'wx', mode: 0o644 });
process.stdout.write(`${JSON.stringify({ files: files.length, rawBytes, compressedBytes, maxRawRecordBytes: manifest.maxRawRecordBytes, parts: parts.length, witnessedLoads, loadReceipts, manifestSha256: hash(bytes) })}\n`);
