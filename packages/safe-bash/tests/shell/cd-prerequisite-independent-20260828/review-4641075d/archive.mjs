import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, closeSync, copyFileSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { createGunzip, createGzip, gunzipSync, gzipSync } from 'node:zlib';
import { blob, controls, directory, foreignStaging, inventory, own, save, sha } from './bind.mjs';

const roots = ['tool-inputs', 'attempt-01', 'attempt-02', 'continuation-01', 'continuation-02', 'continuation-03', 'auxiliary-01', 'load-controls-01'];
const magic = 'CD-REVIEW-BLOBS-v1';
const partBound = 16 * 1024 * 1024;
const safe = path => { assert(typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0')); return resolve(directory, path); };
const indexData = () => JSON.parse(gunzipSync(readFileSync(`${directory}/ARCHIVE-INDEX.json.gz`), { maxOutputLength: 64 * 1024 * 1024 }));

async function capture() {
  controls();
  const entries = Object.fromEntries(roots.map(root => [root, inventory(safe(root))]));
  const unique = new Map(); let logicalBytes = 0; let files = 0;
  for (const [root, tree] of Object.entries(entries)) for (const [path, entry] of Object.entries(tree)) if (entry.kind === 'file') { files++; logicalBytes += entry.bytes; const prior = unique.get(entry.sha256); if (prior) assert.equal(prior.bytes, entry.bytes); else unique.set(entry.sha256, { bytes: entry.bytes, source: safe(`${root}/${path}`) }); }
  const parts = []; let descriptor; let partBytes = 0; let partHash; let partName;
  const closePart = () => { if (descriptor === undefined) return; fsyncSync(descriptor); closeSync(descriptor); parts.push({ name: partName, bytes: partBytes, sha256: partHash.digest('hex') }); descriptor = undefined; };
  const sink = new Writable({ write(chunk, encoding, done) {
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (descriptor === undefined) { partName = `ARTIFACTS-${String(parts.length + 1).padStart(2, '0')}.gz.part`; descriptor = openSync(safe(partName), 'wx'); partBytes = 0; partHash = createHash('sha256'); }
        const fragment = chunk.subarray(offset, offset + Math.min(chunk.length - offset, partBound - partBytes));
        writeSync(descriptor, fragment); partHash.update(fragment); partBytes += fragment.length; offset += fragment.length;
        if (partBytes === partBound) closePart();
      }
      done();
    } catch (error) { done(error); }
  }, final(done) { try { closePart(); done(); } catch (error) { done(error); } } });
  const gzip = createGzip({ level: 9 }); gzip.pipe(sink);
  const settlement = finished(sink);
  const write = async bytes => { if (!gzip.write(bytes)) await once(gzip, 'drain'); };
  await write(Buffer.from(`${magic}\n`));
  for (const [hash, entry] of [...unique].sort(([left], [right]) => left.localeCompare(right))) {
    await write(Buffer.from(`${JSON.stringify({ sha256: hash, bytes: entry.bytes })}\n`));
    const digest = createHash('sha256'); let length = 0;
    for await (const chunk of createReadStream(entry.source)) { digest.update(chunk); length += chunk.length; await write(chunk); }
    assert.equal(length, entry.bytes); assert.equal(digest.digest('hex'), hash); await write(Buffer.from('\n'));
  }
  await write(Buffer.from('{"end":true}\n')); gzip.end(); await settlement;
  for (const [root, expected] of Object.entries(entries)) assert.deepEqual(inventory(safe(root)), expected);
  const index = { schema: 1, classification: 'complete owned scratch content/mode/membership; no exclusions; duplicate contents stored once', roots: entries, blobs: Object.fromEntries([...unique].map(([hash, entry]) => [hash, { bytes: entry.bytes }])) };
  writeFileSync(safe('ARCHIVE-INDEX.json.gz'), gzipSync(JSON.stringify(index), { level: 9 }), { flag: 'wx' });
  save('ARCHIVE.json', { schema: 1, format: magic, parts, index: { name: 'ARCHIVE-INDEX.json.gz', sha256: sha(readFileSync(safe('ARCHIVE-INDEX.json.gz'))) }, roots, files, logicalBytes, uniqueBlobs: unique.size, uniqueBytes: [...unique.values()].reduce((sum, entry) => sum + entry.bytes, 0), compressedBytes: parts.reduce((sum, entry) => sum + entry.bytes, 0), capturedAt: new Date().toISOString(), foreignStaging: foreignStaging() });
  await verify();
}

export async function verify(restore = false, collect) {
  const manifest = JSON.parse(readFileSync(safe('ARCHIVE.json'))); assert.equal(manifest.format, magic); assert.deepEqual(manifest.roots, roots);
  assert.equal(sha(readFileSync(safe(manifest.index.name))), manifest.index.sha256);
  const index = indexData(); const destinations = new Map();
  if (restore) {
    for (const root of roots) assert(!existsSync(safe(root)), `restore refuses existing ${root}`);
    for (const [root, entries] of Object.entries(index.roots)) for (const [path, entry] of Object.entries(entries)) {
      const destination = safe(path ? `${root}/${path}` : root);
      if (entry.kind === 'directory') { mkdirSync(destination, { recursive: true }); chmodSync(destination, entry.mode); }
      else { assert.equal(entry.kind, 'file'); const list = destinations.get(entry.sha256) ?? []; list.push({ path: destination, mode: entry.mode }); destinations.set(entry.sha256, list); }
    }
  }
  const chunks = async function* () { for (const part of manifest.parts) { const bytes = readFileSync(safe(part.name)); assert(bytes.length <= partBound); assert.equal(bytes.length, part.bytes); assert.equal(sha(bytes), part.sha256); yield bytes; } };
  const input = Readable.from(chunks()); const decoded = input.pipe(createGunzip()); input.on('error', error => decoded.destroy(error));
  let state = 'magic'; let header = Buffer.alloc(0); let remaining = 0; let current; let digest; let fd; const seen = new Set(); let complete = false;
  const finishBlob = () => {
    assert.equal(digest.digest('hex'), current.sha256); seen.add(current.sha256);
    if (collect?.has(current.sha256)) collect.set(current.sha256, Buffer.concat(collect.get(current.sha256)));
    if (restore) { const targets = destinations.get(current.sha256); fsyncSync(fd); closeSync(fd); fd = undefined; chmodSync(targets[0].path, targets[0].mode); for (const target of targets.slice(1)) { copyFileSync(targets[0].path, target.path, 1); chmodSync(target.path, target.mode); } }
    state = 'newline';
  };
  for await (const chunk of decoded) {
    let offset = 0;
    while (offset < chunk.length) {
      assert(!complete, 'trailing decoded archive data');
      if (state === 'body') { const size = Math.min(remaining, chunk.length - offset); const fragment = chunk.subarray(offset, offset + size); digest.update(fragment); if (collect?.has(current.sha256)) { assert(current.bytes <= 32 * 1024 * 1024); collect.get(current.sha256).push(Buffer.from(fragment)); } if (restore) writeSync(fd, fragment); remaining -= size; offset += size; if (remaining === 0) finishBlob(); }
      else if (state === 'newline') { assert.equal(chunk[offset++], 10); state = 'header'; }
      else {
        const end = chunk.indexOf(10, offset); const length = end === -1 ? chunk.length : end;
        header = Buffer.concat([header, chunk.subarray(offset, length)]); assert(header.length <= 4096); offset = length;
        if (end === -1) continue; offset++;
        if (state === 'magic') { assert.equal(header.toString(), magic); state = 'header'; }
        else {
          current = JSON.parse(header.toString());
          if (current.end) { assert.deepEqual(current, { end: true }); complete = true; }
          else { assert(/^[a-f0-9]{64}$/u.test(current.sha256)); assert(!seen.has(current.sha256)); assert.equal(current.bytes, index.blobs[current.sha256]?.bytes); assert(Number.isSafeInteger(current.bytes) && current.bytes >= 0); digest = createHash('sha256'); remaining = current.bytes; state = 'body'; if (restore) fd = openSync(destinations.get(current.sha256)[0].path, 'wx'); if (remaining === 0) finishBlob(); }
        }
        header = Buffer.alloc(0);
      }
    }
  }
  assert(complete && header.length === 0); assert.deepEqual([...seen].sort(), Object.keys(index.blobs).sort()); assert.equal(seen.size, manifest.uniqueBlobs);
  const referenced = new Set(); let files = 0;
  for (const [root, entries] of Object.entries(index.roots)) for (const [path, entry] of Object.entries(entries)) { safe(path ? `${root}/${path}` : root); if (entry.kind === 'file') { assert.equal(entry.bytes, index.blobs[entry.sha256]?.bytes); referenced.add(entry.sha256); files++; } else assert.equal(entry.kind, 'directory'); }
  assert.deepEqual([...referenced].sort(), [...seen].sort()); assert.equal(files, manifest.files);
  if (restore) for (const [root, entries] of Object.entries(index.roots)) assert.deepEqual(inventory(safe(root)), entries);
  console.log(JSON.stringify({ classification: restore ? 'explicitly authorized data restoration, no product execution' : 'read-only archive verification', roots: roots.length, files, uniqueBlobs: seen.size, compressedBytes: manifest.compressedBytes }));
  return index;
}

const cli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (cli && process.argv[2] === '--capture') await capture();
else if (cli && process.argv[2] === '--verify') await verify();
else if (cli && process.argv[2] === '--restore' && process.argv[3] === 'ROOT_AUTHORIZED_REPLAY') { await verify(); await verify(true); }
else if (cli && process.argv[2] === '--cleanup') {
  const commit = process.argv[3]; assert(/^[a-f0-9]{40}$/u.test(commit)); const before = controls(); const index = await verify();
  const manifest = JSON.parse(readFileSync(safe('ARCHIVE.json')));
  for (const name of ['ARCHIVE.json', manifest.index.name, ...manifest.parts.map(part => part.name)]) assert.deepEqual(blob(commit, `${own}/${name}`), readFileSync(safe(name)), `durable Git evidence required before cleanup: ${name}`);
  for (const root of roots) assert.deepEqual(inventory(safe(root)), index.roots[root]);
  for (const root of roots) rmSync(safe(root), { recursive: true });
  for (const root of roots) assert(!existsSync(safe(root))); assert.deepEqual(controls(), before);
  save('CLEANUP.json', { evidenceCommit: commit, removedOnly: roots, filesArchived: manifest.files, uniqueBlobsArchived: manifest.uniqueBlobs, archiveVerifiedBeforeRemoval: true, exactScratchInventoriesVerifiedBeforeRemoval: true, allRemovedRootsAbsent: true, controlsAndForeignStagingUnchanged: true, completedAt: new Date().toISOString() });
} else if (cli && process.argv[2]) throw new Error('Use --capture, --verify, --cleanup FULL_EVIDENCE_COMMIT, or separately authorized --restore ROOT_AUTHORIZED_REPLAY');
