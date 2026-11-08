import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const recipe = dirname(fileURLToPath(import.meta.url));
export const scope = resolve(recipe, '..');
export const repository = resolve(scope, '../../../..');
export const prior = resolve(scope, '../public29-v1');
export const priorRecipe = join(prior, 'recipe');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = path => JSON.parse(fs.readFileSync(path));
export const priorCommit = '83645ad032238edb6d0887ae445c3b8c9d7c7f2a';
export const priorManifestSha = 'c1c45fd86a7d9e24f8d31271a09c511a234723f69bb3169025ac8e0b9ae29f51';

export function authenticatePrior() {
  assert.equal(sha(fs.readFileSync(join(prior, 'EVIDENCE-MANIFEST.json'))), priorManifestSha);
  const manifest = json(join(prior, 'EVIDENCE-MANIFEST.json'));
  const files = { ...manifest.files, 'EVIDENCE-MANIFEST.json': priorManifestSha };
  for (const [name, digest] of Object.entries(files)) {
    assert.ok(!name.startsWith('/') && !name.split('/').some(part => ['..', 'AGENTS.md'].includes(part)));
    const target = join(prior, name), stat = fs.lstatSync(target);
    assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(sha(fs.readFileSync(target)), digest, name);
  }
  return files;
}

export function decodePrior() {
  authenticatePrior();
  const inventory = json(join(prior, 'CAPTURE-INVENTORY.json'));
  const archive = fs.readFileSync(join(prior, 'captures.jsonl.gz'));
  assert.equal(sha(archive), inventory.archiveSha256); assert.equal(archive.length, 2409943);
  const rows = gunzipSync(archive, { maxOutputLength: 32 * 1024 ** 2 }).toString().trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 248); assert.equal(rows.length, inventory.entries.length);
  const retained = new Map(), wanted = new Set(['reproducible-input/candidate.tgz', 'raw/moved-P01/config.json', 'raw/moved-P01/module-loads.jsonl', 'raw/T01-tool.jsonl', 'raw/T02-tool.jsonl', 'raw/T03-tool.jsonl', 'raw/040-T01/STATUS.json', 'raw/041-T02/STATUS.json', 'raw/042-T03/STATUS.json', 'raw/042-T03/stdout.data', 'raw/042-T03/stderr.data']);
  let bytes = 0;
  for (let index = 0; index < rows.length; index++) {
    const { base64, ...record } = rows[index]; assert.deepEqual(record, inventory.entries[index]);
    const body = Buffer.from(base64, 'base64'); assert.equal(body.length, record.bytes); assert.equal(sha(body), record.sha256);
    bytes += body.length;
    if (wanted.has(record.path)) { assert.ok(!retained.has(record.path)); retained.set(record.path, body); }
  }
  assert.equal(retained.size, wanted.size); assert.equal(bytes, 7039457);
  return { retained, receipt: { archiveSha256: inventory.archiveSha256, records: rows.length, authenticatedBytes: bytes, retainedRecords: retained.size, maximumInflatedBytes: 32 * 1024 ** 2 } };
}

export function parseLines(bytes) { return bytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse); }

export function declarationClosure(entrypoint, members) {
  const pending = [entrypoint], required = {}, edges = {};
  while (pending.length) {
    const path = pending.pop(); if (Object.hasOwn(required, path)) continue;
    assert.ok(path.startsWith('dist/') && path.endsWith('.d.ts') && members.has(path), path);
    const bytes = members.get(path); required[path] = sha(bytes);
    const imports = [...bytes.toString().matchAll(/\b(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/gu)].map(match => match[1]);
    const local = imports.filter(specifier => specifier.startsWith('.')).map(specifier => {
      assert.ok(specifier.endsWith('.js'), `UNSUPPORTED_DECLARATION_REFERENCE:${path}:${specifier}`);
      const target = posix.normalize(posix.join(posix.dirname(path), specifier.slice(0, -3) + '.d.ts'));
      assert.ok(target.startsWith('dist/') && members.has(target)); return target;
    });
    edges[path] = local; pending.push(...local);
  }
  return { entrypoint, required: Object.fromEntries(Object.entries(required).sort()), edges: Object.fromEntries(Object.entries(edges).sort()) };
}
