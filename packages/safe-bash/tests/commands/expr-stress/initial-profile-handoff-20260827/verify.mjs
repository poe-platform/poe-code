import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const manifest = JSON.parse(readFileSync(join(directory, 'MANIFEST.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const input = binding => git(['show', `${binding.commit}:${binding.path}`]);
const load = id => JSON.parse(input(manifest.bindings.find(binding => binding.id === id)));

assert.equal(git(['rev-parse', '--show-toplevel']).toString().trim(), repository);
assert.deepEqual(readdirSync(directory).sort(), manifest.ownedEntries);
for (const name of manifest.ownedEntries) assert(lstatSync(join(directory, name)).isFile(), name);
for (const file of manifest.ownedFiles) {
  const bytes = readFileSync(join(directory, file.path));
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(hash(bytes), file.sha256, file.path);
}
for (const binding of manifest.bindings) {
  const bytes = input(binding);
  assert.equal(bytes.length, binding.bytes, binding.id);
  assert.equal(hash(bytes), binding.sha256, binding.id);
  assert.equal(git(['rev-parse', `${binding.commit}:${binding.path}`]).toString().trim(), binding.blob, binding.id);
  assert.equal(bytes.toString().split('\n').length - Number(bytes.at(-1) === 10), binding.lines, binding.id);
}
git(['merge-base', '--is-ancestor', manifest.quotaCommit, manifest.acceptedProduct]);
for (const name of manifest.unchangedFromQuota) {
  assert.deepEqual(git(['show', `${manifest.acceptedProduct}:${name}`]), git(['show', `${manifest.quotaCommit}:${name}`]), name);
}
const built = load('review-built-before');
const installed = load('review-installed-before');
assert.deepEqual(built, load('review-built-after'));
assert.deepEqual(installed, load('review-installed-after'));
const installedDist = Object.fromEntries(Object.entries(installed)
  .filter(([name]) => name.startsWith('dist/'))
  .map(([name, value]) => [name.slice(5), value]));
assert.deepEqual(installedDist, built);
const count = tree => ({ entries: Object.keys(tree).length, files: Object.values(tree).filter(entry => entry.kind === 'file').length });
assert.deepEqual(count(built), manifest.package.builtInventory);
assert.deepEqual(count(installed), manifest.package.installedInventory);
const packed = load('review-package');
assert.equal(packed.tarSha256, manifest.package.tarSha256);
assert.equal(packed.artifact.size, manifest.package.compressedBytes);
assert.equal(packed.artifact.entryCount, manifest.package.packageEntries);
assert.equal(packed.artifact.unpackedSize, manifest.package.unpackedBytes);
for (const entry of manifest.package.selectedDist) assert.deepEqual(installed[entry.path], entry.observed, entry.path);
const moved = load('review-moved');
assert.equal(moved.passed, 19);
assert.equal(moved.total, 19);
assert.equal(moved.activeWorkers, 0);
assert.deepEqual(moved.unhandledRejections, []);
assert.equal(moved.publicExprExportClaim, false);
assert.equal(moved.runtimeDependencies, 0);
const sourcePackage = load('source-package');
assert.deepEqual(Object.keys(sourcePackage.dependencies ?? {}), []);
assert.equal(sourcePackage.exports['./commands/expr'], undefined);
assert.equal(sourcePackage.name, 'virtual-bash');
assert.equal(Buffer.byteLength('expr: output bytes limit exceeded\n'), 34);
console.log(JSON.stringify({
  mode: 'read-only committed-source and evidence authentication; no product/test/native execution',
  acceptedProduct: manifest.acceptedProduct,
  bindings: manifest.bindings.length,
  ownedEntrySetVerified: true,
  historicalBuiltInstalledDistEqual: true,
  publicExpr: 'HOLD',
  pendingAssertionReview: true,
}));
