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

function coreEntries() {
  const entries = [];
  let total = 0;
  const visit = (path, prefix) => {
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink());
    assert(entries.length < 200);
    if (stat.isDirectory()) {
      entries.push({ path: prefix || '.', kind: 'directory', mode: stat.mode & 4095 });
      for (const name of readdirSync(path).sort()) visit(join(path, name), prefix ? `${prefix}/${name}` : name);
    } else {
      assert(stat.isFile() && stat.nlink === 1 && stat.size <= 2097152);
      total += stat.size;
      assert(total <= 8388608);
      const bytes = readFileSync(path);
      entries.push({ path: prefix, kind: 'file', mode: stat.mode & 4095, bytes: bytes.length, sha256: hash(bytes) });
    }
  };
  assert.equal(realpathSync(coreRoot), coreRoot);
  visit(coreRoot, '');
  return entries;
}

export function verifyIntegration(sealPath, sealSha256) {
  const seal = JSON.parse(readBound(sealPath, sealSha256));
  assert.equal(seal.schema, 1);
  assert.equal(seal.kind, 'YQ_COMPOUND_INTEGRATION_PRESEAL');
  assert.equal(jsonHash(coreEntries()), seal.coreTreeSha256, 'Integration core membership/hash/modes');
  return seal;
}

export async function loadComponents() {
  const pins = readJson(join(coreRoot, 'COMPONENTS.json'));
  const recipe = readJson(join(coreRoot, 'RECIPE.json'));
  for (const binding of [pins.runtime.seal, pins.consumers.seal, pins.consumers.verifier, pins.author.handoff, pins.author.manifest, ...pins.runtime.files]) readBound(join(repository, binding.path), binding.sha256);
  const verifier = await import(pathToFileURL(join(repository, pins.consumers.verifier.path)).href);
  verifier.verifyRecipe(pins.consumers.seal.sha256);
  const runtimeRoot = join(framework, 'runtime', 'recipe');
  const runtime = {};
  for (const name of ['integrity', 'host', 'authorization', 'fixtures', 'context', 'assert-capture']) runtime[name] = await import(pathToFileURL(join(runtimeRoot, `${name}.mjs`)).href);
  assert.equal(runtime.integrity.jsonHash(runtime.integrity.treeSnapshot(runtimeRoot)), pins.runtime.treeSha256);
  const consumerRoot = join(framework, 'consumers');
  const guards = await import(pathToFileURL(join(consumerRoot, 'guards.mjs')).href);
  const types = await import(pathToFileURL(join(consumerRoot, 'type-worker.mjs')).href);
  const verify = () => {
    for (const binding of [pins.runtime.seal, pins.consumers.seal, pins.consumers.verifier, pins.author.handoff, pins.author.manifest]) readBound(join(repository, binding.path), binding.sha256);
    verifier.verifyRecipe(pins.consumers.seal.sha256);
    assert.equal(runtime.integrity.jsonHash(runtime.integrity.treeSnapshot(runtimeRoot)), pins.runtime.treeSha256);
  };
  return { pins, recipe, runtime, guards, types, runtimeRoot, consumerRoot, verify };
}
