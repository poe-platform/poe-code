import assert from 'node:assert/strict';
import { readFileSync, lstatSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function checkFile(row, path = row.path) {
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink(), path);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, row.bytes ?? bytes.length, path);
  assert.equal(hash(bytes), row.sha256, path);
  if (row.mode !== undefined) assert.equal(info.mode & 4095, row.mode, path);
  return bytes;
}
export async function guard(seal, bindings) {
  const root = dirname(seal.work);
  const expectedRoot = [...seal.files.map(row => basename(row.path)), 'PRESEAL.json', 'RUN-01', ...(existsSync(seal.work) ? ['work'] : [])];
  assert.deepEqual(readdirSync(root).sort(), expectedRoot.sort(), 'owned root new-entry check');
  assert.deepEqual(readdirSync(root + '/RUN-01').sort(), ['stdout.raw', 'stderr.raw', 'events.jsonl', 'receipt.json', 'positive.stdout.raw', 'positive.stderr.raw', 'negative-public-root.stdout.raw', 'negative-public-root.stderr.raw', 'timing.json'].sort(), 'capture membership');
  assert.equal(process.execPath, seal.node.path);
  assert.equal(process.version, seal.node.version);
  checkFile(seal.node);
  for (const row of seal.files) checkFile(row);
  for (const row of bindings.tracked) checkFile(row);
  checkFile(seal.censusModule);
  const census = await import(pathToFileURL(seal.censusModule.path).href);
  const result = [];
  for (const row of bindings.censuses) {
    const actual = census.physicalCensus(row.root);
    assert.equal(actual.length, row.entries, row.root);
    assert.equal(hash(census.canonicalBytes(actual)), row.canonicalSha256, row.root);
    result.push({ root: row.root, entries: actual.length, canonicalSha256: row.canonicalSha256, newEntryCheck: true });
  }
  for (const row of bindings.routes) checkFile(row, row.physical);
  return result;
}
