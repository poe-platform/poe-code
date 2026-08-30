import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..');
const revision = '6e99656dd9d6e285b33fb3cf99ed5fef19146a48', authentication = '010411ef';
const root = await mkdtemp('/tmp/safe-bash-sort-performance-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : 1)) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, path));
    else { assert.ok(entry.isFile(), path); result[path] = hash(await readFile(join(directory, path))); }
  }
  return result;
}
const profile = 'benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication';
const publishedBytes = git(['show', `${authentication}:${profile}/published-files.json`]);
const published = JSON.parse(publishedBytes);
const metadata = JSON.parse(git(['show', `${authentication}:${profile}/registry-metadata.raw.json`]));
const tarball = await readFile('/private/tmp/safe-bash-published-auth-JydnQ4/just-bash-3.4.2.tgz');
assert.equal('sha512-' + createHash('sha512').update(tarball).digest('base64'), metadata.dist.integrity);
assert.equal(createHash('sha1').update(tarball).digest('hex'), metadata.dist.shasum);
const installed = await hashes(join(repo, 'benchmarks/node_modules/just-bash'));
assert.deepEqual(installed, Object.fromEntries(published.files.map(entry => [entry.path, entry.sha256])));
await mkdir(join(root, 'base')); await mkdir(join(root, 'baseline'));
const sourcePaths = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json',
  'tests/commands/core-regression-stress', 'tests/commands/core-sort', 'tests/commands/core-expanded', 'tests/commands/helpers.ts'];
const archive = git(['archive', revision, '--', ...sourcePaths]);
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', join(root, 'base')], { input: archive });
await cp(join(repo, 'node_modules'), join(root, 'node_modules'), { recursive: true, dereference: true });
await cp(join(repo, 'benchmarks/node_modules'), join(root, 'baseline/node_modules'), { recursive: true, dereference: true });
await cp(join(root, 'base'), join(root, 'candidate'), { recursive: true });
await mkdir(join(root, 'tmp')); await mkdir(join(root, 'evidence')); await mkdir(join(root, 'harness'));
const native = join(root, 'native'); await mkdir(native);
for (const name of ['sort', 'uniq']) await cp(join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src', name), join(native, name));
const manifest = { root, revision, authentication, node: process.version, versions: process.versions,
  archiveSha256: hash(archive), source: await hashes(join(root, 'base/src')), tests: await hashes(join(root, 'base/tests')),
  developmentDependencies: await hashes(join(root, 'node_modules')), baselineDependencies: await hashes(join(root, 'baseline/node_modules')),
  native: await hashes(native), publishedFileCount: published.files.length, publishedFilesSha256: hash(publishedBytes),
  tarballSha256: hash(tarball), metadataIntegrity: metadata.dist.integrity, all955PublishedFilesMatch: true,
  scope: 'Frozen committed source. Only candidate/src/commands/text.ts may be patched in this scratch tree. Live product is read-only.' };
await save(join(root, 'manifest-before.json'), manifest);
const evidence = process.env.SORT_REPORT ?? join(own, 'evidence');
await mkdir(evidence, { recursive: true });
await save(join(evidence, 'preparation.json'), manifest);
await writeFile(process.env.SORT_STATE ?? join(own, 'scratch-path.txt'), root + '\n', { flag: 'wx' });
console.log(root);
