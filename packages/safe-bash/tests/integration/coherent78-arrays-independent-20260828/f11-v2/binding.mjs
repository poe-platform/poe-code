import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { regular, sha, inventory, census, verify } from '../common.mjs';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const parent = path.dirname(here);
export const repo = path.resolve(here, '../../../..');
export const oldWork = path.join(parent, 'RUN-COHERENT78-ARRAYS-20260828-01');
export const oldSealSha = 'c9ad1b06247602063001f2b87f8e42d28751d3aaf47c606b718fb5d799cd38db';
export const finalSha = 'd05296cfd27314c76f0cfcf9929e2e74ce48afa4e3667ac909d422aaeb720b91';
export const read = filename => JSON.parse(regular(filename));
export function role(filename) {
  const bytes = regular(filename);
  return { path: path.relative(repo, filename), bytes: bytes.length, mode: fs.lstatSync(filename).mode & 0o777, sha256: sha(bytes) };
}
export function rolesIntact(roles) {
  for (const expected of roles) assert.deepEqual(role(path.join(repo, expected.path)), expected);
}
export function bindRetained() {
  const sealBytes = regular(path.join(parent, 'SEAL.json'));
  assert.equal(sha(sealBytes), oldSealSha);
  const oldSeal = JSON.parse(sealBytes);
  rolesIntact(oldSeal.roles);
  const finalBytes = regular(path.join(oldWork, 'records/FINAL.json'));
  assert.equal(sha(finalBytes), finalSha);
  const final = JSON.parse(finalBytes);
  assert.equal(final.complete, true);
  assert.equal(final.unsafeStop, false);
  assert.deepEqual(final.accounting.failures, ['source-build-literal', 'installed-literal', 'moved-literal']);
  assert.ok(final.accounting.children.every(child => child.retired));
  for (const tree of final.finalCensuses) verify(tree);
  const auth = read(path.join(parent, 'AUTHENTICATION.json'));
  assert.equal(auth.derived, 'd111e5bf1f53aff16c5d4112e9ead2e025d6464f');
  assert.equal(auth.selectedSource.length, 272);
  for (const input of auth.selectedSource) {
    const filename = path.join(oldWork, 'source', input.path);
    const bytes = regular(filename);
    assert.equal(bytes.length, input.bytes);
    assert.equal(sha(bytes), input.sha256);
    assert.equal(fs.lstatSync(filename).mode & 0o777, parseInt(input.mode, 8) & 0o777);
  }
  const artifactRoot = path.join(oldWork, 'artifacts');
  const tarNames = Object.keys(census(artifactRoot)).filter(name => name.endsWith('.tgz'));
  assert.equal(tarNames.length, 1);
  const tar = regular(path.join(artifactRoot, tarNames[0]));
  assert.equal(sha(tar), 'f5152eaeaaeb78aff350a86d55f67905c2caab900ba2f45b1869da6498e1e956');
  assert.equal(tar.length, 795138);
  assert.equal(Object.keys(auth.packageEntries).length, 874);
  assert.deepEqual(inventory(tar), auth.packageEntries);
  for (const layout of ['source-build', 'moved']) {
    const product = path.join(oldWork, 'apps', layout, 'node_modules/virtual-bash');
    const actual = Object.fromEntries(Object.entries(census(product)).filter(([, row]) => !row.directory));
    assert.deepEqual(actual, auth.packageEntries);
  }
  const archive = read(path.join(parent, 'evidence-v1/AUDIT.json')).archive;
  assert.equal(archive.length, 109);
  assert.deepEqual(archive.map(row => row.path).sort(), fs.readdirSync(path.join(oldWork, 'records')).sort());
  for (const row of archive) {
    const raw = regular(path.join(oldWork, 'records', row.path));
    const receipt = final.accounting.records.find(item => item.name + '.json' === row.path);
    assert.equal(sha(raw), row.path === 'FINAL.json' ? finalSha : receipt.sha256);
    assert.equal(sha(raw), row.sha256);
    assert.equal(raw.length, row.bytes);
    assert.equal(fs.lstatSync(path.join(oldWork, 'records', row.path)).mode & 0o777, row.mode);
    const compressed = regular(path.join(parent, 'evidence-v1', row.archive));
    assert.equal(sha(compressed), row.compressedSha256);
    assert.equal(compressed.length, row.compressedBytes);
    assert.deepEqual(gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 }), raw);
  }
  return { auth, oldSeal, final, archive };
}
export function workers() {
  const original = regular(path.join(parent, 'worker.mjs'));
  const delta = read(path.join(here, 'DELTA.json'));
  assert.equal(original.toString().split(delta.before).length, 2);
  const corrected = Buffer.from(original.toString().replace(delta.before, delta.after));
  assert.deepEqual(Buffer.from(corrected.toString().replace(delta.after, delta.before)), original);
  return { original, corrected, delta };
}
