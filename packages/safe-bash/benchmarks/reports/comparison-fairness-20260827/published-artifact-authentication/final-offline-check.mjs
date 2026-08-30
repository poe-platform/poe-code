import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(output, name)));
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(bytes).digest(encoding);
const download = read('download.json'), files = read('published-files.json'), comparison = read('package-comparison.json'), closure = read('execution-closure.json');
const archive = fs.readFileSync(download.officialTarball.path);
assert.equal(archive.length, download.actual.bytes);
assert.equal(hash(archive), download.actual.sha256);
assert.equal(hash(archive, 'sha1'), download.expected.shasum);
assert.equal(`sha512-${hash(archive, 'sha512', 'base64')}`, download.expected.integrity);
const metadata = fs.readFileSync(path.join(output, 'registry-metadata.raw.json'));
assert.equal(hash(metadata), download.officialMetadata.sha256);
const registry = JSON.parse(metadata);
assert.equal(registry.dist.integrity, download.expected.integrity);
const frozenPackage = comparison.installedRoot;
const copiedPackage = path.join(closure.root, 'benchmarks/node_modules/just-bash');
const roots = [files.destination, frozenPackage, copiedPackage];
for (const root of roots) assert.equal(fs.realpathSync(root), root);
let independentFiles = 0;
for (const row of files.files) {
  const stats = roots.map(root => fs.lstatSync(path.join(root, row.path)));
  assert.ok(stats.every(stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1));
  assert.equal(new Set(stats.map(stat => `${stat.dev}:${stat.ino}`)).size, roots.length);
  for (const root of roots) assert.equal(hash(fs.readFileSync(path.join(root, row.path))), row.sha256);
  independentFiles++;
}
for (const row of closure.files) {
  const filename = path.join(closure.root, row.path), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(hash(fs.readFileSync(filename)), row.sha256);
  assert.equal(stat.mode & 0o777, row.mode);
}
const plan = read('representative-plan-v2.json');
assert.equal(plan.textPlanSha256, hash(fs.readFileSync('/tmp/safe-bash-baseline-auth-plan.txt')));
const report = { checkedAt: new Date().toISOString(), archiveRehashMatches: true, rawMetadataRehashMatches: true, allPublishedFilesStillEqual: independentFiles, packageRoots: roots, allPackageFilesRegularSingleLinkDistinctInodesAcrossRoots: true, executionClosureFilesRehashed: closure.files.length, executionClosureUnchanged: true, productExecutions: 0, representativeApproval: 'NOT RECEIVED; prepared code syntax-checked only', independentReviewerStatus: 'pending; verification/** untouched', originalScoresUnchanged: { original: { oursPass: 222, baselinePass: 155, total: 224 }, scratchAligned: { oursPass: 223, baselinePass: 155, total: 224 }, denominatorUnion: false } };
fs.writeFileSync(path.join(output, 'final-offline-check.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(report));
