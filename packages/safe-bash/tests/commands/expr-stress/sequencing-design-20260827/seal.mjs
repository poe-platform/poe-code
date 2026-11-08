import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory() {
  const files = {};
  function walk(directory, relative = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relative && ['.scratch', 'SEAL.json'].includes(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      assert(!entry.isSymbolicLink(), `unexpected evidence symlink ${name}`);
      if (entry.isDirectory()) walk(join(directory, entry.name), name);
      else files[name] = sha256(readFileSync(join(directory, entry.name)));
    }
  }
  walk(owned);
  return files;
}
if (process.argv[2] === '--capture') {
  writeFileSync(join(owned, 'SEAL.json'), `${JSON.stringify({ sealedAt: new Date().toISOString(), baseline: '21220b465537bf45ffcfb36740956a69f43bf75e', freezeCommit: 'e9ff18dc', architectureApproved: false, filesSha256: inventory(), policy: 'Verify all original files plus new entries; only SEAL.json itself and owned .scratch extraction area excluded.' }, null, 2)}\n`, { flag: 'wx' });
} else if (process.argv[2] === '--verify') {
  const seal = JSON.parse(readFileSync(join(owned, 'SEAL.json')));
  assert.deepEqual(inventory(), seal.filesSha256, 'evidence modification/deletion/addition');
  console.log(JSON.stringify({ verified: true, files: Object.keys(seal.filesSha256).length, appendAware: true }));
} else throw new Error('Use --verify (readonly) or --capture (create once).');
