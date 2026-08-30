import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = JSON.parse(await readFile(join(directory, 'full-input-files.json'), 'utf8'));
const inputByPath = new Map(inputs.map(entry => [entry.path, entry]));
const build = JSON.parse(await readFile(join(directory, 'build-input-files.json'), 'utf8'));
const buildByPath = new Map(build.map(entry => [entry.path, entry]));
const canonical = inputs.filter(entry => /^(src\/commands\/tree|tests\/commands\/tree)\/.*\.ts$/u.test(entry.path));
const groups = [];
for (const filename of ['scoped-types.stdout.txt', 'consumer-types.stdout.txt']) {
  const paths = (await readFile(join(directory, filename), 'utf8')).trim().split('\n');
  const checked = [];
  for (const path of paths) {
    const resolved = await realpath(path);
    const relativePath = relative(directory, resolved);
    const entry = relativePath.startsWith('candidate/') ? inputByPath.get(relativePath.slice('candidate/'.length)) : buildByPath.get(relativePath);
    const digest = hash(await readFile(resolved));
    if (entry) assert.equal(digest, entry.sha256, relativePath);
    else assert.equal(relativePath, 'consumer.mts');
    checked.push({ path: relativePath, sha256: digest });
  }
  groups.push({ log: filename, checked });
}
const checkedCanonical = new Set(groups[0].checked.map(entry => entry.path.replace(/^candidate\//u, '')));
const missingCanonical = canonical.filter(entry => !checkedCanonical.has(entry.path));
assert.equal(missingCanonical.length, 0);
await writeFile(join(directory, 'compiler-input-closure.json'), `${JSON.stringify({ at: new Date().toISOString(), canonicalOwnedTsCount: canonical.length,
  canonicalOwnedTs: canonical, missingCanonical, groups, policy: 'Successful actual compiler input lists checked, not inventory-only inference; no full-project gate' }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ canonicalOwnedTs: canonical.length, scopedCompilerInputs: groups[0].checked.length, consumerCompilerInputs: groups[1].checked.length, missingCanonical: 0 }));
