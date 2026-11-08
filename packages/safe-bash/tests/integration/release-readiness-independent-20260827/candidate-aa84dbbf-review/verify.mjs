import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json')));
assert.deepEqual(readdirSync(root).sort(), [...Object.keys(manifest.files), 'MANIFEST.json'].sort());
for (const [path, expected] of Object.entries(manifest.files)) {
  const stat = lstatSync(join(root, path)); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const bytes = readFileSync(join(root, path)); assert.equal(hash(bytes), expected.sha256, path); assert.equal(bytes.length, expected.bytes, path); assert.equal(stat.mode & 0o777, expected.mode, path);
}
const bundle = JSON.parse(gunzipSync(Buffer.from(readFileSync(join(root, 'RAW.json.gz.base64'), 'utf8'), 'base64')));
assert.deepEqual(Object.keys(bundle.files).sort(), Object.keys(manifest.rawFiles).sort());
const matrix = JSON.parse(readFileSync(join(root, 'CASE_MATRIX.json')));
assert.equal(matrix.results.length, 78); assert.equal(new Set(matrix.results.map(row => row.id)).size, 78);
assert.deepEqual(matrix.counts, { PASS: 71, FAIL: 0, NOTEXECUTED: 7 });
for (const [path, encoded] of Object.entries(bundle.files)) {
  assert.ok(!path.startsWith('/') && !path.split('/').some(part => !part || part === '..' || part === '.'));
  const bytes = Buffer.from(encoded, 'base64'), expected = manifest.rawFiles[path];
  assert.equal(hash(bytes), expected.sha256, path); assert.equal(bytes.length, expected.bytes, path);
}
const rawMatrix = JSON.parse(Buffer.from(bundle.files['evidence/CASE_MATRIX.json'], 'base64'));
assert.deepEqual(matrix.results.map(row => [row.id, row.expected, row.status]), rawMatrix.results.map(row => [row.id, row.expected, row.status]));
if (process.argv.length > 2) {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--extract'); const destination = resolve(process.argv[3]);
  assert.ok(destination !== root && !destination.startsWith(root + '/')); mkdirSync(destination);
  for (const [path, encoded] of Object.entries(bundle.files)) { const target = join(destination, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(encoded, 'base64'), { flag: 'wx', mode: manifest.rawFiles[path].mode }); }
}
console.log(JSON.stringify({ verified: true, files: Object.keys(manifest.files).length + 1, rawFiles: Object.keys(bundle.files).length, frozenCases: matrix.results.length, counts: matrix.counts, wholeGateExecuted: false }));
