import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const owned = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const publications = [
  ['', '645a3bc0c768987ac35cc28b3e96aee753d46397ccfad5762a494a3ce45dbc36'],
  ['corrections/HARN-SIGNAL-001', '5a816d16fc208ea52e674875c8adffd380b97bbeeebb6b4749d729dfc8488530'],
  ['corrections/HARN-SIGNAL-001-v2', 'ab56d8d344d1ecaa434f8a069392903486302e6fe3eaada23907aaf10508990d'],
];
const verified = [];
for (const [directory, expected] of publications) {
  const bytes = await readFile(join(owned, directory, 'PUBLICATION.json'));
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.publicationRootSha256, expected);
  for (const entry of manifest.entries) {
    const path = join(owned, directory, entry.path);
    assert((await lstat(path)).isFile(), path);
    const artifact = await readFile(path);
    assert.equal(artifact.length, entry.bytes, path);
    assert.equal(hash(artifact), entry.sha256, path);
  }
  assert.equal(hash(manifest.entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')), expected);
  verified.push({ directory, files: manifest.entries.length, publicationRootSha256: expected, manifestSha256: hash(bytes) });
}
const preseal = JSON.parse(await readFile(join(owned, 'PRESEAL.json')));
assert.equal(preseal.artifactRootSha256, '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297');
const catalogBytes = await readFile(join(owned, 'sealed/catalog.json'));
assert.equal(hash(catalogBytes), preseal.privateCatalogSha256);
const catalog = JSON.parse(catalogBytes);
assert.equal(catalog.artifacts.length, 54);
for (const entry of catalog.artifacts) {
  const bytes = await readFile(join(owned, 'sealed/artifacts', entry.id));
  assert.equal(bytes.length, entry.bytes, entry.id);
  assert.equal(hash(bytes), entry.sha256, entry.id);
}
const runnerPath = join(owned, 'corrections/HARN-SIGNAL-001-v2/runner/v2-runner.mjs');
const runnerSha256 = hash(await readFile(runnerPath));
assert.equal(runnerSha256, 'de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756');
const evidence = { checkedAt: new Date().toISOString(), verified, sealedArtifacts: 54, originalPreseal: preseal.artifactRootSha256, runnerPath, runnerSha256, productCalls: 0, nativeCalls: 0 };
await writeFile(join(root, process.argv[2] ?? 'history-before.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(evidence, null, 2));
