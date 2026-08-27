import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const owned = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree';
const original = '/tmp/safe-bash-tree-hidden-prep-vyzfHc';
const initial = '/tmp/safe-bash-tree-initial-run-NN3E3X';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const stage = process.argv[2];
assert.ok(stage === 'before' || stage === 'after');
const seal = await readJson(join(owned, 'PRESEAL-MANIFEST.json'));
assert.equal(seal.payloadSha256, 'b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937');
const originalInventory = await readFile(join(original, 'inventory.json'));
assert.equal(digest(originalInventory), seal.privateInventorySha256);
assert.equal(digest(JSON.stringify(JSON.parse(originalInventory))), seal.payloadSha256);
async function check(root, entries) {
  for (const entry of entries) {
    const path = join(root, entry.path);
    const info = await lstat(path);
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    assert.equal(digest(bytes), entry.sha256, path);
  }
}
await check(original, JSON.parse(originalInventory));
const evidenceManifest = await readFile(join(owned, 'EVIDENCE-MANIFEST.json'));
assert.equal(digest(evidenceManifest), '66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01');
const evidence = JSON.parse(evidenceManifest);
assert.equal(digest(JSON.stringify(evidence.entries)), evidence.payloadSha256);
await check(owned, evidence.entries);
const rawEntries = evidence.entries.filter((entry) => entry.path.startsWith('evidence/initial/raw/'))
  .map((entry) => ({ ...entry, path: entry.path.slice('evidence/initial/'.length) }));
await check(initial, rawEntries);
const coverage = await readJson(join(owned, 'evidence/initial/coverage-file-index.json'));
for (const entry of coverage) assert.equal(digest(await readFile(entry.retainedPath)), entry.sha256, entry.retainedPath);
const inputs = await readFile(join(initial, 'full-input-files.json'));
assert.equal(digest(inputs), 'ef040b94780aa38b5483d5d1c2f9d263e4396cc8a0d881255665080992cce1e8');
await check(join(initial, 'candidate'), JSON.parse(inputs));
assert.equal(digest(await readFile(join(initial, 'initial-results.json'))), 'a1cde249bbe1fa2e9a8f049d848a28d12741a3305c0865056d956dba6ff04498');
const result = { stage, checkedAt: new Date().toISOString(), originalPreseal: seal.payloadSha256,
  originalPrivateArtifacts: 97, originalDurableArtifacts: evidence.entries.length, originalRawFiles: rawEntries.length,
  originalCoverageFiles: coverage.length, frozenInputFiles: JSON.parse(inputs).length,
  frozenSourceManifest: '81eddab7060fcc67dfcf5adc325218b886a4fb50d7e40a1056ad9fe379e83a9a',
  frozenFullInputManifest: digest(inputs), allUnchanged: true, productCalls: 0, nativeCalls: 0 };
await writeFile(join(directory, `audit-${stage}.json`), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(result));
