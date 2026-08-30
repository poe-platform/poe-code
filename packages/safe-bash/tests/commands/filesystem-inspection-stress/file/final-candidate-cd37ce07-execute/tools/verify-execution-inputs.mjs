import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const owned = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(path));
const freeze = await json(join(root, 'freeze.json'));
const build = await json(join(root, 'build.json'));
assert.equal(freeze.commit, 'cd37ce07c1f41f3797e19e0f701b662823338843');
assert.equal(freeze.sourceSha256, 'f9276a3524347ec20030d41c25d2d5bc033471437b7a9749094585b17693ce0c');
assert.equal(freeze.dependencySha256, 'cda0820b8443488b19d0747cb97de37f8aec7492747bff286705a33f6026402e');
assert.equal(build.status, 0);
const files = [...freeze.files, ...freeze.dependencies, ...build.files];
const actualPaths = [];
const candidate = join(root, 'candidate');
async function visit(directory = candidate) {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const stat = await lstat(path);
    assert(!stat.isSymbolicLink(), path);
    assert.equal(await realpath(path), path);
    if (stat.isDirectory()) await visit(path);
    else {
      assert(stat.isFile(), path);
      assert.equal(stat.nlink, 1, path);
      assert.equal(stat.mode & 0o222, 0, path);
      actualPaths.push(relative(candidate, path));
    }
  }
}
await visit();
assert.deepEqual(actualPaths.sort(), files.map((entry) => entry.path).sort());
for (const entry of files) {
  const bytes = await readFile(join(candidate, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
const publications = [];
for (const [path, expected] of [
  ['', '645a3bc0c768987ac35cc28b3e96aee753d46397ccfad5762a494a3ce45dbc36'],
  ['corrections/HARN-SIGNAL-001', '5a816d16fc208ea52e674875c8adffd380b97bbeeebb6b4749d729dfc8488530'],
  ['corrections/HARN-SIGNAL-001-v2', 'ab56d8d344d1ecaa434f8a069392903486302e6fe3eaada23907aaf10508990d'],
  ['final-candidate-cd37ce07-ready', '48ebe095071e2f5bf1872bdc46e55adea79bc44545696b22a64daae5194353ac'],
]) {
  const manifest = await json(join(owned, path, 'PUBLICATION.json'));
  assert.equal(manifest.publicationRootSha256, expected);
  assert.equal(hash(manifest.entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')), expected);
  for (const entry of manifest.entries) {
    const bytes = await readFile(join(owned, path, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(hash(bytes), entry.sha256, entry.path);
  }
  publications.push({ path, artifactCount: manifest.entries.length, publicationRootSha256: expected });
}
const preseal = await json(join(owned, 'PRESEAL.json'));
assert.equal(preseal.artifactRootSha256, '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297');
const catalogBytes = await readFile(join(root, 'holdout/seal-catalog.json'));
assert.equal(hash(catalogBytes), preseal.privateCatalogSha256);
const catalog = JSON.parse(catalogBytes);
for (const directory of [join(root, 'holdout'), '/tmp/safe-bash-file-holdout.KyVGrl0A']) {
  for (const entry of catalog.artifacts) {
    const path = join(directory, entry.relativePath);
    const stat = await lstat(path);
    assert(entry.type === 'symlink-target' ? stat.isSymbolicLink() : stat.isFile(), path);
    const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(path)) : await readFile(path);
    assert.equal(bytes.length, entry.bytes, path);
    assert.equal(hash(bytes), entry.sha256, path);
  }
}
const runnerSha256 = hash(await readFile(join(root, 'holdout/v2-runner.mjs')));
assert.equal(runnerSha256, 'de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756');
const lock = await json(join(candidate, 'package-lock.json'));
const installed = await json(join(candidate, 'node_modules/.package-lock.json'));
for (const [path, entry] of Object.entries(installed.packages)) {
  if (!path) continue;
  assert.equal(entry.version, lock.packages[path].version);
  assert.equal(entry.integrity, lock.packages[path].integrity);
  assert.equal((await json(join(candidate, path, 'package.json'))).version, entry.version);
}
const evidence = { checkedAt: new Date().toISOString(), commit: freeze.commit, sourceSha256: freeze.sourceSha256, dependencySha256: freeze.dependencySha256, regularReadonlyUnaliasedFiles: files.length, sealedPrivateArtifacts: catalog.artifacts.length, restoredArtifacts: catalog.artifacts.length, publications, runnerSha256, buildReusedNotRerun: true, allHashesVerified: true };
await writeFile(join(root, process.argv[2] ?? 'execution-preflight.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(evidence, null, 2));
