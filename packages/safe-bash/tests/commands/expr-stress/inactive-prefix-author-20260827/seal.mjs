import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory(directory, prefix = '', result = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!prefix && ['SEAL.json', '.scratch'].includes(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `unexpected evidence symlink: ${relative}`);
    if (entry.isDirectory()) inventory(join(directory, entry.name), relative, result);
    else result[relative] = sha256(readFileSync(join(directory, entry.name)));
  }
  return result;
}
if (process.argv[2] === '--capture') {
  writeFileSync(join(owned, 'SEAL.json'), `${JSON.stringify({
    sealedAt: new Date().toISOString(), baselineCommit: '875b0fb0e5fcc60e6ddd3947710779fc1fc74cea',
    sourceCommit: '4f01c1593486c1abff3b007f9a3b16923b88559f', files: inventory(owned),
    policy: 'Append-aware evidence inventory; only SEAL.json itself and owned .scratch extraction area excluded.',
  }, null, 2)}\n`, { flag: 'wx' });
} else {
  assert.equal(process.argv[2], '--verify', 'use --verify (read only) or --capture (create once)');
  const receipt = JSON.parse(readFileSync(join(owned, 'SEAL.json')));
  assert.deepEqual(inventory(owned), receipt.files, 'evidence modifications/deletions/additions');
  console.log(JSON.stringify({ verified: true, files: Object.keys(receipt.files).length, appendAware: true }));
}
