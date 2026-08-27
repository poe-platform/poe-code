import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = existsSync(join(own, 'ARTIFACTS.json')) ? JSON.parse(readFileSync(join(own, 'ARTIFACTS.json'))) : undefined;
if (artifacts) for (const [name, expected] of Object.entries(artifacts.files)) assert.equal(hash(readFileSync(join(own, name))), expected, name);
const metadata = JSON.parse(readFileSync(join(own, 'EVIDENCE.json')));
const compressed = Buffer.from(readFileSync(join(own, metadata.archiveName), 'utf8'), 'base64');
assert.equal(hash(compressed), metadata.archiveSha256);
const archive = JSON.parse(gunzipSync(compressed));
assert.deepEqual(Object.keys(archive).sort(), metadata.files.map(file => file.path).sort());
for (const file of metadata.files) { const bytes = Buffer.from(archive[file.path], 'base64'); assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256, file.path); }
const bytes = name => Buffer.from(archive['capture-01/' + name], 'base64');
const json = name => JSON.parse(bytes(name));
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const state = json('state.json');
assert.equal(state.candidate, metadata.candidate); assert.equal(state.freeze, metadata.freeze);
for (const [name, expected] of Object.entries(metadata.frozenHashes)) {
  assert.equal(hash(readFileSync(join(own, name))), expected);
  assert.equal(hash(git('show', `${metadata.freeze}:tests/commands/html-to-markdown-independent-20260827/${name}`)), expected);
}
for (const [objectPath, expected] of Object.entries(state.inputs)) { assert.equal(hash(git('show', objectPath)), expected.sha256, objectPath); assert.equal(git('rev-parse', objectPath).toString().trim(), expected.blob); }
const tarball = bytes(state.pack[0].filename); assert.equal(hash(tarball), state.tarballSha256);
const tar = gunzipSync(tarball), packed = {};
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
  const string = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/su, '');
  const name = string(0, 100), prefix = string(345, 500), type = string(156, 157), size = Number.parseInt(string(124, 136).trim(), 8) || 0;
  const fullName = prefix ? prefix + '/' + name : name;
  assert(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
  if (type === '0' || type === '') { assert(fullName.startsWith('package/')); packed[fullName.slice(8)] = hash(tar.subarray(offset + 512, offset + 512 + size)); }
  else assert(type === '5' || type === 'x', 'unexpected tar entry type ' + type);
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.deepEqual(packed, state.installedBefore, 'actual npm tarball equals moved installed file inventory');
let receipts = 0, productLoads = 0, timeouts = 0;
for (const file of metadata.files.filter(file => /\/receipts\.json$/u.test(file.path))) {
  const rows = JSON.parse(Buffer.from(archive[file.path], 'base64'));
  for (const row of rows) {
    receipts++; if (row.killed) timeouts++; assert(row.processGroupGone, row.id);
    const prefix = file.path.slice(0, file.path.lastIndexOf('/') + 1);
    const stdout = Buffer.from(archive[prefix + row.id + '.stdout'], 'base64');
    const stderr = Buffer.from(archive[prefix + row.id + '.stderr'], 'base64');
    assert.equal(hash(stdout), row.stdoutSha256); assert.equal(hash(stderr), row.stderrSha256);
    for (const load of row.loads) {
      const path = fileURLToPath(load.url); assert(path.startsWith(state.consumer + '/'), 'load outside moved consumer'); assert(!path.endsWith('.ts') && !path.endsWith('.mts'), 'source TS runtime');
      if (path.startsWith(state.installed + '/')) { productLoads++; assert.equal(load.sha256, packed[path.slice(state.installed.length + 1)]); }
    }
  }
}
const final = json('final-integrity.json');
assert(final.installedUnchangedIncludingNewEntries && final.retiredSourceAndEmittedUnchangedIncludingNewEntries && final.scratchRemovedAfterAuthenticationAndSnapshots);
const frozen = json('frozen/summary.json'); assert.deepEqual([frozen.total, frozen.pass, frozen.fail], [125, 119, 6]);
const semantic = json('semantic-assertions.json'); assert.equal(semantic.rows.filter(row => row.outcome === 'FAIL').length, 4);
const comparative = json('author-pandoc.json'); assert.deepEqual([comparative.total, comparative.exact, comparative.different], [16, 5, 11]);
for (const test of comparative.rows) { assert.equal(bytes('comparative/pandoc-' + test.name + '.stdout').toString(), test.reference.stdout); assert.equal(bytes('comparative/pandoc-' + test.name + '.stderr').toString(), test.reference.stderr); }
console.log(JSON.stringify({ verified: true, artifactFiles: artifacts ? Object.keys(artifacts.files).length : 'not yet sealed', files: metadata.files.length, candidate: metadata.candidate, freeze: metadata.freeze, packedFiles: Object.keys(packed).length, sourceBindings: Object.keys(state.inputs).length, receipts, productLoads, killedIncludingSupervisorControl: timeouts, frozen: '119 PASS / 6 retained FAIL', semantic: '1 PASS / 4 source-semantic FAIL', comparison: '16 rerun; 5 exact / 11 classified differences', writes: 0 }));
