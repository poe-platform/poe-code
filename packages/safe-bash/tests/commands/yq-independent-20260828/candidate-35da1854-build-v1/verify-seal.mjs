import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(process.argv.length, 3);
assert.match(process.argv[2], /^[a-f0-9]{64}$/u);
assert.equal(realpathSync(root), root);
for (let ancestor = root; ; ancestor = dirname(ancestor)) {
  assert(!lstatSync(ancestor).isSymbolicLink());
  if (ancestor === dirname(ancestor)) break;
}
const sealPath = join(root, 'FINAL-SEAL.json');
const raw = readFileSync(sealPath);
const metadata = lstatSync(sealPath);
assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1);
assert.equal(metadata.mode & 4095, 420);
assert.equal(hash(raw), process.argv[2]);
const seal = JSON.parse(raw);
assert.equal(lstatSync(root).mode & 4095, seal.rootMode);
const names = readdirSync(root).filter(name => name !== 'FINAL-SEAL.json').sort();
assert.deepEqual(names, Object.keys(seal.files).sort());
for (const name of names) {
  const path = join(root, name);
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  const bytes = readFileSync(path);
  assert.deepEqual({ sha256: hash(bytes), bytes: bytes.length, mode: stat.mode & 4095 }, seal.files[name]);
}
assert.deepEqual(readdirSync(root).filter(name => name !== 'FINAL-SEAL.json').sort(), names);
console.log(JSON.stringify({ status: 'INDEPENDENT_BUILD_PACKET_SEAL_VERIFIED_NOT_RUNTIME_ACCEPTANCE', files: names.length, finalSealSha256: process.argv[2], productExecution: 0, additionalCompilerRuns: 0 }));
