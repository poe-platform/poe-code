import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { owned, hash, inventory, verifyInputs } from './integrity-v2.mjs';

const mode = process.argv[2] ?? '--verify';
const name = process.argv[3] ?? 'SEAL.json';
assert(['--verify', '--capture'].includes(mode));
assert(/^[A-Za-z0-9-]+\.json$/u.test(name));
assert(process.argv.length <= 4);
const path = join(owned, name);
const entries = inventory(owned);
delete entries[name];
if (mode === '--capture') {
  assert(process.argv[3], 'new seal filename must be explicit');
  assert(!existsSync(path), 'refusing to overwrite seal');
  writeFileSync(path, `${JSON.stringify({ sealedAt: new Date().toISOString(), entries, inputs: verifyInputs(), appendAware: true, excluded: [name] }, null, 2)}\n`, { flag: 'wx' });
} else {
  const sealed = JSON.parse(readFileSync(path));
  assert.deepEqual(entries, sealed.entries, 'author evidence entry set or bytes changed');
  assert.deepEqual(verifyInputs(), sealed.inputs);
}
console.log(JSON.stringify({ mode, seal: name, sha256: hash(readFileSync(path)), entries: Object.keys(entries).length, appendAware: true }));
