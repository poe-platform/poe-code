import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(join(root, path)));
const publications = [
  ['', '645a3bc0c768987ac35cc28b3e96aee753d46397ccfad5762a494a3ce45dbc36'],
  ['corrections/HARN-SIGNAL-001', '5a816d16fc208ea52e674875c8adffd380b97bbeeebb6b4749d729dfc8488530'],
  ['corrections/HARN-SIGNAL-001-v2', 'ab56d8d344d1ecaa434f8a069392903486302e6fe3eaada23907aaf10508990d'],
  ['final-candidate-cd37ce07-ready', '48ebe095071e2f5bf1872bdc46e55adea79bc44545696b22a64daae5194353ac'],
  ['final-candidate-cd37ce07-execute', 'c5e7afc243a396c7647da28e2664bebb17fe4f618a99963858178e993f090508'],
];
let supersession;
try { supersession = await json('commit-seal/README-supersession.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (supersession) {
  assert.equal(supersession.originalPath, 'README.md');
  assert.equal(supersession.preservedPath, 'commit-seal/history/original-README.md');
  assert.equal(supersession.originalSha256, '87a3157f312e72e0d18a6041c67b21b8c543ce6fc56bf8ec21636f383d031788');
  assert.equal(hash(await readFile(join(root, 'README.md'))), supersession.navigationSha256);
}
const verified = [];
for (const [directory, expectedRoot] of publications) {
  const manifestBytes = await readFile(join(root, directory, 'PUBLICATION.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.publicationRootSha256, expectedRoot);
  assert.equal(hash(manifest.entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')), expectedRoot);
  for (const entry of manifest.entries) {
    const preserved = directory === '' && entry.path === 'README.md' && supersession;
    const path = preserved ? supersession.preservedPath : join(directory, entry.path);
    const bytes = await readFile(join(root, path));
    assert.equal(bytes.length, entry.bytes, path);
    assert.equal(hash(bytes), entry.sha256, path);
  }
  verified.push({ directory, artifactCount: manifest.entries.length, publicationRootSha256: expectedRoot, manifestSha256: hash(manifestBytes), preservedReadmeLocation: directory === '' && supersession ? supersession.preservedPath : null });
}
const preseal = await json('PRESEAL.json');
assert.equal(preseal.artifactRootSha256, '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297');
const catalogBytes = await readFile(join(root, 'sealed/catalog.json'));
assert.equal(hash(catalogBytes), preseal.privateCatalogSha256);
const catalog = JSON.parse(catalogBytes);
const opaque = catalog.artifacts.map(({ relativePath, ...entry }) => entry);
assert.deepEqual(opaque, preseal.artifacts);
assert.equal(hash(opaque.map((entry) => `${entry.id}\0${entry.type}\0${entry.bytes}\0${entry.sha256}\n`).join('')), preseal.artifactRootSha256);
const fixtureManifestEntry = catalog.artifacts.find((entry) => entry.relativePath === 'fixture-manifest.json');
const fixtures = JSON.parse(await readFile(join(root, 'sealed/artifacts', fixtureManifestEntry.id)));
const fixturePaths = new Set();
for (const entry of catalog.artifacts) {
  const path = join('sealed/artifacts', entry.id);
  const bytes = await readFile(join(root, path));
  assert.equal(bytes.length, entry.bytes, path);
  assert.equal(hash(bytes), entry.sha256, path);
  if (entry.type === 'file' && entry.relativePath.startsWith('native-fixtures/')) {
    const fixture = fixtures.find((value) => `native-fixtures/${value.filename}` === entry.relativePath)
      ?? (entry.relativePath === 'native-fixtures/denied' ? fixtures.find((value) => value.id === 'F02') : undefined);
    assert(fixture, entry.relativePath);
    assert.equal(bytes.toString('base64'), fixture.base64);
    assert.equal(hash(bytes), fixture.sha256);
    fixturePaths.add(path);
  }
}
const files = [];
const decoder = new TextDecoder('utf-8', { fatal: true });
async function visit(directory = '') {
  for (const name of (await readdir(join(root, directory))).sort()) {
    const path = join(directory, name);
    const stat = await lstat(join(root, path));
    assert(!stat.isSymbolicLink(), path);
    assert(!['node_modules', '.git', 'candidate', 'dist'].includes(name), `Vendored/source snapshot directory: ${path}`);
    if (stat.isDirectory()) await visit(path);
    else {
      assert(stat.isFile(), path);
      assert.equal(stat.mode & 0o111, 0, `Executable artifact: ${path}`);
      const bytes = await readFile(join(root, path));
      let classification = 'text-source-documentation-or-evidence';
      if (fixturePaths.has(path)) classification = 'sealed-generated-fixture-not-host-native-binary';
      else {
        const text = decoder.decode(bytes);
        assert(!text.includes('\0'), `Unclassified binary payload: ${path}`);
        assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text), `Private-key payload: ${path}`);
      }
      files.push({ path, bytes: bytes.length, sha256: hash(bytes), classification });
    }
  }
}
await visit();
let fileSeal = null;
try { fileSeal = await json('commit-seal/FILES.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (fileSeal) {
  assert.deepEqual(files.filter((entry) => entry.path !== 'commit-seal/FILES.json'), fileSeal.files);
  assert.equal(hash(fileSeal.files.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')), fileSeal.artifactRootSha256);
}
const report = { checkedAt: new Date().toISOString(), publications: verified, originalPreseal: preseal.artifactRootSha256, preservedArtifacts: catalog.artifacts.length, generatedFixtureFiles: fixturePaths.size, generatedFixtureBytes: files.filter((entry) => fixturePaths.has(entry.path)).reduce((total, entry) => total + entry.bytes, 0), scopeFiles: files.length, scopeBytes: files.reduce((total, entry) => total + entry.bytes, 0), regularFilesOnly: true, dependencyTrees: 0, executableFiles: 0, nonFixtureBinaryPayloads: 0, privateKeyMarkerMatches: 0, payloadQualification: 'All nonfixture artifacts are UTF-8 text; fixture bytes exactly match the presealed synthetic corpus (including one denied duplicate). No dependency/runtime-engine or host-native-binary payload copied; this is provenance/type checking, not general secret-scanner proof.', readmeSupersession: supersession ?? null, finalFileSealVerified: fileSeal !== null, productCalls: 0, nativeCalls: 0, testsRun: 0, files };
if (process.argv[2]) {
  const output = resolve(process.argv[2]);
  assert(output.startsWith('/tmp/') || output.startsWith('/private/tmp/'));
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ verifiedPublications: verified.length, preservedArtifacts: catalog.artifacts.length, scopeFiles: report.scopeFiles, scopeBytes: report.scopeBytes, generatedFixtureFiles: fixturePaths.size, nonFixtureBinaryPayloads: 0, finalFileSealVerified: report.finalFileSealVerified, readmeSuperseded: Boolean(supersession), productCalls: 0 }, null, 2));
