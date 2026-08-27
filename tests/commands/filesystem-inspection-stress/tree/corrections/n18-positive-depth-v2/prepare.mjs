import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const base = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree';
const v1 = join(base, 'corrections/n18-positive-depth');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function verify(root, entries) {
  for (const entry of entries) {
    const path = join(root, entry.path);
    const bytes = (await lstat(path)).isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    assert.equal(hash(bytes), entry.sha256, path);
  }
}
const originalManifest = await readFile(join(base, 'EVIDENCE-MANIFEST.json'));
assert.equal(hash(originalManifest), '66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01');
await verify(base, JSON.parse(originalManifest).entries);
const v1Manifest = await readFile(join(v1, 'CORRECTION-MANIFEST.json'));
assert.equal(hash(v1Manifest), '18cb04609766ba7ee13a8f2d6a5d41094ebe58e63cdffb298f61f12c81c9d5d6');
await verify(v1, JSON.parse(v1Manifest).files);
const seal = JSON.parse(await readFile(join(base, 'PRESEAL-MANIFEST.json'), 'utf8'));
const originalPrivate = '/tmp/safe-bash-tree-hidden-prep-vyzfHc';
const inventory = await readFile(join(originalPrivate, 'inventory.json'));
assert.equal(hash(inventory), seal.privateInventorySha256);
assert.equal(hash(JSON.stringify(JSON.parse(inventory))), seal.payloadSha256);
await verify(originalPrivate, JSON.parse(inventory));
await mkdir(join(directory, 'history'), { recursive: true });
await mkdir(join(directory, 'derived'), { recursive: true });
const copies = [
  [join(v1, 'n18-predicate.mjs'), 'history/v1-predicate.mjs'],
  [join(v1, 'n18-predicate.mjs'), 'n18-predicate.mjs'],
  [join(v1, 'predicate.test.mjs'), 'predicate.test.mjs'],
  [join(v1, 'original-run.mjs'), 'original-run.mjs'],
  [join(v1, 'corrected-result.json'), 'history/v1-corrected-result.json'],
  [join(v1, 'raw/N18/observations.json'), 'history/v1-N18-observations.json'],
  [join(v1, 'raw/N18/stdout.txt'), 'history/v1-N18-predicate-result.stdout.txt'],
  [join(base, 'evidence/initial/raw/N18/observations.json'), 'history/initial-N18-observations.json'],
  [join(base, 'evidence/initial/raw/N18/stdout.txt'), 'history/initial-N18-regex-failure.stdout.txt'],
  [join(base, 'PRESEAL-MANIFEST.json'), 'history/PRESEAL-MANIFEST.json'],
  [join(base, 'evidence/initial/initial-results.json'), 'history/initial-results.json'],
  [join(v1, 'CORRECTION-MANIFEST.json'), 'history/v1-CORRECTION-MANIFEST.json'],
  ['/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/harness-review/correction-counterchecks.mjs', 'history/peer-counterchecks.original.mjs.txt'],
  ...['run.mjs', 'corpus.mjs', 'fixture-fs.mjs', 'native.json'].map((name) => [join(v1, 'derived', name), `derived/${name}`]),
];
for (const [source, target] of copies) await copyFile(source, join(directory, target), constants.COPYFILE_EXCL);
await writeFile(join(directory, 'preservation-before.json'), `${JSON.stringify({ at: new Date().toISOString(), originalPreseal: seal.payloadSha256,
  originalManifestSha256: hash(originalManifest), v1ManifestSha256: hash(v1Manifest), originalDurableArtifactsVerified: 316,
  v1ArtifactsVerified: 35, originalPrivateArtifactsVerified: 97, preservedCopies: copies.map(([, target]) => target),
  sourceInspection: 'No current candidate implementation or in-progress safety fix inspected; old captured bytes and harness files only', productExecutions: 0, nativeExecutions: 0 }, null, 2)}\n`, { flag: 'wx' });
console.log('Original 316 artifacts, v1 35 artifacts, and 97 private preseal artifacts verified; pure-harness copies prepared.');
