import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const failure = error => ({ name: error?.name, message: error?.message ?? String(error), stack: error?.stack });
export const capture = promise => Promise.resolve(promise).then(value => ({ kind: 'return', value }), reason => ({ kind: 'throw', reason }));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
export const turn = () => new Promise(resolve => setImmediate(resolve));
export function readAdmission(path, digest) {
  const bytes = readFileSync(path); assert.equal(hash(bytes), digest, 'manifest SHA256');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.kind, 'let-independent-loaded-candidate-v1');
  assert.equal(hash(readFileSync(process.execPath)), manifest.nodeSha256);
  const root = realpathSync(manifest.packageRoot);
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.ok(name && !name.startsWith('/') && !name.split('/').includes('..'));
    const target = join(root, name); assert.ok(lstatSync(target).isFile()); assert.equal(realpathSync(target), target);
    assert.equal(hash(readFileSync(target)), expected, name);
  }
  for (const [name, expected] of Object.entries(manifest.harnessFiles)) assert.equal(hash(readFileSync(join(manifest.harnessRoot, name))), expected, name);
  return manifest;
}
export async function loadProduct(manifest, resolver) {
  const expected = join(realpathSync(manifest.packageRoot), 'dist/index.js');
  const specifier = manifest.layout === 'moved' ? resolver('virtual-bash') : pathToFileURL(expected).href;
  assert.equal(realpathSync(fileURLToPath(specifier)), expected);
  const api = await import(specifier);
  const runtime = await import(pathToFileURL(join(manifest.packageRoot, 'dist/shell/runtime.js')).href);
  const arithmetic = await import(pathToFileURL(join(manifest.packageRoot, 'dist/shell/arithmetic.js')).href);
  return { api, runtime, arithmetic, loaded: specifier };
}
export function activationReceipt() {
  const marker = globalThis.__letIndependentMutation;
  if (marker) process.stdout.write(JSON.stringify({ activation: marker }) + '\n');
}
