import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { admit, authenticate, digest, verifyTree } from '../../candidate-v1/boundary-app.mjs';

export function admissionControls(binding, writeRecord) {
  const { manifestPath, manifestHash, goPath, goHash, manifest } = binding, results = [];
  const test = (id, action, expected) => {
    let caught = false;
    try { action(); } catch (reason) { assert.match(String(reason), expected); caught = true; }
    assert.equal(caught, true); results.push({ id, refused: true });
  };
  const check = () => admit(manifestPath, manifestHash, goPath, goHash);
  check();
  test('G-MANIFEST-HASH', () => admit(manifestPath, '0'.repeat(64), goPath, goHash), /AssertionError/u);
  test('G-GO-HASH', () => admit(manifestPath, manifestHash, goPath, '0'.repeat(64)), /AssertionError/u);
  const target = manifest.rootModule, bytes = fs.readFileSync(target), mode = fs.statSync(target).mode & 0o777;
  try { fs.writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')])); test('G-CHANGED-MODULE', check, /census/u); }
  finally { fs.writeFileSync(target, bytes); fs.chmodSync(target, mode); }
  const moved = target + '.guard-retained';
  try { fs.renameSync(target, moved); test('G-MISSING-MODULE', check, /census/u); }
  finally { fs.renameSync(moved, target); }
  const overlay = path.join(manifest.harnessRoot, 'unexpected-overlay.mjs');
  try { fs.writeFileSync(overlay, 'export {};\n', { flag: 'wx' }); test('G-NEW-OVERLAY', check, /census/u); }
  finally { fs.unlinkSync(overlay); }
  const link = path.join(manifest.harnessRoot, 'forbidden-link');
  try { fs.symlinkSync(manifest.node.path, link); test('G-SYMLINK-ESCAPE', check, /linked member/u); }
  finally { fs.unlinkSync(link); }
  test('G-NODE-HASH', () => authenticate(manifest.node.path, '0'.repeat(64)), /AssertionError/u);
  const tarBytes = fs.readFileSync(manifest.packageTar);
  try { fs.writeFileSync(manifest.packageTar, Buffer.concat([tarBytes, Buffer.from([1])])); test('G-PACKAGE-HASH', check, /census|AssertionError/u); }
  finally { fs.writeFileSync(manifest.packageTar, tarBytes); }
  assert.equal(digest(fs.readFileSync(target)), digest(bytes));
  for (const tree of manifest.trees) verifyTree(tree);
  check(); writeRecord(results); return results;
}
