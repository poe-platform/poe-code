import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
const home = path.dirname(fileURLToPath(import.meta.url));
const work = path.join(home, 'work');
const archive = path.join(home, 'SYNTHETIC-EVIDENCE.ndjson.gz');
const receiptFile = fs.openSync(path.join(home, 'ARCHIVE-RECEIPT.json'), 'wx', 0o600);
const requireThat = (value, code) => { if (!value) throw Error(code); };
async function digestFile(filename, cap) {
  const info = await fsp.lstat(filename); requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= cap, 'HASH_ADMISSION');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) { bytes += chunk.length; requireThat(bytes <= info.size, 'HASH_GROWTH'); hash.update(chunk); }
  requireThat(bytes === info.size, 'HASH_SHORT'); return { bytes, mode: info.mode & 511, sha256: hash.digest('hex') };
}
const files = [], directories = [];
let total = 0;
async function walk(directory) {
  for (const name of (await fsp.readdir(directory)).sort()) {
    const filename = path.join(directory, name), info = await fsp.lstat(filename);
    requireThat(!info.isSymbolicLink(), 'WORK_SYMLINK');
    if (info.isDirectory()) { directories.push(filename); await walk(filename); }
    else { requireThat(info.isFile() && files.length < 1200, 'WORK_MEMBERSHIP'); const binding = await digestFile(filename, 8388608); total += binding.bytes; requireThat(total <= 134217728, 'WORK_ARCHIVE_INPUT_CAP'); files.push({ path: path.relative(work, filename), ...binding }); }
  }
}
let result;
try {
  await walk(work);
  await fsp.writeFile(path.join(home, 'ARCHIVE-INVENTORY.json'), JSON.stringify({ schema: 'OWNED_SYNTHETIC_ARCHIVE_V1', totalBytes: total, files }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  async function* records() {
    for (const entry of files) {
      yield JSON.stringify({ type: 'file', ...entry }) + '\n'; let ordinal = 0;
      for await (const chunk of fs.createReadStream(path.join(work, entry.path), { highWaterMark: 65536 })) yield JSON.stringify({ type: 'chunk', ordinal: ordinal++, base64: chunk.toString('base64') }) + '\n';
      yield JSON.stringify({ type: 'end', chunks: ordinal }) + '\n';
    }
  }
  await pipeline(Readable.from(records()), createGzip({ level: 1 }), fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
  const compressed = await digestFile(archive, 67108864); requireThat(total + compressed.bytes <= 201326592 - 8388608, 'COMBINED_CAPTURE_CAP');
  const gunzip = createGunzip(); const input = fs.createReadStream(archive); input.on('error', error => gunzip.destroy(error)); input.pipe(gunzip);
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
  let index = 0, active = null, bytes = 0, ordinal = 0, hash;
  for await (const line of lines) {
    requireThat(line.length <= 262144, 'ARCHIVE_RECORD_CAP'); const row = JSON.parse(line);
    if (row.type === 'file') { requireThat(active === null && index < files.length, 'ARCHIVE_ORDER'); const { type, ...binding } = row; requireThat(JSON.stringify(binding) === JSON.stringify(files[index]), 'ARCHIVE_HEADER'); active = files[index]; bytes = 0; ordinal = 0; hash = createHash('sha256'); }
    else if (row.type === 'chunk') { requireThat(active && row.ordinal === ordinal++ && typeof row.base64 === 'string' && row.base64.length <= 87384, 'ARCHIVE_CHUNK'); const chunk = Buffer.from(row.base64, 'base64'); requireThat(chunk.toString('base64') === row.base64 && chunk.length <= 65536, 'ARCHIVE_BASE64'); bytes += chunk.length; requireThat(bytes <= active.bytes, 'ARCHIVE_FILE_CAP'); hash.update(chunk); }
    else if (row.type === 'end') { requireThat(active && row.chunks === ordinal && bytes === active.bytes && hash.digest('hex') === active.sha256, 'ARCHIVE_FILE_HASH'); active = null; index++; }
    else throw Error('ARCHIVE_RECORD_TYPE');
  }
  requireThat(active === null && index === files.length, 'ARCHIVE_COMPLETE');
  const guards = [];
  const seal = JSON.parse(await fsp.readFile(path.join(home, 'PRESEAL.json')));
  const main = JSON.parse(await fsp.readFile(path.join(work, 'RESULT.json')));
  const continuation = JSON.parse(await fsp.readFile(path.join(home, 'CONTINUATION-RESULT.json')));
  const expected = new Map([...seal.inputs, ...seal.own, ...seal.tools].map(row => [row.path, row]));
  for (const row of [...main.loaded, ...continuation.loads]) {
    if (!expected.has(row.path)) expected.set(row.path, seal.allowedModules.find(entry => entry.path === row.path));
  }
  for (const [filename, row] of expected) { requireThat(row, 'POSTGUARD_MISSING_BINDING'); const actual = await digestFile(filename, 240000000); requireThat(actual.sha256 === row.sha256 && actual.bytes === row.bytes && actual.mode === row.mode, 'SOURCE_TOOL_POSTGUARD'); guards.push({ path: filename, ...actual }); }
  await fsp.writeFile(path.join(home, 'POSTGUARDS.json'), JSON.stringify({ schema: 'SCOPED_SOURCE_TOOL_LOAD_POSTGUARDS', rows: guards, actualEngines: 0, full416Replayed: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const keep = new Set(['RESULT.json', 'CONTROL-RESULT.json', 'N12-RECEIPT.json']);
  let removed = 0;
  for (const row of files) { const filename = path.join(work, row.path), actual = await digestFile(filename, 8388608); requireThat(actual.sha256 === row.sha256 && actual.bytes === row.bytes && actual.mode === row.mode, 'PRE_CLEANUP_BINDING'); if (!keep.has(row.path)) { await fsp.unlink(filename); removed++; } }
  let removedDirectories = 0;
  for (const directory of directories.sort((left, right) => right.length - left.length)) { await fsp.rmdir(directory); removedDirectories++; }
  result = { status: 'ARCHIVED_VERIFIED_SCOPED_CLEANUP', files: files.length, rawBytes: total, archive: { path: path.basename(archive), ...compressed }, combinedRawPlusArchiveBytes: total + compressed.bytes, everyHeaderChunkHashModeVerified: true, removed, removedDirectories, retainedLive: [...keep], postguards: guards.length, children: 0, noProductPayloadArchive: true };
} catch (error) { result = { status: 'HOLD', message: error.message }; }
fs.writeSync(receiptFile, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(receiptFile); fs.closeSync(receiptFile); process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = result.status === 'HOLD' ? 1 : 0;
