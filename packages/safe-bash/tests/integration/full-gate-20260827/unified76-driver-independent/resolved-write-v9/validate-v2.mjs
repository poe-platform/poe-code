import assert from 'node:assert/strict';
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const read = name => JSON.parse(readFileSync(join(owned, name), 'utf8'));
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) hash.update(chunk);
  return hash.digest('hex');
}
async function rows(name, expected, visit) {
  assert.equal(await hashFile(join(owned, name)), expected.gzipSha256);
  const hash = createHash('sha256');
  const input = createReadStream(join(owned, name), { highWaterMark: 65536 });
  const decoded = input.pipe(createGunzip());
  input.on('error', error => decoded.destroy(error));
  decoded.on('data', chunk => hash.update(chunk));
  for await (const line of createInterface({ input: decoded, crlfDelay: Infinity })) visit(JSON.parse(line));
  assert.equal(hash.digest('hex'), expected.ndjsonSha256);
}
const jsonFiles = readdirSync(owned).filter(name => name.endsWith('.json'));
for (const name of jsonFiles) read(name);
const bindings = read('BINDINGS.json');
for (const [path, expected] of Object.entries(bindings.prior)) assert.equal(await hashFile(join(repository, path)), expected, path);
const cleanup = read('CLEANUP.json');
for (const root of cleanup.roots) assert.equal(existsSync(root), false, root);
assert.equal(cleanup.survivors.length, 0);
const index = read('RAW-INDEX.json');
let active;
let files = 0;
let bytes = 0;
await rows('RAW.ndjson.gz', index, row => {
  if (row.kind === 'file' || row.kind === 'generated-raw-report') {
    assert.equal(active, undefined);
    assert.equal(row.id, files);
    const expected = index.files[files];
    for (const key of ['root', 'path', 'bytes', 'sha256']) assert.equal(row[key], expected[key]);
    active = { id: row.id, expected, hash: createHash('sha256'), bytes: 0 };
  } else if (row.kind === 'chunk') {
    assert.equal(row.id, active.id);
    const chunk = Buffer.from(row.base64, 'base64');
    assert.ok(chunk.length <= 65536);
    assert.equal(chunk.toString('base64'), row.base64);
    active.hash.update(chunk);
    active.bytes += chunk.length;
  } else {
    assert.equal(row.kind, 'end');
    assert.equal(row.id, active.id);
    assert.equal(row.bytes, active.bytes);
    assert.equal(row.bytes, active.expected.bytes);
    assert.equal(row.sha256, active.expected.sha256);
    assert.equal(active.hash.digest('hex'), row.sha256);
    bytes += row.bytes;
    files++;
    active = undefined;
  }
});
assert.equal(active, undefined);
assert.equal(files, index.files.length);
assert.equal(bytes, index.bytes);
let regularFiles = 0;
let regularBytes = 0;
await rows(index.filesystem.file, index.filesystem, row => {
  assert.notEqual(row.kind, 'instruction-name-metadata-only');
  if (row.kind === 'file') {
    regularFiles++;
    regularBytes += row.bytes;
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
  }
});
assert.equal(regularFiles, index.filesystem.regularFiles);
assert.equal(regularBytes, index.filesystem.regularBytes);
assert.equal(await hashFile(join(owned, 'POLICY.json')), read('RESULTS.json').policySha256);
console.log(JSON.stringify({ status: 'PASS_STATIC_INTEGRITY_ONLY', jsonFiles: jsonFiles.length, rawFiles: files, rawBytes: bytes, regularFiles, regularBytes, priorArtifactsUnchanged: Object.keys(bindings.prior).length, removedRootsStillAbsent: cleanup.roots.length }));
