import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const coreRoot = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(coreRoot, '../../../../../..');
export const framework = resolve(coreRoot, '../..');
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const jsonHash = (value) => hash(JSON.stringify(value));
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function readBound(path, expected) {
  assert(typeof path === 'string' && /^[a-f0-9]{64}$/.test(expected ?? ''), 'Missing independently supplied file binding');
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 134217728);
  assert.equal(realpathSync(path), resolve(path));
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), expected, `Bound bytes: ${path}`);
  return bytes;
}

export function treeEntries(root = coreRoot) {
  const entries = [];
  let total = 0;
  const visit = (path, prefix) => {
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink());
    assert(entries.length < 4096);
    if (stat.isDirectory()) {
      entries.push({ path: prefix || '.', kind: 'directory', mode: stat.mode & 4095 });
      for (const name of readdirSync(path).sort()) visit(join(path, name), prefix ? `${prefix}/${name}` : name);
    } else {
      assert(stat.isFile() && stat.nlink === 1 && stat.size <= 16777216);
      total += stat.size;
      assert(total <= 134217728);
      const bytes = readFileSync(path);
      entries.push({ path: prefix, kind: 'file', mode: stat.mode & 4095, bytes: bytes.length, sha256: hash(bytes) });
    }
  };
  assert.equal(realpathSync(root), resolve(root));
  visit(root, '');
  return entries;
}

export function verifyIntegration(sealPath, sealSha256) {
  const seal = JSON.parse(readBound(sealPath, sealSha256));
  assert.equal(seal.schema, 1);
  assert.equal(seal.kind, 'YQ_COMPOUND_INTEGRATION_V2_PRESEAL');
  assert.equal(jsonHash(treeEntries()), seal.coreTreeSha256, 'Integration core membership/hash/modes');
  for (const binding of seal.documentation) readBound(join(coreRoot, '..', binding.path), binding.sha256);
  return seal;
}

export function verifyRuntimeSource(pins = readJson(join(coreRoot, 'COMPONENTS.json'))) {
  assert.equal(pins.runtime.status, 'SEALED', 'RUNTIME_V2_BINDING_PENDING: no fallback to original runtime');
  for (const binding of [pins.runtime.sourcePreseal, pins.runtime.seal, ...pins.runtime.files]) {
    readBound(join(repository, binding.path), binding.sha256);
    assert.equal(lstatSync(join(repository, binding.path)).mode & 4095, binding.mode ?? 420);
  }
  assert.deepEqual(readdirSync(join(repository, pins.runtime.sourceRoot)).sort(), pins.runtime.rootMembership, 'Runtime-v2 root membership including added source entries');
  return JSON.parse(readBound(join(repository, pins.runtime.seal.path), pins.runtime.seal.sha256));
}

export async function loadComponents(runtimeRoot) {
  const pins = readJson(join(coreRoot, 'COMPONENTS.json'));
  const recipe = readJson(join(coreRoot, 'RECIPE.json'));
  const runtimeSeal = verifyRuntimeSource(pins);
  assert(typeof runtimeRoot === 'string' && runtimeRoot.startsWith('/'), 'Explicit materialized runtime-v2 recipe root required');
  assert.equal(jsonHash(treeEntries(runtimeRoot)), runtimeSeal.treeSha256, 'Materialized runtime-v2 recipe before imports');
  for (const binding of [pins.runtime.seal, pins.consumers.seal, pins.consumers.verifier, pins.author.handoff, pins.author.manifest, ...pins.runtime.files]) readBound(join(repository, binding.path), binding.sha256);
  const verifier = await import(pathToFileURL(join(repository, pins.consumers.verifier.path)).href);
  verifier.verifyRecipe(pins.consumers.seal.sha256);
  const runtime = {};
  for (const name of ['integrity', 'host', 'authorization', 'fixtures', 'context', 'assert-capture']) runtime[name] = await import(pathToFileURL(join(runtimeRoot, `${name}.mjs`)).href);
  assert.equal(runtime.integrity.jsonHash(runtime.integrity.treeSnapshot(runtimeRoot)), pins.runtime.treeSha256);
  const consumerRoot = join(repository, pins.consumers.root);
  const guards = await import(pathToFileURL(join(consumerRoot, 'guards.mjs')).href);
  const types = await import(pathToFileURL(join(consumerRoot, 'type-worker.mjs')).href);
  const verify = () => {
    verifyRuntimeSource(pins);
    for (const binding of [pins.runtime.seal, pins.consumers.seal, pins.consumers.verifier, pins.author.handoff, pins.author.manifest]) readBound(join(repository, binding.path), binding.sha256);
    verifier.verifyRecipe(pins.consumers.seal.sha256);
    assert.equal(runtime.integrity.jsonHash(runtime.integrity.treeSnapshot(runtimeRoot)), pins.runtime.treeSha256);
  };
  return { pins, recipe, runtime, guards, types, runtimeRoot, consumerRoot, verify };
}
