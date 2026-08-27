import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { owned, regularBytes, repo, sha256 } from './offline.mjs';

const roots = [
  'benchmarks/reports/current-integration/comparison-replay-20260827',
  'benchmarks/reports/comparison-fairness-20260827/audit',
  'benchmarks/reports/comparison-fairness-20260827/verification',
];
const selfPath = relative(repo, join(owned, 'COMMIT-MANIFEST.json'));
const collected = [];
async function walk(directory) {
  for (const item of await readdir(join(repo, directory), { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    assert.ok(!item.isSymbolicLink(), `candidate alias: ${path}`);
    if (item.isDirectory()) { assert.ok(!['node_modules', '.git', '.snapshot'].includes(item.name)); await walk(path); }
    else { assert.ok(item.isFile(), `candidate special file: ${path}`); collected.push(path); }
  }
}
for (const root of roots) await walk(root);
const selfHash = manifest => {
  const normalized = structuredClone(manifest);
  const self = normalized.files.find(entry => entry.path === selfPath);
  self.sha256 = null;
  self.bytes = null;
  return sha256(JSON.stringify(normalized));
};
const mode = metadata => ({ mode: metadata.mode & 0o777, gitMode: metadata.mode & 0o111 ? '100755' : '100644' });
if (process.argv[2] === '--create') {
  assert.ok(!collected.includes(selfPath), 'never overwrite a candidate seal');
  const tracked = execFileSync('git', ['ls-files', '-z', '--', ...roots]).toString();
  assert.equal(tracked, '', 'candidate scope contains tracked historical files');
  const files = [];
  for (const path of [...collected, selfPath].sort()) {
    if (path === selfPath) files.push({ path, mode: 0o644, gitMode: '100644', bytes: null, sha256: null, hashKind: 'canonical-self-excluding-digest-and-size' });
    else { const content = await regularBytes(join(repo, path)); const metadata = await lstat(join(repo, path)); assert.equal(metadata.nlink, 1); files.push({ path, ...mode(metadata), bytes: content.length, sha256: sha256(content), hashKind: 'raw-file-bytes' }); }
  }
  const manifest = { schema: 1, generatedAt: new Date().toISOString(), liveHeadAtSeal: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(), roots, purpose: 'Explicit candidate files only; NOT staging or commit authorization', selfScheme: 'Every nonself sha256 hashes raw bytes. Self sha256 hashes compact JSON.stringify(manifest) with only the self row sha256 and bytes set null. Self bytes is final pretty JSON UTF-8 size with one newline. Exact raw manifest SHA256 is reported externally in /tmp final handoff; no recursive raw-byte hash claim.', files };
  const self = files.find(entry => entry.path === selfPath);
  self.sha256 = selfHash(manifest);
  let content = JSON.stringify(manifest, null, 2) + '\n';
  while (self.bytes !== Buffer.byteLength(content)) { self.bytes = Buffer.byteLength(content); content = JSON.stringify(manifest, null, 2) + '\n'; }
  execFileSync('apply_patch', [], { cwd: repo, input: `*** Begin Patch\n*** Add File: ${selfPath}\n${content.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
  console.log(JSON.stringify({ files: files.length, path: selfPath, rawSha256: sha256(await regularBytes(join(repo, selfPath))), selfCanonicalSha256: self.sha256 }));
} else {
  assert.equal(process.argv[2], '--verify');
  const manifestBytes = await regularBytes(join(repo, selfPath));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(manifest.roots, roots);
  assert.deepEqual(manifest.files.map(entry => entry.path), collected.sort());
  assert.equal(new Set(collected).size, collected.length);
  for (const entry of manifest.files) {
    const content = await regularBytes(join(repo, entry.path));
    const metadata = await lstat(join(repo, entry.path));
    assert.equal(metadata.nlink, 1);
    assert.deepEqual(mode(metadata), { mode: entry.mode, gitMode: entry.gitMode });
    assert.equal(content.length, entry.bytes);
    assert.equal(entry.sha256, entry.path === selfPath ? selfHash(manifest) : sha256(content), `candidate drift: ${entry.path}`);
  }
  console.log(JSON.stringify({ result: 'EXACT_EXPLICIT_CANDIDATE_SET_VERIFIED', files: collected.length, rawManifestSha256: sha256(manifestBytes), noStagingOrCommits: true }));
}
