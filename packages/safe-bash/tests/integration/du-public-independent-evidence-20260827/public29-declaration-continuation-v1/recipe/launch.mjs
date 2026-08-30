import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = fs.readFileSync(join(directory, 'MANIFEST.json'));
assert.match(process.argv[2] ?? '', /^[a-f0-9]{40}$/u);
assert.equal(hash(manifestBytes), process.argv[3]);
const manifest = JSON.parse(manifestBytes);
for (const [name, digest] of Object.entries(manifest.files)) {
  assert.ok(!name.startsWith('/') && !name.split('/').some(part => ['', '..', '.', 'AGENTS.md'].includes(part)));
  const target = join(directory, name);
  assert.ok(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink());
  assert.equal(hash(fs.readFileSync(target)), digest, name);
}
const priorDirectory = join(directory, '../../public29-v1');
assert.equal(hash(fs.readFileSync(join(priorDirectory, 'EVIDENCE-MANIFEST.json'))), 'c1c45fd86a7d9e24f8d31271a09c511a234723f69bb3169025ac8e0b9ae29f51');
const priorManifest = JSON.parse(fs.readFileSync(join(priorDirectory, 'EVIDENCE-MANIFEST.json')));
for (const [name, digest] of Object.entries(priorManifest.files)) assert.equal(hash(fs.readFileSync(join(priorDirectory, name))), digest, name);
const bindings = JSON.parse(fs.readFileSync(join(priorDirectory, 'recipe/BINDINGS.json')));
for (const binary of bindings.binaries) {
  assert.equal(fs.realpathSync(binary.path), binary.realpath);
  assert.equal(hash(fs.readFileSync(binary.path)), binary.sha256, binary.path);
}
assert.equal(process.execPath, bindings.binaries[0].path);
assert.equal(process.version, 'v22.22.2');
await import('./executor.mjs');
