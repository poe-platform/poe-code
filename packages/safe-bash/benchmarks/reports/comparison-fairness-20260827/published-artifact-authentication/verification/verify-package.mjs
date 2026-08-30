import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, packageTarMap, safePath } from './tar-map.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const repo = resolve(owned, '../../../../..');
const hashPattern = /^[a-f0-9]{64}$/u;
const report = { schema: 1, kind: 'OFFLINE_PUBLISHED_PACKAGE_IDENTITY_ONLY', at: new Date().toISOString(), productExecutions: 0, networkRequests: 0, extractionPerformed: false, finalAcceptance: false, blockers: [] };
const reads = new Map();

async function regular(path, maximum = 64 * 1024 * 1024) {
  const metadata = await lstat(path);
  assert.ok(metadata.isFile() && metadata.nlink === 1 && metadata.size <= maximum, `not bounded independent regular evidence: ${path}`);
  assert.equal(await realpath(path), resolve(await realpath(dirname(path)), path.split('/').at(-1)), `file alias: ${path}`);
  const content = await readFile(path);
  reads.set(path, digest(content));
  return content;
}

async function bound(entry) {
  assert.match(entry.sha256, hashPattern);
  const path = isAbsolute(entry.path) ? entry.path : resolve(repo, entry.path);
  const allowedRepo = path.startsWith(join(repo, 'benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication/')) || path.startsWith(join(repo, 'benchmarks/reports/current-integration/comparison-replay-20260827/'));
  assert.ok(allowedRepo || /^\/(?:private\/)?tmp\/safe-bash-(?:baseline-auth|published-auth)[-/]/u.test(path), `unapproved evidence location: ${path}`);
  const content = await regular(path);
  assert.equal(digest(content), entry.sha256, `bound evidence changed: ${path}`);
  return content;
}

async function tree(root) {
  const physical = await realpath(root);
  assert.match(physical, /^\/private\/tmp\/safe-bash-(?:baseline-auth|published-auth|comparison-replay)-[^/]+\//u);
  assert.equal(resolve(root).replace(/^\/tmp\//u, '/private/tmp/'), physical, 'root aliases other than OS /tmp are forbidden');
  assert.ok((await lstat(root)).isDirectory());
  const files = Object.create(null);
  let totalBytes = 0;
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, item.name);
      assert.ok(!item.isSymbolicLink(), `extracted/installed alias: ${path}`);
      if (item.isDirectory()) await walk(path);
      else {
        assert.ok(item.isFile(), `extracted/installed special node: ${path}`);
        assert.ok(Object.keys(files).length < 20000);
        const content = await regular(path);
        totalBytes += content.length;
        assert.ok(totalBytes <= 256 * 1024 * 1024);
        files[safePath(relative(root, path))] = { type: 'file', bytes: content.length, sha256: digest(content), mode: (await lstat(path)).mode & 0o777 };
      }
    }
  }
  await walk(root);
  return files;
}

function difference(expected, actual) {
  const paths = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return paths.filter(path => expected[path]?.sha256 !== actual[path]?.sha256).map(path => ({ path, kind: !expected[path] ? 'installed-only' : !actual[path] ? 'published-only' : 'changed-bytes', published: expected[path] ?? null, installed: actual[path] ?? null }));
}

function jsonDifferences(left, right, path = '') {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => jsonDifferences(left[key], right[key], `${path}/${key}`));
  return [{ path: path || '/', published: left ?? null, installed: right ?? null }];
}

try {
  assert.equal(process.argv.length, 6);
  assert.equal(process.argv[2], '--input');
  assert.equal(process.argv[4], '--out');
  const input = JSON.parse(await regular(resolve(process.argv[3])));
  assert.equal(input.schema, 1);
  assert.equal(input.status, 'ROOT_AUTHORIZED_OFFLINE_REVIEW', 'preparation does not authorize execution');
  assert.ok(typeof input.rootAuthorization === 'string' && input.rootAuthorization.length > 40);
  await bound(input.authorHandoff);
  const http = JSON.parse(await bound(input.httpEvidence));
  const metadataBytes = await bound(input.metadata);
  assert.ok(metadataBytes.length <= 2 * 1024 * 1024, 'pinned metadata response budget');
  const metadata = JSON.parse(metadataBytes);
  const tarball = await bound(input.tarball);
  assert.equal(metadata.name, 'just-bash');
  assert.equal(metadata.version, '3.4.2');
  assert.equal(input.metadata.url, 'https://registry.npmjs.org/just-bash/3.4.2');
  assert.equal(metadata.dist.tarball, 'https://registry.npmjs.org/just-bash/-/just-bash-3.4.2.tgz');
  assert.equal(input.tarball.url, metadata.dist.tarball);
  for (const [role, entry] of [['metadata', input.metadata], ['tarball', input.tarball]]) {
    const captures = http.responses.filter(row => row.role === role);
    assert.equal(captures.length, 1, `exact successful HTTP capture required for ${role}`);
    assert.equal(captures[0].status, 200);
    assert.equal(captures[0].requestedUrl, entry.url);
    assert.equal(captures[0].finalUrl, entry.url);
    assert.equal(captures[0].bodySha256, entry.sha256);
    assert.ok(Number.isFinite(Date.parse(captures[0].receivedAt)));
  }
  const sha512 = digest(tarball, 'sha512', 'base64');
  const sha1 = digest(tarball, 'sha1');
  assert.equal(metadata.dist.integrity, `sha512-${sha512}`, 'actual compressed tarball SRI');
  assert.equal(metadata.dist.shasum, sha1, 'actual compressed tarball SHA1');
  report.tarball = { bytes: tarball.length, sha256: digest(tarball), sha512Base64: sha512, sri: `sha512-${sha512}`, sha1, metadataSha256: digest(metadataBytes) };
  const archive = packageTarMap(tarball);
  const extracted = await tree(input.extractedPackageRoot);
  assert.deepEqual(difference(archive.files, extracted), [], 'regular extraction differs from published package');
  const source = JSON.parse(await bound(input.sourceManifest));
  const frozen = JSON.parse(await bound(input.frozenManifest));
  assert.equal(source.sourceTreeSha256, '76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c');
  assert.equal(digest(JSON.stringify(source.paths)), source.sourceTreeSha256);
  assert.equal(digest(JSON.stringify(frozen)), 'a133f8cf113866657155396038293ff54fbb8767cf92c96372804ab775bafdc9');
  const frozenRoot = await realpath(input.frozenProductRoot);
  assert.match(frozenRoot, /^\/private\/tmp\/safe-bash-comparison-replay-20260827-[^/]+\/product$/u);
  const installed = await tree(join(frozenRoot, 'benchmarks/node_modules/just-bash'));
  const expectedInstalled = Object.fromEntries(Object.entries(frozen).filter(([path]) => path.startsWith('benchmarks/node_modules/just-bash/')).map(([path, entry]) => [path.slice('benchmarks/node_modules/just-bash/'.length), entry]));
  assert.deepEqual(difference(expectedInstalled, installed), [], 'installed package no longer matches accepted frozen manifest');
  const lockBytes = await regular(join(frozenRoot, 'benchmarks/package-lock.json'));
  assert.equal(digest(lockBytes), frozen['benchmarks/package-lock.json'].sha256);
  const lock = JSON.parse(lockBytes);
  const pinned = lock.packages['node_modules/just-bash'];
  assert.equal(pinned.version, metadata.version);
  assert.equal(pinned.integrity, metadata.dist.integrity);
  assert.equal(pinned.resolved, metadata.dist.tarball);
  const publishedManifest = JSON.parse(archive.payloads.get('package.json'));
  const installedManifest = JSON.parse(await regular(join(frozenRoot, 'benchmarks/node_modules/just-bash/package.json')));
  assert.equal(publishedManifest.name, metadata.name);
  assert.equal(publishedManifest.version, metadata.version);
  const changes = difference(archive.files, installed);
  report.package = { published: archive.files, extracted, frozenInstalled: installed, differences: changes, packageJsonFieldDifferences: jsonDifferences(publishedManifest, installedManifest), modeDifferences: Object.keys(archive.files).filter(path => archive.files[path].mode !== installed[path]?.mode).map(path => ({ path, published: archive.files[path].mode, installed: installed[path]?.mode ?? null })), headers: archive.headers, paxHeaders: archive.paxHeaders, expandedBytes: archive.expandedBytes };
  report.entry = { path: 'dist/bundle/index.js', publishedSha256: archive.files['dist/bundle/index.js'].sha256, frozenSha256: installed['dist/bundle/index.js']?.sha256, sameBytes: archive.files['dist/bundle/index.js'].sha256 === installed['dist/bundle/index.js']?.sha256, runtimeResolveOrEvaluationProved: false };
  report.dependencies = { lockSha256: digest(lockBytes), pinnedRecord: pinned, graphPackages: Object.keys(lock.packages).length, qualification: 'One published package authenticated. Lock strings and accepted installed dependency tree identity do not authenticate the other dependency tarballs, optional runtimes, lifecycle scripts or registry signatures.' };
  for (const [path, hash] of reads) assert.equal(digest(await readFile(path)), hash, `input changed while reviewing: ${path}`);
  assert.deepEqual(await tree(input.extractedPackageRoot), extracted, 'extraction tree drift');
  assert.deepEqual(await tree(join(frozenRoot, 'benchmarks/node_modules/just-bash')), installed, 'frozen package tree drift');
  report.inputHashes = Object.fromEntries(reads);
  report.status = changes.length ? 'PACKAGE_DIFFERENCES_REQUIRE_EXACT_PATH_REVIEW' : 'PUBLISHED_BYTES_MATCH_FROZEN_PACKAGE_EXECUTION_REVIEW_PENDING';
  if (changes.length) process.exitCode = 1;
} catch (error) {
  report.status = 'BLOCKED';
  report.blockers.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
}
const output = resolve(process.argv[5] ?? '');
assert.ok(output.startsWith(owned + '/') || /^\/(?:private\/)?tmp\/safe-bash-baseline-auth-verifier-/u.test(output), 'output outside ownership');
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
