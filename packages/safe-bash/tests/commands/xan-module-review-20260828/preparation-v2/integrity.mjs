import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const REPO = path.resolve(ROOT, '../../../..');

async function identity(filename, expected) {
  const stat = await lstat(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, expected.bytes); assert.equal((stat.mode & 0o777).toString(8).padStart(3, '0'), expected.mode ?? '644');
  const digest = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(filename, { highWaterMark: 65536 })) { size += chunk.length; assert.ok(size <= expected.bytes); digest.update(chunk); }
  assert.equal(size, expected.bytes); assert.equal(digest.digest('hex'), expected.sha256, `sealed bytes ${filename}`);
}

export async function verifyRecipe() {
  const seal = JSON.parse(await readFile(path.join(ROOT, 'RECIPE-SEAL.json'), 'utf8'));
  assert.equal(seal.schema, 'xan-preparation-v2-seal');
  for (const entry of seal.files) await identity(path.join(ROOT, entry.path), entry);
  for (const entry of seal.helpers) await identity(path.join(ROOT, entry.path), entry);
  for (const tool of seal.tools) await identity(tool.path, tool);
  return seal;
}

export async function frozenDocuments(seal) {
  const { gitBytes } = await import('../supervisor.mjs');
  const documents = {};
  for (const entry of seal.inputs) {
    assert.ok(entry.path.startsWith('tests/commands/xan-independent-20260828/'), 'no XAN source inspection');
    const raw = await gitBytes(['show', `${entry.commit}:${entry.path}`], entry.bytes, REPO);
    assert.equal(raw.length, entry.bytes); assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
    if (entry.path.endsWith('.json')) documents[entry.path.slice('tests/commands/xan-independent-20260828/'.length)] = JSON.parse(raw.toString('utf8'));
  }
  return documents;
}

export async function verifyCommitted(recipeCommit) {
  assert.match(recipeCommit, /^[a-f0-9]{40}$/);
  const { gitBytes } = await import('../supervisor.mjs');
  const current = await readFile(path.join(ROOT, 'RECIPE-SEAL.json'));
  const pinned = await gitBytes(['show', `${recipeCommit}:tests/commands/xan-module-review-20260828/preparation-v2/RECIPE-SEAL.json`], current.length, REPO);
  assert.deepEqual(current, pinned);
  return verifyRecipe();
}
