import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../../..');
const inputsBytes = await readFile(path.join(directory, 'INPUTS.json'));
const inputs = JSON.parse(inputsBytes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = inputs.limits;
const authentication = 'benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication';
const replay = 'benchmarks/reports/current-integration/comparison-replay-20260827';
let totalHashBytes = 0;
const cache = new Map();
const report = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  scope: inputs.scope,
  inputsSha256: digest(inputsBytes),
  checkerSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  primaryCommit: inputs.primaryCommit,
  oldReplayCommit: inputs.oldReplayCommit,
  limits,
  evidence: [],
  artifacts: [],
  trees: [],
  nativePrerequisites: [],
  blockers: [],
  productImports: 0,
  productCalls: 0,
  nativeVersionChildren: 0,
  subprocesses: 0,
  downloads: 0,
  timingTrials: 0,
  releaseGate: 'BLOCKED_NO_AUTHORIZED_FUTURE_CANDIDATE',
  mandatoryFutureInputs: inputs.mandatoryFutureInputs,
};

function contained(root, relative) {
  if (path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.' || part === '')) {
    throw new Error(`Unsafe manifest path: ${relative}`);
  }
  return path.join(root, relative);
}

async function identify(filename, allowSymlink = false) {
  const key = `${allowSymlink}:${filename}`;
  if (cache.has(key)) return cache.get(key);
  let handle;
  let result;
  try {
    const entry = await lstat(filename);
    const resolvedPath = await realpath(filename);
    if (entry.isSymbolicLink() && !allowSymlink) throw new Error('SYMLINK_NOT_REGULAR');
    handle = await open(filename, constants.O_RDONLY | (allowSymlink ? 0 : constants.O_NOFOLLOW));
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('NOT_REGULAR_FILE');
    if (before.size > limits.perFileBytes) throw new Error('FILE_BYTE_CAP');
    if (totalHashBytes + before.size > limits.totalHashBytes) throw new Error('TOTAL_BYTE_CAP');
    const hashes = Object.fromEntries(['sha256', 'sha1', 'sha512'].map(name => [name, createHash(name)]));
    const buffer = Buffer.alloc(limits.readChunkBytes);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      totalHashBytes += bytesRead;
      if (bytes > limits.perFileBytes || totalHashBytes > limits.totalHashBytes) throw new Error('STREAM_BYTE_CAP');
      for (const hash of Object.values(hashes)) hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const current = await lstat(filename);
    if (before.size !== bytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || entry.ino !== current.ino || entry.dev !== current.dev) {
      throw new Error('FILE_CHANGED_DURING_HASH');
    }
    result = {
      path: filename,
      resolvedPath,
      bytes,
      hashes: Object.fromEntries(Object.entries(hashes).map(([name, hash]) => [name, hash.digest('hex')])),
      modeOctal: (after.mode & 0o777).toString(8).padStart(4, '0'),
      symlink: entry.isSymbolicLink(),
      links: after.nlink,
      device: after.dev,
      inode: after.ino,
      status: 'AVAILABLE_HASHED',
    };
  } catch (error) {
    result = { path: filename, status: 'BLOCKED_PREREQUISITE', error: error.code ?? error.message };
  } finally {
    await handle?.close();
  }
  cache.set(key, result);
  return result;
}

async function checkFile(filename, expected, allowSymlink = false) {
  const actual = await identify(filename, allowSymlink);
  const matches = actual.status === 'AVAILABLE_HASHED' &&
    typeof expected.sha256 === 'string' && actual.hashes.sha256 === expected.sha256 &&
    (expected.bytes === undefined || actual.bytes === expected.bytes) &&
    (expected.modeOctal === undefined || actual.modeOctal === expected.modeOctal);
  const result = { ...actual, expected, status: matches ? 'VERIFIED_BYTES' : 'BLOCKED_PREREQUISITE' };
  if (!matches) report.blockers.push({ path: filename, error: actual.error ?? 'MISSING_EXPECTATION_OR_IDENTITY_MISMATCH' });
  return result;
}

const data = new Map();
for (const entry of inputs.evidence) {
  const result = await checkFile(contained(repository, entry.path), entry);
  report.evidence.push(result);
  if (result.status === 'VERIFIED_BYTES' && entry.path.endsWith('.json')) {
    const bytes = await readFile(result.path);
    if (digest(bytes) !== entry.sha256) throw new Error(`Evidence changed before parsing: ${entry.path}`);
    data.set(entry.path, JSON.parse(bytes));
  }
}

async function scan(root) {
  const entries = [];
  let visited = 0;
  async function visit(relative, depth) {
    if (depth > limits.treeDepth) throw new Error('TREE_DEPTH_CAP');
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (++visited > limits.treeEntries) throw new Error('TREE_ENTRY_CAP');
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(child, depth + 1);
      else entries.push(child);
    }
  }
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('TREE_ROOT_NOT_REGULAR_DIRECTORY');
  await visit('', 0);
  return entries.sort();
}

async function checkTree(label, root, expectedFiles, boundary) {
  const tree = { label, root, boundary, expectedCount: expectedFiles.length, files: [], extra: [], missing: [], status: 'BLOCKED_PREREQUISITE' };
  report.trees.push(tree);
  try {
    const actualNames = await scan(root);
    const expectedNames = new Set(expectedFiles.map(entry => entry.path));
    const actualSet = new Set(actualNames);
    tree.extra = actualNames.filter(name => !expectedNames.has(name));
    tree.missing = expectedFiles.filter(entry => !actualSet.has(entry.path)).map(entry => entry.path);
    for (const expected of expectedFiles) {
      tree.files.push(await checkFile(contained(root, expected.path), expected));
    }
    const afterNames = await scan(root);
    tree.membershipStable = JSON.stringify(actualNames) === JSON.stringify(afterNames);
    tree.verifiedCount = tree.files.filter(entry => entry.status === 'VERIFIED_BYTES').length;
    tree.observedMapSha256 = digest(JSON.stringify(tree.files.map(entry => ({ path: path.relative(root, entry.path), bytes: entry.bytes, sha256: entry.hashes?.sha256 }))));
    tree.status = tree.extra.length === 0 && tree.missing.length === 0 && tree.membershipStable && tree.verifiedCount === expectedFiles.length ? 'VERIFIED_BYTES_AND_MEMBERSHIP' : 'BLOCKED_PREREQUISITE';
    if (tree.status !== 'VERIFIED_BYTES_AND_MEMBERSHIP') report.blockers.push({ path: root, error: 'TREE_MEMBERSHIP_OR_BYTES_MISMATCH' });
  } catch (error) {
    tree.error = error.code ?? error.message;
    report.blockers.push({ path: root, error: tree.error });
  }
  return tree;
}

if (report.evidence.every(entry => entry.status === 'VERIFIED_BYTES')) {
  const download = data.get(`${authentication}/download.json`);
  const published = data.get(`${authentication}/published-files.json`);
  const comparison = data.get(`${authentication}/package-comparison.json`);
  const closure = data.get(`${authentication}/execution-closure.json`);
  const metadata = data.get(`${authentication}/registry-metadata.raw.json`);
  const archive = await checkFile(download.officialTarball.path, download.actual);
  archive.sha1Matches = archive.hashes?.sha1 === 'abc0520ad5c278eae2de4cd90c3d7f88e1fdd724';
  archive.sha512Matches = archive.hashes?.sha512 === download.actual.sha512;
  archive.registrySriMatches = archive.hashes?.sha512 !== undefined && `sha512-${Buffer.from(archive.hashes.sha512, 'hex').toString('base64')}` === metadata.dist.integrity;
  report.artifacts.push(archive);
  report.primaryChain = {
    metadataSha256: download.officialMetadata.sha256,
    metadataBodyMatches: report.evidence.find(entry => entry.path.endsWith('/registry-metadata.raw.json')).hashes.sha256 === download.officialMetadata.sha256,
    metadataName: metadata.name,
    metadataVersion: metadata.version,
    recordedRequests: download.requests.map(entry => ({ url: entry.url, statusCode: entry.statusCode, tls: entry.tls, bytes: entry.bytes, sha256: entry.sha256 })),
    userTarSha256Matches: archive.hashes?.sha256 === 'f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d',
    archiveDigestChecksPass: archive.sha1Matches && archive.sha512Matches && archive.registrySriMatches,
    publishedFiles: published.fileCount,
    publishedBytes: published.totalFileBytes,
    freshNetworkAuthentication: false,
    extractionReexecuted: false,
    boundary: 'Exact retained archive and authenticated per-file map reuse; recorded TLS is historical, not fresh transport or signature verification.',
  };
  if (!report.primaryChain.metadataBodyMatches || !report.primaryChain.userTarSha256Matches || !report.primaryChain.archiveDigestChecksPass) report.blockers.push({ error: 'PRIMARY_CHAIN_MISMATCH' });
  for (const [label, root] of [
    ['authenticated-extraction', published.destination],
    ['old-replay-installed-package', comparison.installedRoot],
    ['authenticated-execution-package', path.join(closure.root, 'benchmarks/node_modules/just-bash')],
    ['live-installed-comparator-not-candidate', path.join(repository, 'benchmarks/node_modules/just-bash')],
  ]) {
    const tree = await checkTree(label, root, published.files, 'Only just-bash 3.4.2 package publication authenticated; no import/evaluation performed.');
    tree.entry = tree.files.find(entry => entry.path.endsWith('/dist/bundle/index.js'));
    tree.manifest = tree.files.find(entry => entry.path.endsWith('/package.json'));
    if (tree.manifest?.status === 'VERIFIED_BYTES') {
      const manifestBytes = await readFile(tree.manifest.path);
      if (digest(manifestBytes) !== tree.manifest.hashes.sha256) throw new Error('Manifest changed before parse');
      const manifest = JSON.parse(manifestBytes);
      tree.manifestFields = { name: manifest.name, version: manifest.version, exports: manifest.exports, dependencies: manifest.dependencies };
    }
  }
  const closureTree = await checkTree('authenticated-execution-closure', closure.root, closure.files.map(entry => ({ ...entry, modeOctal: entry.mode.toString(8).padStart(4, '0') })), 'Dependency/helper byte closure, not individual publication authentication or module evaluation.');
  closureTree.recordedMapSha256 = closure.mapSha256;
  closureTree.recordedMapRecomputedSha256 = digest(JSON.stringify(closure.files));
  if (closureTree.recordedMapSha256 !== closureTree.recordedMapRecomputedSha256) report.blockers.push({ error: 'CLOSURE_MAP_DIGEST_MISMATCH' });
  const postRun = data.get(`${authentication}/execution-post-run-check-attempt-1.json`);
  const laterClosure = await checkTree('v3-closure-with-declared-observers', postRun.integrity.root, postRun.actualFiles.map(entry => ({ ...entry, modeOctal: entry.mode.toString(8).padStart(4, '0') })), 'Separate later PRIMARY record: 3842 base files plus two declared observers. Does not erase the original 3842-only membership mismatch.');
  laterClosure.primaryRecord = `${authentication}/execution-post-run-check-attempt-1.json`;
  laterClosure.baseFiles = postRun.integrity.baseFiles;
  laterClosure.declaredObserverAdditions = postRun.integrity.declaredObserverAdditions;
  const dependencyManifest = data.get(`${replay}/dependency-manifest.json`);
  for (const [name, manifest] of Object.entries(dependencyManifest)) {
    const regularized = Object.fromEntries(Object.entries(manifest.paths).map(([relative, entry]) => [relative, { ...entry, originalSymlink: null }]));
    const tree = await checkTree(`old-frozen-${name}`, manifest.destination, Object.entries(manifest.paths).map(([relative, entry]) => ({ path: relative, sha256: entry.sha256, modeOctal: (entry.mode & ~0o222).toString(8).padStart(4, '0') })), 'Frozen copied tree; write bits removed after old seal. All non-just-bash dependencies only lock-pinned and byte-equal.');
    tree.recordedCopiedTreeSha256 = manifest.copiedTreeSha256;
    tree.recomputedCopiedTreeSha256 = digest(JSON.stringify(regularized));
    tree.lockSha256 = manifest.lockSha256;
    if (tree.recordedCopiedTreeSha256 !== tree.recomputedCopiedTreeSha256) report.blockers.push({ error: `DEPENDENCY_MAP_MISMATCH:${name}` });
  }
  const freeze = data.get(`${replay}/location.json`).freeze;
  for (const [relative, expected] of [['package-lock.json', dependencyManifest.node_modules.lockSha256], ['benchmarks/package-lock.json', dependencyManifest['benchmarks/node_modules'].lockSha256]]) {
    report.artifacts.push(await checkFile(path.join(freeze, 'product', relative), { sha256: expected }));
  }
  const source = data.get(`${replay}/source-manifest.json`);
  report.oldSource = { head: source.head, sourceTreeSha256: source.sourceTreeSha256, status: source.status, interpretation: 'Historical dirty/untracked capture, not a committed-only source snapshot or current candidate.' };
  report.oldSource.files = [];
  for (const [relative, expected] of Object.entries(source.paths)) {
    report.oldSource.files.push(await checkFile(contained(path.join(freeze, 'product'), relative), { sha256: expected.sha256, bytes: expected.bytes }));
  }
  report.oldProfiles = [];
  const oracle = data.get(`${replay}/oracle-identities.json`);
  for (const [name, profile] of Object.entries(data.get(`${replay}/profiles.json`))) {
    const files = [];
    for (const [relative, expected] of Object.entries(profile.hashes)) files.push(await checkFile(contained(profile.root, relative), { sha256: expected }));
    const golden = await checkFile(profile.goldPath, { sha256: name === 'original' ? oracle.originalGoldSha256 : oracle.alignedGoldSha256 });
    report.oldProfiles.push({ name, revision: profile.revision, root: profile.root, files, golden, claim: 'Retained profile identity only; no native golden recapture, case execution or current score.' });
  }
  report.artifacts.push(await checkFile(download.executable, { sha256: download.nodeSha256 }, true));
  const baselineManifest = data.get('benchmarks/reports/baseline-only-20260827/coverage-execution/attempt-002/manifest.json');
  report.baselineOnlyRuntimePrerequisites = [];
  for (const entry of baselineManifest.runtimeAssets) {
    report.baselineOnlyRuntimePrerequisites.push(await checkFile(contained(repository, entry.path), { sha256: entry.sha256, bytes: entry.bytes }));
  }
  for (const entry of baselineManifest.resolvedDependencies) {
    if (!entry.path.startsWith(`${repository}/benchmarks/node_modules/`)) throw new Error('Unexpected baseline dependency location');
    report.baselineOnlyRuntimePrerequisites.push(await checkFile(entry.path, { sha256: entry.sha256, bytes: entry.bytes }));
  }
  report.baselineOnlyRuntimeBoundary = 'Eleven recorded worker/WASM/data assets and eighteen dependency entry files hashed, never loaded. Only files under authenticated just-bash package inherit that package publication proof; other entries remain historical hash comparisons, not publication authentication or full live dependency closure.';
  report.lockGraphBounds = data.get(`${authentication}/lock-graph-check.json`).roots.map(entry => ({ root: entry.root, lockSha256: entry.lockSha256, hiddenLockSha256: entry.hiddenLockSha256, declaredPackageEntries: entry.declaredPackageEntries, installedPackageEntries: entry.installedPackageEntries, notInInstalledHiddenLock: entry.notInInstalledHiddenLock }));
}

for (const prerequisite of inputs.nativePrerequisites) {
  report.nativePrerequisites.push({ ...prerequisite, actual: await checkFile(prerequisite.path, { sha256: prerequisite.sha256, ...(prerequisite.bytes === undefined ? {} : { bytes: prerequisite.bytes }), ...(prerequisite.modeOctal === undefined ? {} : { modeOctal: prerequisite.modeOctal }) }, true) });
}
report.unresolvedHistoricalNativeNames = inputs.unresolvedHistoricalNativeNames.map(name => ({ name, status: 'BLOCKED_PREREQUISITE', reason: 'No usable identity in the historical baseline-only harness; do not substitute another profile or silently install.', independentlyRecordedProfile: name === 'file' ? 'file5.41-libmagic-Darwin' : name === 'tree' ? 'tree2.2.1-Darwin' : null }));
report.totalHashBytes = totalHashBytes;
report.uniqueHashedPathPolicies = cache.size;
report.summary = {
  evidenceVerified: report.evidence.filter(entry => entry.status === 'VERIFIED_BYTES').length,
  treesVerified: report.trees.filter(entry => entry.status === 'VERIFIED_BYTES_AND_MEMBERSHIP').length,
  nativeRecordsVerified: report.nativePrerequisites.filter(entry => entry.actual.status === 'VERIFIED_BYTES').length,
  nativeRecordsBlocked: report.nativePrerequisites.filter(entry => entry.actual.status !== 'VERIFIED_BYTES').length,
  unresolvedHistoricalNativeNames: report.unresolvedHistoricalNativeNames.length,
  blockingObservations: report.blockers.length,
};
report.auditStatus = report.blockers.length ? 'HASH_AUDIT_COMPLETE_WITH_BLOCKED_PREREQUISITES' : 'HASH_AUDIT_COMPLETE_NOT_RELEASE_AUTHORIZATION';
for (const tree of report.trees) {
  tree.files = tree.files.map(entry => ({ path: path.relative(tree.root, entry.path), bytes: entry.bytes, sha256: entry.hashes?.sha256, modeOctal: entry.modeOctal, status: entry.status, ...(entry.error ? { error: entry.error } : {}) }));
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.blockers.length || report.unresolvedHistoricalNativeNames.length ? 2 : 0;
