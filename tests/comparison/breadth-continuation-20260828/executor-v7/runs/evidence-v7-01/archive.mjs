import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [], lines = [];
let rawBytes = 0;
function visit(relative) {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const member = path.join(relative, name), info = fs.lstatSync(path.join(root, member));
    if (files.length >= 4096) throw new Error('ARCHIVE_ENTRY_CAP');
    if (info.isDirectory()) { visit(member); continue; }
    if (info.isSymbolicLink()) { const entry = { path: member, metadataOnlySymlink: fs.readlinkSync(path.join(root, member)) }; files.push(entry); lines.push(`${JSON.stringify(entry)}\n`); continue; }
    if (!info.isFile() || info.size > 262144) throw new Error('ARCHIVE_INPUT_RECORD');
    const bytes = fs.readFileSync(path.join(root, member)); rawBytes += bytes.length;
    if (rawBytes > 64 * 1024 * 1024) throw new Error('ARCHIVE_INPUT_CAP');
    const entry = { path: member, bytes: bytes.length, mode: info.mode & 0o7777, sha256: hash(bytes) };
    files.push(entry); lines.push(`${JSON.stringify({ ...entry, base64: bytes.toString('base64') })}\n`);
  }
}
visit('runs/synthetic-v7-01'); visit('runs/synthetic-launch-v7-01/evidence');
const full = createHash('sha256'), parts = [];
let pending = Buffer.alloc(0), compressedBytes = 0;
function save(bytes) {
  const name = `raw-${String(parts.length).padStart(4, '0')}.gzpart`;
  fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx', mode: 0o644 });
  parts.push({ path: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes) });
}
await pipeline(Readable.from(lines), createGzip({ level: 9 }), new Writable({ write(bytes, _encoding, done) {
  try {
    compressedBytes += bytes.length; if (compressedBytes > 8 * 1024 * 1024) throw new Error('ARCHIVE_OUTPUT_CAP'); full.update(bytes);
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 262144) { save(pending.subarray(0, 262144)); pending = Buffer.from(pending.subarray(262144)); }
    done();
  } catch (error) { done(error); }
} }));
if (pending.length) save(pending);
const manifest = { schema: 'V7_COMPACT_RAW_EVIDENCE', originalPreseal: '0036d968', launcherPreseal: 'eaf948ce', recipeSha256: 'f3abcea2fbe712c6a8c4fbea882e12b81e0e26733ee31fd16bd1a9d83f26b77a', pass: 31, fail: 2, unrun: 0, unsafe: false, childrenReaped: { runner: 1, outer: 16, nestedStub: 11 }, actualEngines: 0, actualC11: 0, semantics: 0, rawBytes, compressedBytes, gzipSha256: full.digest('hex'), parts, files, qualification: 'Original 31/33 unchanged. G08 mode-transcription failure; B16 observer count-type failure. No retry/rescore. Symlink fixture metadata only, never followed.' };
const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
if (bytes.length > 262144) throw new Error('MANIFEST_CAP');
fs.writeFileSync(path.join(directory, 'MANIFEST.json'), bytes, { flag: 'wx', mode: 0o644 });
process.stdout.write(`${JSON.stringify({ files: files.length, rawBytes, compressedBytes, parts: parts.length, manifestSha256: hash(bytes) })}\n`);
