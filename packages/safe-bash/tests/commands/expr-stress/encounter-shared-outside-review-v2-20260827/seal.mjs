import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory(directory = owned, prefix = '') {
  const entries = {};
  for (const name of readdirSync(directory).sort()) {
    if (!prefix && name === 'SEAL.json') continue;
    const path = join(directory, name), filename = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) { entries[filename] = { kind: 'directory' }; Object.assign(entries, inventory(path, filename)); }
    else entries[filename] = { kind: 'file', bytes: stat.size, sha256: hash(readFileSync(path)) };
  }
  return entries;
}
const mode = process.argv[2];
assert(mode === '--seal' || mode === '--verify');
const candidate = JSON.parse(readFileSync(join(owned, 'candidate-01/candidate.json')));
assert.equal(hash(execFileSync('git', ['archive', '--format=tar', candidate.candidate, ...candidate.selected], { cwd: root, maxBuffer: 128 * 1024 * 1024 })), candidate.archiveSha256);
const freeze = JSON.parse(readFileSync(join(owned, 'candidate-01/FREEZE.json')));
assert.equal(hash(readFileSync(join(owned, 'candidate-01/CORRECTION-MANIFEST.json'))), freeze.manifestSha256);
const entries = inventory();
if (mode === '--seal') writeFileSync(join(owned, 'SEAL.json'), `${JSON.stringify({ sealedAt: new Date().toISOString(), candidate: candidate.candidate, entries, appendAware: true }, null, 2)}\n`, { flag: 'wx' });
else assert.deepEqual(entries, JSON.parse(readFileSync(join(owned, 'SEAL.json'))).entries);
console.log(JSON.stringify({ mode, candidate: candidate.candidate, files: Object.values(entries).filter(entry => entry.kind === 'file').length, appendAware: true }));
