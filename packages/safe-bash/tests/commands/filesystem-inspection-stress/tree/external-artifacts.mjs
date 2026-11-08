import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const action = process.argv[2];
assert.ok(['--verify', '--restore'].includes(action) && process.argv.length === 3, 'usage: node external-artifacts.mjs --verify|--restore');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function readBounded(filename) {
  const info = await lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink(), filename);
  assert.ok(info.size <= 8 * 1024 * 1024, `file exceeds 8MiB: ${filename}`);
  const bytes = await readFile(filename);
  assert.equal(bytes.length, info.size, filename);
  return bytes;
}
const map = JSON.parse(await readBounded(join(root, 'EXTERNAL-ARTIFACTS.json')));
assert.equal(map.artifacts.length, 2);
const overrides = new Map();
for (const artifact of map.artifacts) {
  const source = process.env.TREE_EXTERNAL_ORACLE_DIR ? join(process.env.TREE_EXTERNAL_ORACLE_DIR, artifact.externalBasename) : artifact.externalPath;
  const bytes = await readBounded(source);
  const info = await lstat(source);
  assert.equal(bytes.length, artifact.bytes, source);
  assert.equal(hash(bytes), artifact.sha256, source);
  assert.equal(info.mode & 0o7777, Number.parseInt(artifact.modeOctal, 8), source);
  await assert.rejects(lstat(join(root, artifact.repositoryRelativePath)), error => error.code === 'ENOENT', 'external payload must not be restored in main corpus');
  overrides.set(artifact.repositoryRelativePath, { ...artifact, source });
}
const bindings = [
  ['EVIDENCE-MANIFEST.json', 'entries', '66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01'],
  ['corrections/n18-positive-depth/CORRECTION-MANIFEST.json', 'files', '18cb04609766ba7ee13a8f2d6a5d41094ebe58e63cdffb298f61f12c81c9d5d6'],
  ['corrections/n18-positive-depth-v2/V2-MANIFEST.json', 'files', '211a071d5e78a66791b37790804bbe6fa5cb737fafc052c00529a8d4d282602d'],
  ['evidence/final-436bda3/FINAL-MANIFEST.json', 'files', 'f5d0e4c69a0c7d797e77b0af89a6cc471ce4f39496a747a56d0d682597839d7b'],
  ['evidence/final-436bda3/FINAL-RECEIPT.json', 'files', '24bdcd1d829a2d112cefae87a83a292c3c9b9850255ad017dbf798bd0d4d51e8'],
];
async function verifyCorpus(base, external) {
  const counts = { repositoryReferences: 0, externalReferences: 0 };
  async function verifyEntries(parent, entries) {
    for (const entry of entries) {
      const filename = join(parent, entry.path);
      const mapped = external.get(relative(base, filename));
      const actual = mapped?.source ?? filename;
      const info = await lstat(actual);
      assert.equal(info.isSymbolicLink(), entry.kind === 'symlink', actual);
      const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(actual)) : await readBounded(actual);
      assert.equal(bytes.length, entry.bytes, actual);
      assert.equal(hash(bytes), entry.sha256, actual);
      counts[mapped ? 'externalReferences' : 'repositoryReferences']++;
    }
  }
  const manifests = [];
  for (const [path, key, expected] of bindings) {
    const filename = join(base, path);
    const bytes = await readBounded(filename);
    assert.equal(hash(bytes), expected, path);
    const manifest = JSON.parse(bytes);
    assert.equal(hash(JSON.stringify(manifest[key])), manifest.payloadSha256, path);
    await verifyEntries(dirname(filename), manifest[key]);
    manifests.push({ path, entries: manifest[key].length, sha256: expected });
  }
  const inventoryBytes = await readBounded(join(base, 'sealed/inventory.json'));
  assert.equal(hash(inventoryBytes), '7080fc3c3dd527e2b49183b365253ae9ddd38f78672de5f97623ace661a976fa');
  const inventory = JSON.parse(inventoryBytes);
  assert.equal(hash(JSON.stringify(inventory)), map.originalPresealPayload);
  await verifyEntries(join(base, 'sealed'), inventory);
  return { ...counts, manifests, originalInventoryReferences: inventory.length, missingInputs: 0 };
}
const verification = await verifyCorpus(root, overrides);
const report = { action, verification, externalPrerequisites: map.artifacts.map(artifact => ({ path: artifact.repositoryRelativePath, sha256: artifact.sha256 })),
  repositoryContainsAllInputs: false, nativeCalls: 0, productCalls: 0, testReplays: 0 };
if (action === '--restore') {
  const destination = await mkdtemp(join(await realpath('/tmp'), 'safe-bash-tree-restored-'));
  const counts = { entries: 0, directories: 0, bytes: 0 };
  async function copyCorpus(source, target) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const input = join(source, entry.name);
      const output = join(target, entry.name);
      if (entry.isDirectory()) {
        assert.ok(++counts.directories <= 256, 'directory cap');
        await mkdir(output, { mode: 0o700 });
        await copyCorpus(input, output);
      } else {
        assert.ok(++counts.entries <= 1024, 'file/symlink entry cap');
        if (entry.isSymbolicLink()) {
          const link = await readlink(input);
          const resolved = resolve(dirname(output), link);
          assert.ok(!isAbsolute(link) && (resolved === destination || resolved.startsWith(destination + sep)), 'fixture symlink escapes copied corpus');
          counts.bytes += Buffer.byteLength(link);
          assert.ok(counts.bytes <= 32 * 1024 * 1024, 'total byte cap');
          await symlink(link, output);
        } else {
          const bytes = await readBounded(input);
          counts.bytes += bytes.length;
          assert.ok(counts.bytes <= 32 * 1024 * 1024, 'total byte cap');
          await writeFile(output, bytes, { flag: 'wx', mode: (await lstat(input)).mode & 0o777 });
          await chmod(output, (await lstat(input)).mode & 0o777);
        }
      }
    }
  }
  try {
    await copyCorpus(root, destination);
    for (const artifact of overrides.values()) {
      const bytes = await readBounded(artifact.source);
      assert.equal(hash(bytes), artifact.sha256);
      assert.ok(++counts.entries <= 1024 && (counts.bytes += bytes.length) <= 32 * 1024 * 1024);
      const output = join(destination, artifact.repositoryRelativePath);
      await writeFile(output, bytes, { flag: 'wx', mode: Number.parseInt(artifact.modeOctal, 8) });
      await chmod(output, Number.parseInt(artifact.modeOctal, 8));
      assert.equal((await lstat(output)).nlink, 1);
    }
    report.restoredDirectory = destination;
    report.restoredVerification = await verifyCorpus(destination, new Map());
    report.copied = counts;
  } catch (error) {
    console.error(JSON.stringify({ status: 'INCOMPLETE_RESTORE', directory: destination }));
    throw error;
  }
}
console.log(JSON.stringify(report, null, 2));
