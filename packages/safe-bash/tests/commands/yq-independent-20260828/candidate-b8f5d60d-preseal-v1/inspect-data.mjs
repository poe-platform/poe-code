import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../../..');
const prefix = 'tests/commands/yq-independent-20260828/';
const ownRelative = prefix + 'candidate-b8f5d60d-preseal-v1/';
const evidenceRoot = 'tests/commands/yq-author-20260828/repair-allocation-v1/evidence-v2/';
const handoffPath = 'tests/commands/yq-author-20260828/repair-allocation-v1/HANDOFF.md';
const revisions = {
  source: 'b8f5d60d75452e1dd181167fb87abd995221f6e3', evidence: '644460b932feb6fa87222b7042d705da1219cf0c', handoff: '065f824d06e36de3fafaee1b7a5baa278f40407c',
  baseline: '5137a74ec855a32d8a8860eb66b62eb44d11e290', length: '74361026502d76b8c2b696f9c60e410ac9b78d95',
  oldSource: '35da18547ca82a67be9ca22b4adc21e3b8060780', oldPacket: '71a16afd5b430175180fc4741531b75c31b25882', oldBuild: 'f7503dc7dce11f9a3072b3670df498d64305d737', oldActual: '4b219eae180fcd2fd15ea864c9bc5226c54cda04',
  consumers: '90c4c50070334a34c1b75d78f7da25d302f6bb61', baselineConsumers: '409449136ae1adc252ff6e205a6bb5785d113d0f',
  originalTests: '1d802e7af02add9e334ab934668d41d6e5ffbbe2', repairTests: 'e889e5236ec5666977697bb758dce510d689efe3', driver: '03dd10ec4901a4356df5bfcf5b24bd9ae125d371',
  freeze: 'bd471ef682d768692a682d40009a874f51e3ad68', freezeReview: 'de89e478d8ddce62eac955708f1b87d7be1bd137',
};
const additions = ['src/commands/structured/query-core.ts', 'src/commands/yq/README.md', 'src/commands/yq/accounting.ts', 'src/commands/yq/encoder.ts', 'src/commands/yq/errors.ts', 'src/commands/yq/index.ts', 'src/commands/yq/parser.ts'];
const changedFive = additions.filter(path => !path.endsWith('README.md') && !path.endsWith('errors.ts'));
const roots = ['src', 'README.md', 'package.json', 'tsconfig.json', 'tsconfig.build.json'];
const archiveExtras = ['package-lock.json', 'scripts/typecheck.mjs'];
const originalTests = ['tests/commands/yq-author-20260828/PROTOCOL.md', 'tests/commands/yq-author-20260828/vectors.json', 'tests/commands/yq-author-20260828/tsconfig.json', 'tests/commands/yq-author-20260828/yq.test.ts'];
const repairTests = ['tests/commands/yq-author-20260828/repair-allocation-v1/PROTOCOL.md', 'tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts'];
const parentTests = ['tests/commands/structured-stress/harness.ts', 'tests/commands/structured-stress/join-safety.test.ts'];
const expectedArchive = 'fe76de08017859b066ecb8830846e109cdab6fa3953b0317e5fc6f27777fd878';
const expectedPackage = '1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? JSON.stringify(value.map(entry => JSON.parse(canonical(entry)))) : value && typeof value === 'object' ? JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))) : JSON.stringify(value);
const equal = (actual, expected, label) => assert.equal(canonical(actual), canonical(expected), label);
const descriptor = (bytes, mode = 420) => ({ sha256: hash(bytes), bytes: bytes.length, mode });
const git = (...args) => execFileSync('git', ['-C', repository, ...args], { maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', LANG: 'C', LC_ALL: 'C' } });
const readGit = (revision, path) => git('show', `${revision}:${path}`);
const readJson = (revision, path) => JSON.parse(readGit(revision, path));
const reference = (revision, path, pointer) => ({ revision, path, blob: git('rev-parse', `${revision}:${path}`).toString().trim(), ...descriptor(readGit(revision, path)), ...(pointer ? { pointer } : {}) });

function safePath(path) {
  assert(typeof path === 'string' && path.length > 0 && path.length <= 1024, 'PATH');
  assert(!path.split('/').some(part => part.toLowerCase() === 'agents.md'), `AGENTS_CONTRADICTION: ${path}`);
  assert(path.split('/').every(part => /^[A-Za-z0-9_.-]+$/u.test(part) && !['.', '..', '__proto__', 'constructor', 'prototype', 'node_modules'].includes(part)), `UNSAFE_PATH: ${path}`);
  return path;
}

function tree(revision, paths, product = true) {
  return git('ls-tree', '-r', '-z', revision, '--', ...paths).toString().split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/u.exec(row); assert(match, 'GIT_ROW');
    if (product) { assert.equal(match[1], '100644'); assert.equal(match[2], 'blob'); safePath(match[4]); }
    return { mode: match[1], type: match[2], blob: match[3], path: match[4], revision };
  });
}

function blobs(rows) {
  const output = execFileSync('git', ['-C', repository, 'cat-file', '--batch'], { input: rows.map(row => row.blob).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  let offset = 0;
  return rows.map(row => {
    const end = output.indexOf(10, offset); assert(end >= 0);
    const [blob, type, sizeText] = output.subarray(offset, end).toString().split(' '); const size = Number(sizeText);
    assert.equal(blob, row.blob); assert.equal(type, 'blob'); assert(Number.isSafeInteger(size) && size >= 0 && size <= 16 * 1024 * 1024);
    const bytes = Buffer.from(output.subarray(end + 1, end + 1 + size)); assert.equal(bytes.length, size); assert.equal(output[end + 1 + size], 10);
    offset = end + 2 + size;
    return { ...row, data: bytes, identity: descriptor(bytes, Number.parseInt(row.mode, 8) & 4095) };
  });
}

function directoryMap(files) {
  const directories = { '': 493 };
  for (const path of Object.keys(files)) { let parent = posix.dirname(path); while (parent !== '.') { directories[parent] = 493; parent = posix.dirname(parent); } }
  return directories;
}

function inspectTar(bytes, packagePrefix) {
  assert(bytes.length <= 16 * 1024 * 1024 && bytes.length % 512 === 0, 'TAR_BOUND');
  const seen = new Set(); const entries = []; let offset = 0;
  const text = (header, start, length) => header.subarray(start, start + length).toString('ascii').replace(/\0.*$/us, '');
  const octal = (header, start, length) => { const value = text(header, start, length).trim(); assert(/^[0-7]+$/u.test(value)); return Number.parseInt(value, 8); };
  while (offset + 512 <= bytes.length && bytes.subarray(offset, offset + 512).some(byte => byte !== 0)) {
    const header = bytes.subarray(offset, offset + 512); assert(!header.some(byte => byte > 127), 'TAR_ASCII');
    assert.equal(text(header, 257, 6), 'ustar'); assert.equal(text(header, 263, 2), '00');
    const name = safePath(text(header, 0, 100)); assert.equal(text(header, 345, 155), '', 'NO_PREFIX_ALIAS');
    assert(!seen.has(name), `DUPLICATE: ${name}`);
    assert(![...seen].some(prior => prior.startsWith(name + '/') || name.startsWith(prior + '/')), 'ENTRY_PREFIX_COLLISION'); seen.add(name);
    assert.equal(text(header, 156, 1), '0', `REGULAR_ONLY: ${name}`); assert.equal(text(header, 157, 100), '', 'NO_LINK');
    const mode = octal(header, 100, 8); assert.equal(mode, 420, 'ENTRY_MODE');
    let checksum = 0; for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(checksum, octal(header, 148, 8), 'HEADER_CHECKSUM');
    const size = octal(header, 124, 12); assert(Number.isSafeInteger(size) && size <= 16 * 1024 * 1024 && entries.length < 4096, 'ENTRY_BOUND');
    const end = offset + 512 + size; const next = offset + 512 + Math.ceil(size / 512) * 512;
    assert(next <= bytes.length, 'TRUNCATED'); assert(!bytes.subarray(end, next).some(byte => byte !== 0), 'ENTRY_PADDING');
    if (packagePrefix) assert(name.startsWith('package/'), 'PACKAGE_PREFIX');
    const path = safePath(packagePrefix ? name.slice(8) : name); const data = Buffer.from(bytes.subarray(offset + 512, end));
    entries.push({ path, name, offset, headerSha256: hash(header), identity: descriptor(data, mode), data }); offset = next;
  }
  assert(bytes.length - offset >= 1024 && !bytes.subarray(offset).some(byte => byte !== 0), 'TAR_TERMINATOR');
  return entries;
}

function snapshotHistory(revision, scope) {
  const rows = tree(revision, [scope], false); const root = join(repository, scope);
  assert.equal(realpathSync(root), root); const actualFiles = {}; const directories = {};
  let totalBytes = 0;
  const walk = path => {
    const stat = lstatSync(join(root, path)); assert(stat.isDirectory() && !stat.isSymbolicLink()); directories[path] = stat.mode & 4095;
    for (const name of readdirSync(join(root, path)).sort()) {
      const child = path ? path + '/' + name : name; const filename = join(root, child); const before = lstatSync(filename);
      assert(!before.isSymbolicLink());
      if (before.isDirectory()) walk(child);
      else {
        assert(before.isFile() && before.nlink === 1 && before.size <= 64 * 1024 * 1024); totalBytes += before.size; assert(totalBytes <= 512 * 1024 * 1024);
        const bytes = readFileSync(filename); const after = lstatSync(filename); assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode); assert.equal(after.mtimeMs, before.mtimeMs);
        actualFiles[child] = { ...descriptor(bytes, before.mode & 4095), blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
      }
    }
  };
  walk('');
  equal(Object.keys(actualFiles).sort(), rows.map(row => row.path.slice(scope.length + 1)).sort(), `HISTORICAL_MEMBERSHIP: ${scope}`);
  for (const row of rows) { const actual = actualFiles[row.path.slice(scope.length + 1)]; assert.equal(row.type, 'blob'); assert.equal(actual.blob, row.blob); assert.equal(actual.mode, Number.parseInt(row.mode, 8) & 4095); }
  return { revision, scope, gitTree: git('rev-parse', `${revision}:${scope}`).toString().trim(), files: rows.length, directories: Object.keys(directories).length, bytes: totalBytes, completeSnapshotSha256: hash(canonical({ files: actualFiles, directories })), addedEntriesChecked: true };
}

function writeJson(name, value, compact = false) {
  safePath(name); assert(!existsSync(join(own, name)), 'NO_OVERWRITE');
  const bytes = Buffer.from(JSON.stringify(value, null, compact ? undefined : 2) + '\n');
  execFileSync('apply_patch', [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${ownRelative}${name}\n${bytes.toString().trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
  assert(readFileSync(join(own, name)).equals(bytes)); return { path: join(own, name), ...descriptor(bytes) };
}

function literalGraph(entries) {
  const byPath = new Map(entries.map(entry => [entry.path, entry])); const seen = new Set(); const builtins = new Set(); const edges = [];
  const visit = path => {
    if (seen.has(path)) return; seen.add(path); const entry = byPath.get(path); assert(entry, `MISSING_IMPORT: ${path}`);
    const body = entry.data.toString('utf8'); assert(!/\bimport\s*\(/u.test(body), 'DYNAMIC_IMPORT_REQUIRES_REVIEW');
    for (const match of body.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gu)) {
      const specifier = match[1]; edges.push({ parent: path, specifier });
      if (specifier.startsWith('node:')) builtins.add(specifier);
      else { assert(specifier.startsWith('./') || specifier.startsWith('../')); const target = safePath(posix.normalize(posix.join(posix.dirname(path), specifier))); assert(target.startsWith('dist/') && target.endsWith('.js')); visit(target); }
    }
  };
  ['dist/commands/yq/index.js', 'dist/contracts/index.js'].forEach(visit);
  return { method: 'Literal import text inspection only, not module loading or authoritative parser proof', roots: ['dist/commands/yq/index.js', 'dist/contracts/index.js'], files: [...seen].sort(), builtins: [...builtins].sort(), edges };
}

function runtimeTreeHash(files, directories) {
  const entries = []; const walk = path => {
    entries.push({ path: path || '.', kind: 'directory', mode: directories[path] });
    for (const child of [...Object.keys(files), ...Object.keys(directories).filter(Boolean)].filter(child => posix.dirname(child) === (path || '.')).sort()) {
      if (Object.hasOwn(directories, child)) walk(child); else { const value = files[child]; entries.push({ path: child, kind: 'file', mode: value.mode, bytes: value.bytes, sha256: value.sha256 }); }
    }
  }; walk(''); return hash(JSON.stringify(entries));
}

async function main() {
  assert.equal(repository, '/Users/kjopek/Workspace/safe-bash'); assert.equal(process.argv.length, 3); assert(!existsSync(join(own, 'RESULT.json')), 'ONE_STATIC_PASS');
  const presealBytes = readFileSync(join(own, 'DATA-PRESEAL.json')); assert.equal(hash(presealBytes), process.argv[2]);
  for (const [name, expected] of Object.entries(JSON.parse(presealBytes).files)) equal(descriptor(readFileSync(join(own, name)), lstatSync(join(own, name)).mode & 4095), expected, 'DATA_PRESEAL');
  for (const revision of Object.values(revisions)) assert.equal(git('rev-parse', `${revision}^{commit}`).toString().trim(), revision);
  const histories = [[revisions.oldPacket, prefix + 'candidate-35da1854-v1'], [revisions.oldBuild, prefix + 'candidate-35da1854-build-v1'], [revisions.oldActual, prefix + 'actual-35da1854-v1']];
  const historyBefore = histories.map(([revision, scope]) => snapshotHistory(revision, scope));
  const priorMapRef = reference(revisions.oldPacket, prefix + 'candidate-35da1854-v1/MAPS.json'); const oldMaps = readJson(priorMapRef.revision, priorMapRef.path);
  const baseRef = reference(revisions.baselineConsumers, prefix + 'executor-preparation-v1/consumers/SOURCE-BASE.json'); const sourceBase = readJson(baseRef.revision, baseRef.path);
  const baselinePackageRef = reference(revisions.baselineConsumers, prefix + 'executor-preparation-v1/consumers/BASELINE-PACKAGE.json'); const baselinePackage = readJson(baselinePackageRef.revision, baselinePackageRef.path);
  const selected = readJson(revisions.baselineConsumers, prefix + 'executor-preparation-v1/consumers/SELECTED.json');
  const baselineReportRef = selected.selected.find(entry => entry.path.endsWith('full-package-addendum-v1/result/REPORT.json'));
  const baselineReportBytes = readGit(baselineReportRef.revision, baselineReportRef.path); assert.equal(hash(baselineReportBytes), baselineReportRef.sha256); equal(JSON.parse(baselineReportBytes).package.validation.files, baselinePackage, 'BASELINE_846_ORIGIN');
  const manifestRef = reference(revisions.evidence, evidenceRoot + 'SOURCE-MANIFEST.json'); const manifest = readJson(manifestRef.revision, manifestRef.path);
  assert.equal(manifest.sourceCommit, revisions.source); assert.equal(manifest.baseline, revisions.baseline); assert.equal(manifest.acceptedLength, revisions.length);
  const interpreterPath = 'src/commands/structured/interpreter.ts';
  const rows = [...tree(revisions.baseline, roots).filter(row => row.path !== interpreterPath), ...tree(revisions.length, [interpreterPath]), ...tree(revisions.source, additions), ...tree(revisions.baseline, archiveExtras), ...tree(revisions.originalTests, originalTests), ...tree(revisions.repairTests, repairTests), ...tree(revisions.baseline, parentTests)];
  assert.equal(new Set(rows.map(row => row.path)).size, rows.length); assert.equal(new Set(manifest.files.map(row => row.path)).size, manifest.files.length);
  equal(rows.map(row => row.path).sort(), manifest.files.map(row => row.path).sort(), 'COMPLETE_AUTHOR_SELECTIONS');
  const selections = blobs(rows); const byPath = new Map(selections.map(row => [row.path, row]));
  for (const item of manifest.files) { const row = byPath.get(item.path); equal({ mode: row.mode, blob: row.blob, path: row.path, bytes: row.identity.bytes, sha256: row.identity.sha256 }, item, `MANIFEST_GIT: ${item.path}`); }
  const sourceEntries = selections.filter(row => !row.path.startsWith('tests/') && !archiveExtras.includes(row.path));
  const sourceFiles = Object.fromEntries(sourceEntries.map(row => [row.path, row.identity]));
  const sourceAdditions = Object.fromEntries(additions.map(path => [path, byPath.get(path).identity]));
  equal(sourceFiles, { ...Object.fromEntries(Object.entries(sourceBase).map(([path, value]) => [path, { sha256: value.sha256, bytes: value.bytes, mode: value.mode }])), ...sourceAdditions }, 'SOURCE_PROJECTION');
  const sourceChanges = Object.keys(sourceFiles).filter(path => canonical(sourceFiles[path]) !== canonical(oldMaps.source.files[path])); equal(sourceChanges.sort(), changedFive.sort(), 'EXACT_FIVE_SOURCE_CHANGES');
  equal(Object.keys(sourceFiles).sort(), Object.keys(oldMaps.source.files).sort(), 'UNCHANGED_PROJECTION_MEMBERSHIP');
  const archiveRaw = readGit(revisions.evidence, evidenceRoot + 'SOURCE.tar'); const packageRaw = readGit(revisions.evidence, evidenceRoot + 'package/virtual-bash-0.0.0.tgz');
  assert.equal(hash(archiveRaw), expectedArchive); assert.equal(hash(packageRaw), expectedPackage);
  const archive = inspectTar(archiveRaw, false); const packageTar = gunzipSync(packageRaw, { maxOutputLength: 16 * 1024 * 1024 }); const packed = inspectTar(packageTar, true);
  const archiveFiles = Object.fromEntries(archive.map(entry => [entry.path, entry.identity])); const packageFiles = Object.fromEntries(packed.map(entry => [entry.path, entry.identity]));
  equal(archiveFiles, Object.fromEntries(selections.filter(row => !row.path.startsWith('tests/')).map(row => [row.path, row.identity])), 'ACTUAL_ARCHIVE_MEMBERSHIP');
  const emittedNames = additions.filter(path => path.endsWith('.ts')).flatMap(path => ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => path.replace(/^src\//u, 'dist/').replace(/\.ts$/u, extension))).sort();
  const packageAdditions = Object.fromEntries(emittedNames.map(path => { assert(!Object.hasOwn(baselinePackage, path)); assert(packageFiles[path]); return [path, packageFiles[path]]; }));
  equal(packageFiles, { ...baselinePackage, ...packageAdditions }, 'COMPLETE_BASELINE_PLUS_EMISSIONS');
  equal(packageFiles['README.md'], byPath.get('README.md').identity, 'BASELINE_README'); equal(packageFiles['package.json'], byPath.get('package.json').identity, 'BASELINE_PACKAGE_METADATA');
  const packageChanges = Object.keys(packageFiles).filter(path => canonical(packageFiles[path]) !== canonical(oldMaps.fullPackage.files[path]));
  assert(packageChanges.every(path => emittedNames.includes(path)), 'NO_BASELINE_REPLACEMENT');
  equal(packed.map(entry => entry.name), oldMaps.fullPackage.entries.map(entry => entry.name), 'PACK_ORDER_MATCHES_OLD_REFERENCE');
  equal(archive.map(entry => entry.path), oldMaps.archive.entries.map(entry => entry.path), 'ARCHIVE_ORDER_MATCHES_OLD_REFERENCE');
  const graph = literalGraph(packed);
  const sourceDirectories = directoryMap(sourceFiles); const packageDirectories = directoryMap(packageFiles);
  equal(sourceDirectories, oldMaps.source.directories); equal(packageDirectories, oldMaps.fullPackage.directories);
  const sourceMapSha256 = hash(canonical(sourceFiles)); const packageMapSha256 = hash(canonical({ files: packageFiles, directories: packageDirectories }));
  const oldAuthorityRef = reference(revisions.consumers, prefix + 'executor-preparation-v1/consumers-v2/SOURCE-AUTHORITY.json'); const oldAuthority = readJson(oldAuthorityRef.revision, oldAuthorityRef.path);
  const handoffRef = reference(revisions.handoff, handoffPath);
  const newAuthority = { ...oldAuthority, candidateCommit: revisions.source, evidenceCommit: revisions.evidence, handoffCommit: revisions.handoff, manifest: { path: manifestRef.path, sha256: manifestRef.sha256, blob: manifestRef.blob }, handoff: { path: handoffRef.path, sha256: handoffRef.sha256 }, archive: { path: evidenceRoot + 'SOURCE.tar', sha256: expectedArchive }, package: { path: evidenceRoot + 'package/virtual-bash-0.0.0.tgz', sha256: expectedPackage }, newSources: manifest.files.filter(row => additions.includes(row.path)) };
  const authorityFile = writeJson('SOURCE-AUTHORITY.proposed.json', newAuthority);
  const sourceReceipt = { schema: 1, sourceBase: revisions.baseline, acceptedLength: revisions.length, candidateCommit: revisions.source, sourceAdditions };
  const sourceReceiptFile = writeJson('SOURCE-RECEIPT.proposed.json', sourceReceipt);
  const authorArtifactReceipt = writeJson('AUTHOR-ARTIFACT-RECEIPT.json', { schema: 1, candidateCommit: revisions.source, sourceMapSha256, packageMapSha256, classification: 'BOUND_AUTHOR_BUILD', proofRole: 'AUTHOR_ARTIFACT_BINDING_ONLY', independentlyCompiled: false, rootTrustedBuildReceipt: false, admission: 'DENY_PENDING_FRESH_ROOT_GO', evidenceCommit: revisions.evidence, archive: { path: evidenceRoot + 'SOURCE.tar', ...descriptor(archiveRaw) }, package: { path: evidenceRoot + 'package/virtual-bash-0.0.0.tgz', ...descriptor(packageRaw) }, authorReport: reference(revisions.evidence, evidenceRoot + 'REPORT.json') });
  const fullReceipt = { ...sourceReceipt, packageAdditions, packageDirectories, entries: { yq: 'dist/commands/yq/index.js', contracts: 'dist/contracts/index.js' }, allowedBuiltins: graph.builtins, buildReceipt: { path: authorArtifactReceipt.path, sha256: authorArtifactReceipt.sha256 } };
  const fullReceiptFile = writeJson('FULL-RECEIPT.proposed.json', fullReceipt);
  const composition = writeJson('COMPOSITION.json', { schema: 1, sourceBase: baseRef, baselinePackage: baselinePackageRef, previousCompleteMaps: priorMapRef, source: { filesRecipe: 'sourceBase descriptors plus sourceAdditions; all baseline revisions/blobs reauthenticated independently', sourceAdditions, directories: sourceDirectories, sourceMapSha256, runtimeTreeSha256: runtimeTreeHash(sourceFiles, sourceDirectories), files: Object.keys(sourceFiles).length }, sourceDelta: sourceChanges.map(path => ({ path, before: oldMaps.source.files[path], after: sourceFiles[path], revision: revisions.source, blob: byPath.get(path).blob })), archive: { ...descriptor(archiveRaw), files: archive.length, supportFilesOutsideProjection: archiveExtras.map(path => ({ path, revision: revisions.baseline, blob: byPath.get(path).blob, ...byPath.get(path).identity })), orderReference: { ...priorMapRef, pointer: '/archive/entries', compareField: 'path', equality: true }, entryHeadersSha256: hash(canonical(archive.map(({ name, offset, headerSha256 }) => ({ name, offset, headerSha256 })))), tarDirectoryEntries: 0 }, package: { ...descriptor(packageRaw), filesRecipe: 'baselinePackage complete846 map plus packageAdditions', packageAdditions, directories: packageDirectories, directoryModesRole: 'Proposed regular materialization0755; no directory entries exist in tar', packageMapSha256, runtimeTreeSha256: runtimeTreeHash(packageFiles, packageDirectories), files: packed.length, changes: packageChanges.map(path => ({ path, before: oldMaps.fullPackage.files[path], after: packageFiles[path] })), orderReference: { ...priorMapRef, pointer: '/fullPackage/entries', compareField: 'name', equality: true }, tarSha256: hash(packageTar), tarBytes: packageTar.length, entryHeadersSha256: hash(canonical(packed.map(({ name, offset, headerSha256 }) => ({ name, offset, headerSha256 })))), tarDirectoryEntries: 0 }, excludedAuthorSelections: selections.filter(row => row.path.startsWith('tests/')).map(({ path, revision, blob, mode, identity }) => ({ path, revision, blob, gitMode: mode, ...identity, role: 'AUTHOR_TEST_DATA_NOT_PRODUCTION_OR_INDEPENDENT_TESTS' })), newSources: newAuthority.newSources, readme: { ...selected.readme, independentlyCompared: true }, importGraph: graph }, true);
  const wholeRows = tree(revisions.source, roots, false); const selectedByPath = new Map(sourceEntries.map(row => [row.path, row]));
  const whole = { candidateCommit: revisions.source, wholeRepositoryGitTree: git('rev-parse', `${revisions.source}^{tree}`).toString().trim(), wholeProductScopeEntries: wholeRows.length, scope: roots, selectedProjectionEntries: sourceEntries.length, sameAsSelectedProjection: false, extraPaths: wholeRows.filter(row => !selectedByPath.has(row.path)), changedSelectedPaths: wholeRows.filter(row => selectedByPath.has(row.path) && (selectedByPath.get(row.path).blob !== row.blob || selectedByPath.get(row.path).mode !== row.mode)), sourceCommitWriteSet: git('diff-tree', '--no-commit-id', '--name-status', '-r', revisions.source).toString().trim().split('\n'), evidenceWriteSet: git('diff-tree', '--no-commit-id', '--name-status', '-r', revisions.evidence).toString().trim().split('\n'), handoffWriteSet: git('diff-tree', '--no-commit-id', '--name-status', '-r', revisions.handoff).toString().trim().split('\n') };
  equal(whole.sourceCommitWriteSet.filter(row => row.startsWith('M\tsrc/')).map(row => row.slice(2)).sort(), changedFive.sort(), 'SOURCE_COMMIT_PRODUCT_WRITESET');
  const wholeFile = writeJson('GIT-IDENTITIES.json', whole);
  const oldBuildInputsRef = reference(revisions.oldBuild, prefix + 'candidate-35da1854-build-v1/INPUTS.json'); const oldBuildInputs = readJson(oldBuildInputsRef.revision, oldBuildInputsRef.path);
  const toolFile = writeJson('TOOLCHAIN-AND-PROOF-ROLES.json', { schema: 1, oldToolProof: oldBuildInputsRef, tools: { node: oldBuildInputs.tools.node, typescript: oldBuildInputs.tools.typescript.pin, nodeTypes: oldBuildInputs.tools.nodeTypes.pin, undiciTypes: oldBuildInputs.tools.undiciTypes.pin }, currentToolReauthentication: 'NOT_PERFORMED; required before any future build/loader invocation', reusable: ['Exact tool byte pins and tree-hash algorithms, subject to fresh authentication', 'Unchanged selected baseline/configuration identities', 'Scoped compiler command and explicitly declared map relocation / archive serialization methods, not old product outcomes'], notReusableAsSuccess: ['Old independent35da source-to-output proof', 'Any affected source/installed/moved semantic, type, loaded-mutant, lifecycle or cap result', 'Historical author claims, CMD22 failure or deadlineUNRUN'], buildRecipe: reference(revisions.oldBuild, prefix + 'candidate-35da1854-build-v1/RECIPE.md'), futureBuildCommandTemplate: ['PINNED_NODE', 'PINNED_TYPESCRIPT/lib/tsc.js', '--project', 'NEW_SELECTED_SOURCE/tsconfig.build.json', '--outDir', 'FRESH_OUTPUT/dist', '--typeRoots', 'PINNED_TYPES/types'], newExpectedOutputs: fullReceiptFile, configIdentities: { 'tsconfig.json': sourceFiles['tsconfig.json'], 'tsconfig.build.json': sourceFiles['tsconfig.build.json'] }, loader: { entries: Object.fromEntries(['dist/commands/yq/index.js', 'dist/commands/yq/index.d.ts', 'dist/contracts/index.js', 'dist/contracts/index.d.ts', 'dist/commands/structured/query-core.js', 'dist/commands/structured/query-core.d.ts'].map(path => [path, packageFiles[path]])), allowedBuiltins: graph.builtins, materializedRoots: null, proofRole: 'DIRECT_MODULE_ONLY_NOT_PUBLIC_INTEGRATION', runtimeTreeHashProfile: 'Derived from complete expected maps; no tree was materialized or loaded', sourceTreeSha256: runtimeTreeHash(sourceFiles, sourceDirectories), compiledTreeSha256: runtimeTreeHash(packageFiles, packageDirectories) }, admission: 'DENY_PENDING_FRESH_ROOT_GO' });
  const report = readJson(revisions.evidence, evidenceRoot + 'REPORT.json'); const metadata = JSON.parse(packed.find(entry => entry.path === 'package.json').data);
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0); assert(!Object.keys(metadata.exports ?? {}).some(key => key.includes('yq')));
  const historyAfter = histories.map(([revision, scope]) => snapshotHistory(revision, scope)); equal(historyAfter, historyBefore, 'HISTORICAL_BEFORE_AFTER');
  assert.equal(hash(readGit(revisions.evidence, evidenceRoot + 'SOURCE.tar')), expectedArchive); assert.equal(hash(readGit(revisions.evidence, evidenceRoot + 'package/virtual-bash-0.0.0.tgz')), expectedPackage);
  const historyFile = writeJson('HISTORY-PRESERVATION.json', { before: historyBefore, after: historyAfter, unchanged: true, role: 'Byte/mode/membership preservation only; no historical results rescored or invoked', limitations: 'Snapshots detect added entries at observations, not change-and-restore or atomic namespace transactions' });
  const result = writeJson('RESULT.json', { date: '2026-08-28', completedAt: new Date().toISOString(), status: 'DATA_BOUND_DENY_PENDING_FRESH_ROOT_GO', revisions, admission: 'DENY', currentGuardObservation: 'Static code inspection: consumers-v2 SOURCE-AUTHORITY pins35da; new candidate would fail selected-origin condition. No guard execution was performed.', ownDataPresealSha256: process.argv[2], handoff: handoffRef, authorManifest: manifestRef, archive: { path: evidenceRoot + 'SOURCE.tar', ...descriptor(archiveRaw) }, package: { path: evidenceRoot + 'package/virtual-bash-0.0.0.tgz', ...descriptor(packageRaw) }, counts: { authorManifest: manifest.files.length, excludedAuthorData: selections.filter(row => row.path.startsWith('tests/')).length, sourceProjection: sourceEntries.length, sourceBase: Object.keys(sourceBase).length, selectedAdditions: additions.length, changedSourcePaths: sourceChanges.length, archive: archive.length, baselinePackage: Object.keys(baselinePackage).length, packageAdditions: emittedNames.length, fullPackage: packed.length, changedPackageFiles: packageChanges.length, wholeProductScope: wholeRows.length }, sourceMapSha256, packageMapSha256, files: { sourceAuthority: authorityFile, sourceReceipt: sourceReceiptFile, fullReceipt: fullReceiptFile, authorArtifactReceipt, composition, wholeGit: wholeFile, toolchain: toolFile, history: historyFile }, authorEvidenceOnly: { report: reference(revisions.evidence, evidenceRoot + 'REPORT.json'), tests: report.tests, captureRoles: report.runs.length, packageClaims: report.package, qualification: report.qualification, notIndependentPasses: true }, observationTiming: '194+8 normative freeze predates candidate; candidate body/data inspection occurred before complete successor executor preseal. This is not an independent precode behavioral holdout.', execution: { productImports: 0, productRuns: 0, builds: 0, compilerRuns: 0, typeConsumers: 0, loadedMutants: 0, nativeYaml: 0, authorScripts: 0, harnessCohorts: 0, syntheticCases: 0, materializations: 0, repacks: 0, dependencies: 0 }, remaining: ['Root/plan-owner exact successor source/consumer/loader/runtime/integration seals and fresh execution GO', 'New independently authenticated scoped source-to-output build', 'Fresh affected source/installed/moved semantic and fixed-public-cap obligations', 'Separately owned runtime-v3-CMD22 result; preserve prior failures and UNRUN', 'Public YQ integration remains absent'] });
  writeJson('EXPECTED-HASHES.json', { schema: 1, result, sourceAuthority: authorityFile, sourceReceipt: sourceReceiptFile, fullReceipt: fullReceiptFile, authorArtifactReceipt, composition, wholeGit: wholeFile, toolchain: toolFile, history: historyFile, routing: 'Root must independently authenticate the owned Git seal and raw hashes; proposed receipts and self-reported digests grant no execution permission.' });
  console.log(JSON.stringify({ result, counts: { authorManifest: manifest.files.length, source: sourceEntries.length, archive: archive.length, package: packed.length, sourceChanged: sourceChanges.length, packageChanged: packageChanges.length }, sourceMapSha256, packageMapSha256, newAuthoritySha256: authorityFile.sha256, packageChanges, admission: 'DENY_PENDING_FRESH_ROOT_GO' }, null, 2));
}

await main();
