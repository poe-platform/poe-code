import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argumentsList = process.argv.slice(2);
assert(argumentsList.length === 0 || (argumentsList.length === 1 && argumentsList[0] === '--originals'), 'Usage: node verify.mjs [--originals]');
const directory = dirname(fileURLToPath(import.meta.url));
const read = path => readFileSync(join(directory, path));
const readJson = path => JSON.parse(read(path).toString('utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = readJson('manifest.json');
assert.equal(manifest.schemaVersion, 1);
const inventory = new Map(manifest.originalInventory.map(entry => [entry.originalPath, entry]));
assert.equal(inventory.size, manifest.originalInventory.length);
const paths = new Set();
for (const entry of manifest.embedded) {
  assert.match(entry.path, /^(?:diagnosis\.txt|data\/[A-Za-z0-9.-]+)$/);
  assert(!paths.has(entry.path), `Duplicate path: ${entry.path}`);
  paths.add(entry.path);
  assert.equal(entry.classification, 'DATA');
  assert(lstatSync(join(directory, entry.path)).isFile(), `Not a regular file: ${entry.path}`);
  const bytes = read(entry.path);
  assert.equal(bytes.length, entry.bytes, `${entry.path}: byte length`);
  assert.equal(hash(bytes), entry.sha256, `${entry.path}: SHA-256`);
  const original = inventory.get(entry.originalPath);
  assert(original?.embedded, `${entry.path}: missing embedded original`);
  assert.equal(original.sha256, entry.sha256);
  assert.equal(original.bytes, entry.bytes);
  const originalName = entry.originalPath.split('/').at(-1);
  const suffix = /\.(ts|c|mjs)$/.test(originalName) ? '.data' : '';
  assert.equal(entry.path, entry.originalPath === manifest.originalReport ? 'diagnosis.txt' : `data/${originalName}${suffix}`);
  assert(!/\.(ts|c|mjs|js)$/.test(entry.path), `${entry.path}: executable DATA suffix`);
}
assert.equal(manifest.embedded.length, manifest.originalInventory.filter(entry => entry.embedded).length);

const walk = (root, prefix = '') => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const relative = prefix + entry.name;
  assert(!entry.isSymbolicLink(), `Unexpected symlink: ${relative}`);
  if (entry.isDirectory()) return [relative + '/', ...walk(join(root, entry.name), relative + '/')];
  assert(entry.isFile(), `Unexpected file type: ${relative}`);
  return [relative];
}).sort();
assert.deepEqual(manifest.archiveSupportFiles, ['README.md', 'manifest.json', 'verify.mjs']);
assert.deepEqual(walk(directory), [...paths, ...manifest.archiveSupportFiles, 'data/'].sort());

const integrity = readJson('data/integrity.json');
assert.equal(integrity.report.path, manifest.originalReport);
assert.equal(integrity.report.sha256, inventory.get(manifest.originalReport).sha256);
const originalNames = manifest.originalInventory.filter(entry => entry.originalPath !== manifest.originalReport).map(entry => {
  assert.equal(dirname(entry.originalPath), manifest.originalDirectory);
  return entry.originalPath.split('/').at(-1);
});
assert.deepEqual(originalNames.sort(), [...Object.keys(integrity.files), 'integrity.json'].sort());
for (const [name, sha256] of Object.entries(integrity.files)) {
  const original = inventory.get(join(manifest.originalDirectory, name));
  assert.equal(original.sha256, sha256, `${name}: historical integrity hash`);
  assert.equal(original.recordedSha256, sha256);
}
assert.equal(inventory.get(manifest.originalReport).recordedSha256, integrity.report.sha256);
assert.equal(inventory.get(join(manifest.originalDirectory, 'integrity.json')).recordedSha256, null);
assert.deepEqual(manifest.originalInventory.filter(entry => !entry.embedded).map(entry => entry.originalPath), [join(manifest.originalDirectory, 'registers')]);
const diagnostic = readJson('data/diagnostic.json');
assert.equal(hash(read('data/bre-worker.observed.ts.data')), diagnostic.sourceHash);
for (const [variant, output] of Object.entries(diagnostic.outputs)) {
  assert(['unguarded', 'captureAwareCycleOnly'].includes(variant));
  assert.equal(hash(read(`data/${variant}.mjs.data`)), output.moduleHash);
}
for (const reference of manifest.referencedButNotEmbedded) {
  assert.equal(reference.classification, 'REFERENCED_NOT_EMBEDDED');
  for (const measurement of reference.measurements) {
    assert.match(measurement.sha256, /^[a-f0-9]{64}$/);
    const [path, pointer] = measurement.evidence.split('#');
    if (pointer) {
      const value = pointer.slice(1).split('/').reduce((value, key) => value[key.replaceAll('~1', '/').replaceAll('~0', '~')], readJson(path));
      assert.equal(value, measurement.sha256, measurement.evidence);
    } else {
      assert(measurement.evidence.startsWith('diagnosis.txt:'));
      assert(read('diagnosis.txt').toString('utf8').includes(measurement.sha256));
    }
  }
}

if (argumentsList.length) {
  assert.deepEqual(walk(manifest.originalDirectory), originalNames.sort());
  for (const entry of manifest.originalInventory) {
    const stat = lstatSync(entry.originalPath);
    assert(stat.isFile() && !stat.isSymbolicLink(), entry.originalPath);
    const bytes = readFileSync(entry.originalPath);
    assert.equal(bytes.length, entry.bytes, `${entry.originalPath}: byte length`);
    assert.equal(hash(bytes), entry.sha256, `${entry.originalPath}: SHA-256`);
    assert.equal((stat.mode & 0o777).toString(8), entry.mode, `${entry.originalPath}: mode`);
    assert.equal(stat.mtime.toISOString(), entry.mtime, `${entry.originalPath}: mtime`);
    const embedded = manifest.embedded.find(item => item.originalPath === entry.originalPath);
    if (embedded) assert(bytes.equals(read(embedded.path)), `${entry.originalPath}: byte equality`);
  }
}
console.log(JSON.stringify({
  result: 'Archive integrity verified; no product/native acceptance measured.',
  embeddedDataFiles: manifest.embedded.length,
  embeddedBytes: manifest.embedded.reduce((total, entry) => total + entry.bytes, 0),
  originalsCompared: argumentsList.length ? inventory.size : 0,
  exactArchiveInventory: true,
  originalDirectoryInventoryChecked: argumentsList.length > 0,
  manifestSha256: hash(read('manifest.json')),
  diagnosisSha256: hash(read('diagnosis.txt')),
}, null, 2));
