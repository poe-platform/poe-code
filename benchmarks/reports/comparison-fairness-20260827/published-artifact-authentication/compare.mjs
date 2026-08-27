import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const replay = 'benchmarks/reports/current-integration/comparison-replay-20260827';
const freeze = '/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product';
const read = filename => JSON.parse(fs.readFileSync(filename));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => {
  const filename = path.join(output, name);
  if (fs.existsSync(filename)) {
    const previous = read(filename);
    const { checkedAt: previousTime, ...previousStable } = previous;
    const { checkedAt: currentTime, ...currentStable } = value;
    assert.deepEqual(currentStable, previousStable, `existing offline result changed: ${name}`);
    return;
  }
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
};
const download = read(path.join(output, 'download.json'));
const extracted = read(path.join(output, 'published-files.json'));
assert.ok(download.integrityMatches);
const sealed = read(`${replay}/frozen-files.json`), seal = read(`${replay}/seal.json`);
assert.equal(hash(JSON.stringify(sealed)), seal.frozenFilesSha256);
const dependencies = read(`${replay}/dependency-manifest.json`);
const installedRoot = path.join(freeze, 'benchmarks/node_modules/just-bash');
function walk(root, relative = '') {
  const rows = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = relative ? `${relative}/${entry.name}` : entry.name;
    const stat = fs.lstatSync(path.join(root, filename));
    assert.ok(!stat.isSymbolicLink(), `link: ${filename}`);
    if (stat.isDirectory()) rows.push(...walk(root, filename));
    else { assert.ok(stat.isFile(), `special: ${filename}`); const bytes = fs.readFileSync(path.join(root, filename)); rows.push({ path: filename, bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o7777 }); }
  }
  return rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
const installedFiles = walk(installedRoot);
const installedByPath = new Map(installedFiles.map(row => [row.path, row]));
const publishedByPath = new Map(extracted.files.map(row => [row.path, row]));
const differences = [];
const rows = [...new Set([...publishedByPath.keys(), ...installedByPath.keys()])].sort().map(filename => {
  const published = publishedByPath.get(filename), installed = installedByPath.get(filename);
  const frozen = sealed[`benchmarks/node_modules/just-bash/${filename}`];
  const actualExtracted = published ? hash(fs.readFileSync(path.join(extracted.destination, filename))) : null;
  const equal = Boolean(published && installed && published.sha256 === installed.sha256 && actualExtracted === published.sha256 && frozen?.sha256 === installed.sha256);
  const result = { path: filename, publishedBytes: published?.bytes ?? null, installedBytes: installed?.bytes ?? null, publishedSha256: published?.sha256 ?? null, installedSha256: installed?.sha256 ?? null, sealedSha256: frozen?.sha256 ?? null, extractedSha256: actualExtracted, bytesAndMembershipEqual: equal, publishedMode: published?.archiveMode ?? null, installedMode: installed?.mode ?? null };
  if (!equal) differences.push(result);
  return result;
});
write('package-comparison.json', { checkedAt: new Date().toISOString(), installedRoot, authenticatedRoot: extracted.destination, publishedCount: extracted.fileCount, installedCount: installedFiles.length, metadataCount: download.expected.fileCount, publishedBytes: extracted.totalFileBytes, metadataUnpackedBytes: download.expected.unpackedSize, allEqual: differences.length === 0, differences, files: rows });
assert.ok(differences.length === 0, 'STOP: package mismatch; no product run');
assert.equal(extracted.fileCount, download.expected.fileCount);
assert.equal(extracted.totalFileBytes, download.expected.unpackedSize);
const dependencyChecks = [];
for (const [directory, manifest] of Object.entries(dependencies)) {
  const regularizedManifest = Object.fromEntries(Object.entries(manifest.paths).map(([filename, entry]) => [filename, { ...entry, originalSymlink: null }]));
  const actual = walk(path.join(freeze, directory));
  const actualMap = new Map(actual.map(row => [row.path, row]));
  const differences = [];
  const modeDifferences = [];
  for (const filename of [...new Set([...Object.keys(manifest.paths), ...actualMap.keys()])].sort()) {
    const previous = manifest.paths[filename], observed = actualMap.get(filename), sealedEntry = sealed[`${directory}/${filename}`];
    if (!previous || !observed || previous.sha256 !== observed.sha256 || sealedEntry?.sha256 !== observed.sha256) differences.push({ path: filename, expected: previous ?? null, actual: observed ?? null, sealed: sealedEntry ?? null });
    if (previous && observed && previous.mode !== observed.mode) modeDifferences.push({ path: filename, recordedMode: previous.mode, observedMode: observed.mode, onlyWriteBitsRemoved: (previous.mode & ~0o222) === observed.mode });
  }
  dependencyChecks.push({ directory, count: actual.length, copiedTreeSha256: manifest.copiedTreeSha256, recomputedCopiedTreeSha256: hash(JSON.stringify(regularizedManifest)), sourceManifestTreeSha256: hash(JSON.stringify(manifest.paths)), observedCanonicalPathBytesModesSha256: hash(JSON.stringify(actual)), manifestFileSha256: hash(fs.readFileSync(`${replay}/dependency-manifest.json`)), differences, modeDifferences, modePolicy: 'prepare.mjs:116 deliberately removes write bits after recording the seal; actual read-only modes retained and execution copy preserves them', files: actual, authenticity: directory === 'benchmarks/node_modules' ? 'just-bash subtree authenticated above; all other dependencies only sealed byte/membership equal, not independently downloaded/authenticated; mode differences separate' : 'development/tooling dependencies only sealed byte/membership equal, not published-tarball authenticated; mode differences separate' });
  assert.equal(differences.length, 0, `STOP: dependency drift ${directory}`);
  assert.equal(hash(JSON.stringify(regularizedManifest)), manifest.copiedTreeSha256);
  assert.ok(modeDifferences.every(row => row.onlyWriteBitsRemoved));
}
write('dependency-tree-comparison.json', { checkedAt: new Date().toISOString(), roots: dependencyChecks });
const accepted = '245799e7498c849098ca971fe00270112aa5e06e';
const benchmarkLockBytes = execFileSync('git', ['show', `${accepted}:benchmarks/package-lock.json`], { maxBuffer: 8 * 1024 * 1024 });
const benchmarkLock = JSON.parse(benchmarkLockBytes);
const mainLockBytes = fs.readFileSync(path.join(freeze, 'package-lock.json'));
assert.equal(hash(mainLockBytes), sealed['package-lock.json'].sha256);
assert.equal(hash(benchmarkLockBytes), dependencies['benchmarks/node_modules'].lockSha256);
assert.equal(hash(mainLockBytes), dependencies.node_modules.lockSha256);
const publishedManifestBytes = fs.readFileSync(path.join(extracted.destination, 'package.json'));
const publishedManifest = JSON.parse(publishedManifestBytes);
const registryManifest = read(path.join(output, 'registry-metadata.raw.json'));
const matchingFields = ['name', 'version', 'type', 'main', 'types', 'exports', 'dependencies', 'optionalDependencies', 'engines'];
function stable(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value; }
const manifestFields = matchingFields.map(field => ({ field, equal: JSON.stringify(stable(publishedManifest[field])) === JSON.stringify(stable(registryManifest[field])) }));
assert.ok(manifestFields.every(row => row.equal));
const lockRow = benchmarkLock.packages['node_modules/just-bash'];
assert.equal(lockRow.integrity, download.actual.sriSha512); assert.equal(lockRow.resolved, download.officialTarball.url); assert.equal(lockRow.version, '3.4.2');
const historical = read('benchmarks/reports/expanded-20260827/corrected-bd2cacb/report.json');
const identities = { manifest: { actual: hash(publishedManifestBytes), historical: historical.baseline.manifestSha256 }, bundle: { actual: publishedByPath.get('dist/bundle/index.js').sha256, historical: historical.baseline.bundleSha256 }, benchmarkLock: { actual: hash(benchmarkLockBytes), historical: historical.baseline.lockSha256 } };
assert.ok(Object.values(identities).every(row => row.actual === row.historical));
const entryCandidates = [publishedManifest.main, publishedManifest.exports['.'].import.default, publishedManifest.exports['.'].require.default, publishedManifest.exports['.'].browser, publishedManifest.exports['./browser'].import];
const assets = extracted.files.filter(row => row.path.startsWith('dist/bundle/') || /\.(wasm|data)$/.test(row.path) || /worker/.test(path.basename(row.path))).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
write('manifest-lock-entry.json', { acceptedEvidenceCommit: accepted, manifestFields, manifestByteEquality: true, historicalIdentities: identities, historicalLimit: 'Original expanded run records only baseline manifest/bundle/lock identity; no new full historical dependency authenticity or retrospective universal module-load proof.', frozenMainLock: { sha256: hash(mainLockBytes), packages: Object.keys(JSON.parse(mainLockBytes).packages).length, treeEqual: true }, frozenBenchmarkLock: { sha256: hash(benchmarkLockBytes), packages: Object.keys(benchmarkLock.packages).length, baseline: lockRow, graph: benchmarkLock.packages }, entryCandidates: [...new Set(entryCandidates)].map(filename => ({ path: filename, sha256: publishedByPath.get(filename.replace(/^\.\//, ''))?.sha256 ?? null })), actualFrozenEngineEntry: 'dist/bundle/index.js', authenticatedBundledAndWorkerAssets: assets, assetLimit: 'All published files are authenticated, including workers/bundled assets. Inclusion does not prove an optional asset executed; external dependency assets remain tree-equal only.' });
const importChecks = [];
for (const phase of ['original', 'scratch-aligned']) {
  const records = fs.readFileSync(`${replay}/${phase}/imports.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
  const packageEvents = records.filter(row => row.actual?.startsWith(`${installedRoot}/`));
  const unique = [...new Set(packageEvents.map(row => row.actual.slice(installedRoot.length + 1)))].sort();
  const mismatches = packageEvents.filter(row => publishedByPath.get(row.actual.slice(installedRoot.length + 1))?.sha256 !== row.sourceSha256);
  assert.equal(mismatches.length, 0);
  importChecks.push({ phase, retainedLogSha256: hash(fs.readFileSync(`${replay}/${phase}/imports.jsonl`)), packageLoadAttemptEvents: packageEvents.length, uniquePackagePaths: unique.map(filename => ({ path: filename, sha256: publishedByPath.get(filename).sha256 })), entryLoadAttemptPids: [...new Set(packageEvents.filter(row => row.actual.endsWith('/dist/bundle/index.js')).map(row => row.pid))], mismatches, interpretation: 'Prior loader logs before nextLoad: evidence of path/hash load attempts, not completed evaluation of every module. Engine ready after awaited entry import and complete observations support bounded successful entry use through control flow; original ready/request/settlement ledger was not retained.' });
}
write('historical-import-authentication.json', { phases: importChecks });
const copyRoot = path.join(download.scratch, 'execution-closure');
fs.mkdirSync(copyRoot, { mode: 0o700 });
const copied = [];
let totalBytes = 0;
const selected = Object.keys(sealed).filter(filename => filename.startsWith('node_modules/') || filename.startsWith('benchmarks/node_modules/') || /^profiles\/(original|scratch-aligned)\/benchmarks\/expanded\/(engine|common|recipes|server)\.mjs$/.test(filename) || ['package.json', 'package-lock.json', 'benchmarks/package.json', 'benchmarks/package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(filename));
assert.ok(selected.length < 4096);
for (const filename of selected) {
  const packageRelative = filename.startsWith('benchmarks/node_modules/just-bash/') ? filename.slice('benchmarks/node_modules/just-bash/'.length) : null;
  const origin = packageRelative ? path.join(extracted.destination, packageRelative) : path.join(freeze, filename);
  const stat = fs.lstatSync(origin); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const bytes = fs.readFileSync(origin); assert.equal(hash(bytes), sealed[filename].sha256);
  totalBytes += bytes.length; assert.ok(totalBytes < 512 * 1024 * 1024);
  const target = path.join(copyRoot, filename); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: sealed[filename].mode & ~0o222 });
  assert.equal(hash(fs.readFileSync(target)), sealed[filename].sha256);
  copied.push({ path: filename, bytes: bytes.length, sha256: sealed[filename].sha256, mode: fs.lstatSync(target).mode & 0o777, origin: packageRelative ? 'independently extracted authenticated package' : 'sealed frozen execution dependency/helper' });
}
write('execution-closure.json', { root: copyRoot, at: new Date().toISOString(), packageOrigin: extracted.destination, files: copied, count: copied.length, totalBytes, mapSha256: hash(JSON.stringify(copied)), productSourceNotCopied: true, approvalStatus: 'Product execution NOT authorized by this copy; requires explicit root approval of /tmp/safe-bash-baseline-auth-plan.txt' });
console.log(JSON.stringify({ packageFiles: rows.length, packageEqual: true, dependencyRoots: dependencyChecks.map(row => ({ directory: row.directory, count: row.count, differences: row.differences.length })), historicalIdentities: identities, copiedFiles: copied.length, copiedBytes: totalBytes, copyRoot }));
