import { createReadStream, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, CHUNK, check, fingerprint, inventory, regular, relative, writeNew } from './core.mjs';

const rawRoot = path.join(ROOT, 'synthetic-evidence');
const bundlePath = path.join(ROOT, 'SYNTHETIC-EVIDENCE.jsonl.gz');
const [mode] = process.argv.slice(2);
if (mode === 'capture') {
  const inputManifest = await fingerprint(path.join(rawRoot, 'EVIDENCE-MANIFEST.json'));
  const before = await inventory(rawRoot);
  const preRun = { started: new Date().toISOString(), classification: 'EVIDENCE_TRANSPORT_ONLY_NOT_QUALIFICATION', inputManifest, tool: await fingerprint(process.execPath), bundler: await fingerprint(path.join(ROOT, 'bundle-evidence.mjs')), files: before.filter(entry => !entry.directory).length, directories: before.filter(entry => entry.directory).length, chunkBytes: CHUNK, recordBytes: 131072, extractsFiles: false };
  await writeNew(path.join(ROOT, 'BUNDLE-PRE-RUN.json'), preRun);
  async function* records() {
    yield `${JSON.stringify({ type: 'header', format: 1, ...preRun })}\n`;
    for (const entry of before) {
      yield `${JSON.stringify({ type: entry.directory ? 'directory' : 'file', ...entry })}\n`;
      if (entry.directory) continue;
      for await (const bytes of createReadStream(await regular(rawRoot, entry.path), { highWaterMark: CHUNK })) yield `${JSON.stringify({ type: 'chunk', base64: bytes.toString('base64') })}\n`;
      yield '{"type":"end"}\n';
    }
  }
  await pipeline(Readable.from(records()), createGzip({ level: 9 }), createWriteStream(bundlePath, { flags: 'wx', mode: 0o644 }));
  check(JSON.stringify(await inventory(rawRoot)) === JSON.stringify(before), 'CAPTURE_INPUT_CHANGED');
  await writeNew(path.join(ROOT, 'BUNDLE-RECEIPT.json'), { ended: new Date().toISOString(), bundle: await fingerprint(bundlePath), inputManifest, unchanged: true, includesEmptyDirectories: true });
  process.stdout.write('evidence bundle captured; raw tree unchanged\n');
} else if (mode === 'verify') {
  const receipt = JSON.parse(await readFile(path.join(ROOT, 'BUNDLE-RECEIPT.json'), 'utf8'));
  const actual = await fingerprint(bundlePath, receipt.bundle.bytes);
  check(actual.bytes === receipt.bundle.bytes && actual.sha256 === receipt.bundle.sha256, 'BUNDLE_IDENTITY');
  let pending = '';
  let current;
  let header;
  let files = 0;
  let directories = 0;
  let manifestDigest;
  const names = new Set();
  function record(line) {
    const row = JSON.parse(line);
    if (row.type === 'header') { check(!header && files === 0 && directories === 0, 'BUNDLE_HEADER'); header = row; }
    else if (row.type === 'file' || row.type === 'directory') {
      check(header && !current && !names.has(relative(row.path)), 'BUNDLE_ENTRY'); names.add(row.path);
      if (row.type === 'directory') directories++;
      else { check(['644', '755'].includes(row.mode) && Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'BUNDLE_DESCRIPTOR'); current = { ...row, used: 0, hash: createHash('sha256') }; }
    } else if (row.type === 'chunk') {
      check(current && typeof row.base64 === 'string' && row.base64.length <= 87384, 'BUNDLE_CHUNK');
      const bytes = Buffer.from(row.base64, 'base64');
      check(bytes.length <= CHUNK && bytes.toString('base64') === row.base64 && bytes.length <= current.bytes - current.used, 'BUNDLE_BYTES');
      current.hash.update(bytes); current.used += bytes.length;
    } else if (row.type === 'end') {
      check(current && current.used === current.bytes, 'BUNDLE_END');
      const digest = current.hash.digest('hex'); check(digest === current.sha256, 'BUNDLE_FILE_HASH');
      if (current.path === 'EVIDENCE-MANIFEST.json') manifestDigest = digest;
      files++; current = undefined;
    } else check(false, 'BUNDLE_RECORD');
  }
  const consumer = new Transform({ transform(chunk, encoding, callback) {
    try {
      pending += chunk.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) { check(newline <= 131072, 'BUNDLE_LINE_BOUND'); record(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      check(pending.length <= 131072, 'BUNDLE_LINE_BOUND'); callback();
    } catch (error) { callback(error); }
  } });
  await pipeline(createReadStream(bundlePath, { highWaterMark: CHUNK }), createGunzip({ chunkSize: CHUNK }), consumer);
  check(!current && !pending && files === header.files && directories === header.directories && manifestDigest === receipt.inputManifest.sha256, 'BUNDLE_COMPLETE');
  process.stdout.write(`evidence bundle verified; files=${files} directories=${directories}; no extraction\n`);
} else { process.stderr.write('usage: bundle-evidence.mjs capture|verify\n'); process.exitCode = 2; }
