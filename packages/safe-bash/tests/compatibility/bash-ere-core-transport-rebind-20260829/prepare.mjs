import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const owned = process.argv[2];
assert.equal(owned, 'tests/compatibility/bash-ere-core-transport-rebind-20260829');
const parent = 'tests/compatibility/bash-ere-runtime-integration-author-20260829/rebind-v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => { const stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= 16 * 1048576); const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); return bytes; };
const save = (name, value) => fs.writeFileSync(owned + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sourceRaw = read(parent + '/SOURCE.json'), source = JSON.parse(sourceRaw);
const tools = JSON.parse(read(parent + '/TOOLS.json'));
const producerSeal = JSON.parse(read(parent + '/producer-v2/SEAL.json'));
const producerResult = JSON.parse(read(parent + '/producer-v2/RESULT.json'));
assert.equal(source.selectedCount, 305);
assert.equal(source.selectedTree, 'da4e1cc187022255521879b00db2ac77674f79d9');
const overlays = ['src/commands/regex-execution/ere/transport/owner.ts', 'src/commands/regex-execution/ere/transport/root.ts'];
const gitEnv = { PATH: '/usr/bin:/bin', HOME: path.resolve(owned), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', LANG: 'C' };
const git = arguments_ => execFileSync('/usr/bin/git', arguments_, { env: gitEnv, maxBuffer: 16 * 1048576 });
const treeRaw = git(['ls-tree', '-rz', '4abbdeec8e34de88ed2cf7bd32be9c06b413c631', '--', ...overlays]);
const overlayRows = treeRaw.toString().split('\0').filter(Boolean).map(record => {
  const match = /^(100644) blob ([a-f0-9]{40})\t(.+)$/.exec(record);
  assert(match && overlays.includes(match[3]));
  return { path: match[3], mode: match[1], blob: match[2], revision: '4abbdeec8e34de88ed2cf7bd32be9c06b413c631' };
});
assert.equal(overlayRows.length, 2);
const requested = [...source.sources, ...overlayRows];
const batch = execFileSync('/usr/bin/git', ['cat-file', '--batch'], { input: requested.map(row => row.blob).join('\n') + '\n', env: gitEnv, maxBuffer: 16 * 1048576 });
let offset = 0;
const blobs = new Map();
for (const row of requested) {
  const newline = batch.indexOf(10, offset);
  const header = batch.subarray(offset, newline).toString().split(' ');
  assert.equal(header[0], row.blob); assert.equal(header[1], 'blob');
  const size = Number(header[2]); assert(Number.isSafeInteger(size) && size <= 1048576);
  const bytes = batch.subarray(newline + 1, newline + 1 + size);
  assert.equal(bytes.length, size); assert.equal(batch[newline + 1 + size], 10);
  assert.equal(crypto.createHash('sha1').update(Buffer.from('blob ' + size + '\0')).update(bytes).digest('hex'), row.blob);
  if (row.sha256) { assert.equal(hash(bytes), row.sha256); assert.equal(size, row.bytes); }
  blobs.set(row.blob, bytes); offset = newline + size + 2;
}
assert.equal(offset, batch.length);
function treeDigest(rows) {
  const root = new Map();
  for (const row of rows) {
    const parts = row.path.split('/'); let directory = root;
    for (const component of parts.slice(0, -1)) { if (!directory.has(component)) directory.set(component, new Map()); directory = directory.get(component); }
    assert(!directory.has(parts.at(-1))); directory.set(parts.at(-1), row);
  }
  const digest = directory => {
    const entries = [...directory].map(([name, value]) => ({ name, directory: value instanceof Map, value }));
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.directory ? '/' : '')), Buffer.from(right.name + (right.directory ? '/' : ''))));
    const bytes = Buffer.concat(entries.map(entry => Buffer.concat([Buffer.from((entry.directory ? '40000' : entry.value.mode) + ' ' + entry.name + '\0'), Buffer.from(entry.directory ? digest(entry.value) : entry.value.blob, 'hex')])));
    return crypto.createHash('sha1').update(Buffer.from('tree ' + bytes.length + '\0')).update(bytes).digest('hex');
  };
  return digest(root);
}
assert.equal(treeDigest(source.sources), source.selectedTree);
const selected = source.sources.map(row => {
  const replacement = overlayRows.find(entry => entry.path === row.path);
  if (!replacement) return { path: row.path, mode: row.mode, blob: row.blob, bytes: row.bytes, sha256: row.sha256, revision: row.revision, origin: 'frozen-base' };
  const bytes = blobs.get(replacement.blob);
  return { ...replacement, bytes: bytes.length, sha256: hash(bytes), origin: 'unaccepted-private-transport-overlay', priorBlob: row.blob, priorSha256: row.sha256 };
});
assert.equal(selected.filter(row => row.origin !== 'frozen-base').length, 2);
const compiledRaw = read(parent + '/COMPILED.json');
const packageRaw = read(parent + '/producer-v2/PACKAGE-MANIFEST.json');
const v7 = 'tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v7';
const writerSealRaw = read(v7 + '/EXECUTION-SEAL.json');
assert.equal(hash(writerSealRaw), '0efb8f129c77f02a119548f9308eca39ad70ca73c5fb548c1fa9918b757326f2');
const writerSeal = JSON.parse(writerSealRaw);
for (const row of writerSeal.files) { const bytes = read(row.path); assert.equal(hash(bytes), row.sha256); }
const recipe = JSON.parse(read(v7 + '/BINDING-RECIPE.json'));
assert.equal(hash(read(recipe.definitions.path)), recipe.definitions.sha256);
const manifest = { schema: 'core-two-source-overlay-v1', baseDerivedTree: source.selectedTree, baseSourceManifest: { path: path.resolve(parent, 'SOURCE.json'), sha256: hash(sourceRaw) }, sourceCount: selected.length, overlayCommit: '4abbdeec8e34de88ed2cf7bd32be9c06b413c631', overlayPaths: overlays, derivedTree: treeDigest(selected), derivedTreeIsStoredGitObjectRequired: false, sources: selected, sourceReview: 'Hooke ongoing; NOT accepted', frozenPackageSha256: '4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e', compiledManifest: { path: path.resolve(parent, 'COMPILED.json'), sha256: hash(compiledRaw) }, packageManifest: { path: path.resolve(parent, 'producer-v2/PACKAGE-MANIFEST.json'), sha256: hash(packageRaw) }, producerReceipt: '439138a0e13595a41e84841f83e4f2f51b36ff68', rootReceipt: 'c9326e17', writer: { source: 'e33b99af9fbec345b4f5a76d50f627c3d4d9f73a', sealSha256: hash(writerSealRaw), files: writerSeal.files, acceptance: 'e7b90371e8fc338d3a5faae10fcb7e36b3d36f44', acceptanceReceiptSha256: 'fbc5797d8ee2c49a81ada006620f19a4f7ee6e3ec9cc8574b0f2f7da4a44fbcf', recipe }, tools, producerSeal, noCurrentRuntimeAuthority: true };
save('COMPOSITION.json', manifest);
save('BASELINE-DATA.json', { producerResult, compiled: JSON.parse(compiledRaw), packageManifest: JSON.parse(packageRaw), packageJson: JSON.parse(blobs.get(selected.find(row => row.path === 'package.json').blob)), tsconfig: JSON.parse(blobs.get(selected.find(row => row.path === 'tsconfig.json').blob)) });
fs.writeFileSync(owned + '/user.npmrc', '', { flag: 'wx' });
fs.writeFileSync(owned + '/global.npmrc', '', { flag: 'wx' });
console.log(JSON.stringify({ sourceCount: selected.length, baseDerivedTree: source.selectedTree, derivedTree: manifest.derivedTree, overlays: selected.filter(row => row.origin !== 'frozen-base'), tools, producerResult, tsconfig: JSON.parse(blobs.get(selected.find(row => row.path === 'tsconfig.json').blob)), packageScripts: JSON.parse(blobs.get(selected.find(row => row.path === 'package.json').blob)).scripts }));
