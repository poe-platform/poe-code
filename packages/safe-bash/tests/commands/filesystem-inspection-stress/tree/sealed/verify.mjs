import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const manifestPath = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree/PRESEAL-MANIFEST.json';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const inventoryBytes = await readFile(join(directory, 'inventory.json'));
assert.equal(hash(inventoryBytes), manifest.privateInventorySha256);
const inventory = JSON.parse(inventoryBytes);
assert.equal(hash(JSON.stringify(inventory)), manifest.payloadSha256);
for (const item of inventory) {
  const destination = join(directory, item.path);
  const metadata = await lstat(destination);
  assert.equal(metadata.isSymbolicLink(), item.kind === 'symlink', item.path);
  const bytes = item.kind === 'symlink' ? Buffer.from(await readlink(destination)) : await readFile(destination);
  assert.equal(bytes.length, item.bytes, item.path);
  assert.equal(hash(bytes), item.sha256, item.path);
}
assert.equal(hash(await readFile('/tmp/safe-bash-tree-holdout-prep-detail.txt')), manifest.prepDetailSha256);
console.log(JSON.stringify({ status: 'sealed-payload-verified', artifacts: inventory.length, intendedProductCases: 38, productExecutions: 0, payloadSha256: manifest.payloadSha256 }));
