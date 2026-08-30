import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const target = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree/evidence/final-436bda3';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isFile() || entry.name.startsWith('publish-final.')) continue;
  const name = entry.name === 'consumer.mts' ? 'consumer.mts.txt' : entry.name;
  await copyFile(join(directory, entry.name), join(target, name), constants.COPYFILE_EXCL);
}
await copyFile(join(directory, 'publish-final.mjs'), join(target, 'publish-final.mjs'), constants.COPYFILE_EXCL);
await copyFile('/tmp/safe-bash-tree-final-replay-failures.txt', join(target, 'root-failure-route.txt'), constants.COPYFILE_EXCL);
await cp(join(directory, 'harness'), join(target, 'harness'), { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
await cp(join(directory, 'raw'), join(target, 'raw'), { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true,
  filter: source => !source.split('/').includes('coverage') });
const analysis = JSON.parse(await readFile(join(directory, 'analysis.json'), 'utf8'));
const loadedSources = analysis.sourceClosure.loadedCandidateFiles.filter(entry => entry.path.startsWith('src/'));
for (const entry of loadedSources) {
  const filename = join(target, 'loaded-source-data', `${entry.path}.txt`);
  await mkdir(dirname(filename), { recursive: true });
  const bytes = await readFile(join(directory, 'candidate', entry.path));
  assert.equal(hash(bytes), entry.sha256);
  await writeFile(filename, bytes, { flag: 'wx' });
}
const files = [];
async function inventory(root, prefix = '') {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = join(root, entry.name);
    const path = prefix + entry.name;
    if (entry.isDirectory()) await inventory(filename, `${path}/`);
    else {
      const bytes = entry.isSymbolicLink() ? Buffer.from(await readlink(filename)) : await readFile(filename);
      files.push({ path, kind: entry.isSymbolicLink() ? 'symlink' : 'file', bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await inventory(target);
files.sort((left, right) => left.path.localeCompare(right.path));
const manifest = { schema: 1, createdAt: new Date().toISOString(), candidate: analysis.candidate, originalPreseal: analysis.originalSeal,
  phase: 'FINAL_REPLAY_COMPLETE_AWAITING_ROOT_SEAL', original38ExactlyOnce: true, finalN18Predicate: 'peer-approved-v2',
  finalResultsSha256: analysis.resultSha256, rawPredicates: analysis.rawPredicateCounts, rawNativeLane: analysis.rawNativeLaneCounts,
  rawCoverage: 'Retained at original /tmp run paths, hashes in coverage-index.json; not duplicated in this durable manifest',
  tailArtifacts: 'Offline verification log and final detail are created after this manifest and bound by FINAL-RECEIPT.json',
  payloadSha256: hash(JSON.stringify(files)), files };
const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(target, 'FINAL-MANIFEST.json'), bytes, { flag: 'wx' });
await writeFile(join(directory, 'publication.json'), `${JSON.stringify({ target, files: files.length, payloadSha256: manifest.payloadSha256,
  manifestSha256: hash(bytes), publishedBytes: files.reduce((sum, entry) => sum + entry.bytes, 0) }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ files: files.length, manifestSha256: hash(bytes), payloadSha256: manifest.payloadSha256 }, null, 2));
