import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../../..');
const prefix = 'tests/commands/yq-independent-20260828/';
const consumers = `${prefix}executor-preparation-v1/consumers/`;
const artifacts = 'tests/commands/yq-author-20260828/evidence-v4/';
const revisions = Object.freeze({
  source: '35da18547ca82a67be9ca22b4adc21e3b8060780',
  evidence: 'ef6032b210feb5cf19e6f6f94c40413740bef335',
  handoff: 'bcec1ead34aee37c8fe574b248a8242ad4f60cfa',
  baseline: '5137a74ec855a32d8a8860eb66b62eb44d11e290',
  length: '74361026502d76b8c2b696f9c60e410ac9b78d95',
  consumers: '409449136ae1adc252ff6e205a6bb5785d113d0f',
  runtime: 'ee9d0c1fd24b33aa918154eb379a92c02cfe5925',
  carry: 'bd471ef682d768692a682d40009a874f51e3ad68',
  review: 'de89e478d8ddce62eac955708f1b87d7be1bd137',
  tests: '1d802e7af02add9e334ab934668d41d6e5ffbbe2',
  driver: '54e6d094ec9ef6e9f58988b82057a0ed67bec64b',
});
const additions = ['src/commands/structured/query-core.ts', 'src/commands/yq/README.md', 'src/commands/yq/accounting.ts', 'src/commands/yq/encoder.ts', 'src/commands/yq/errors.ts', 'src/commands/yq/index.ts', 'src/commands/yq/parser.ts'];
const selectedTests = ['tests/commands/yq-author-20260828/PROTOCOL.md', 'tests/commands/yq-author-20260828/vectors.json', 'tests/commands/yq-author-20260828/tsconfig.json', 'tests/commands/yq-author-20260828/yq.test.ts'];
const parentTests = ['tests/commands/structured-stress/harness.ts', 'tests/commands/structured-stress/join-safety.test.ts'];
const sourceRoots = ['src', 'package.json', 'README.md', 'tsconfig.json', 'tsconfig.build.json'];
const archiveExtraPaths = ['package-lock.json', 'scripts/typecheck.mjs'];
const expectedArtifacts = {
  'SOURCE.tar': { bytes: 2713600, sha256: 'e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc', mode: 420 },
  'package/virtual-bash-0.0.0.tgz': { bytes: 782141, sha256: '2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d', mode: 420 },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? JSON.stringify(value.map(entry => JSON.parse(canonical(entry)))) : value && typeof value === 'object' ? JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))) : JSON.stringify(value);
const identity = bytes => ({ sha256: hash(bytes), bytes: bytes.length, mode: 420 });
const git = (...args) => execFileSync('git', ['-C', repository, ...args], { maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' } });
const readGit = (revision, path) => git('show', `${revision}:${path}`);
const readJson = (revision, path) => JSON.parse(readGit(revision, path));
const equal = (actual, expected, label) => assert.equal(canonical(actual), canonical(expected), label);

function safePath(path) {
  assert(typeof path === 'string' && path.length > 0 && path.length <= 1024, `PATH: ${path}`);
  assert(!path.split('/').includes('AGENTS.md'), `AGENTS_CONTRADICTION: ${path}`);
  assert(path.split('/').every(part => /^[A-Za-z0-9_.-]+$/u.test(part) && !['.', '..', '__proto__', 'constructor', 'prototype', 'node_modules'].includes(part)), `PATH: ${path}`);
  return path;
}

function tree(revision, paths) {
  return git('ls-tree', '-r', '-z', '--full-tree', revision, '--', ...paths).toString().split('\0').filter(Boolean).map(row => {
    const match = /^(100644) blob ([a-f0-9]{40})\t(.+)$/u.exec(row);
    assert(match, `GIT_REGULAR: ${row}`);
    return { path: safePath(match[3]), gitMode: match[1], blob: match[2], revision };
  });
}

function descriptors(entries) {
  return Object.fromEntries(entries.map(entry => [entry.path, identity(entry.data)]));
}

function directories(files) {
  const result = { '': 493 };
  for (const path of Object.keys(files)) {
    let parent = posix.dirname(path);
    while (parent !== '.') { result[parent] = 493; parent = posix.dirname(parent); }
  }
  return result;
}

function parseTar(bytes, profile) {
  assert(bytes.length <= 16 * 1024 * 1024 && bytes.length % 512 === 0, 'TAR_SIZE');
  const entries = [];
  const seen = new Set();
  let offset = 0;
  const text = (header, start, length) => header.subarray(start, start + length).toString('ascii').replace(/\0.*$/us, '');
  const octal = (header, start, length) => {
    const value = text(header, start, length).trim();
    assert(/^[0-7]+$/u.test(value), 'TAR_OCTAL');
    const number = Number.parseInt(value, 8);
    assert(Number.isSafeInteger(number), 'TAR_INTEGER');
    return number;
  };
  while (offset + 512 <= bytes.length && bytes.subarray(offset, offset + 512).some(byte => byte !== 0)) {
    const header = bytes.subarray(offset, offset + 512);
    assert(!header.some(byte => byte > 127), 'TAR_ASCII');
    const name = safePath(text(header, 0, 100));
    assert(!seen.has(name), `TAR_DUPLICATE: ${name}`);
    assert(![...seen].some(prior => prior.startsWith(`${name}/`) || name.startsWith(`${prior}/`)), `TAR_PREFIX: ${name}`);
    seen.add(name);
    assert.equal(text(header, 156, 1), '0', `TAR_REGULAR: ${name}`);
    assert.equal(text(header, 157, 100), '', `TAR_LINK: ${name}`);
    assert.equal(text(header, 345, 155), '', `TAR_PREFIX_FIELD: ${name}`);
    assert.equal(text(header, 257, 6), 'ustar', 'TAR_MAGIC');
    assert.equal(text(header, 263, 2), '00', 'TAR_VERSION');
    assert.equal(octal(header, 100, 8), 420, `TAR_MODE: ${name}`);
    assert.equal(octal(header, 329, 8), 0, 'TAR_DEVICE');
    assert.equal(octal(header, 337, 8), 0, 'TAR_DEVICE');
    let checksum = 0;
    for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(octal(header, 148, 8), checksum, `TAR_CHECKSUM: ${name}`);
    const size = octal(header, 124, 12);
    assert(size <= 16 * 1024 * 1024 && entries.length < 4096, 'TAR_LIMIT');
    const end = offset + 512 + size;
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    assert(next <= bytes.length, 'TAR_TRUNCATED');
    assert(!bytes.subarray(end, next).some(byte => byte !== 0), 'TAR_DATA_PADDING');
    const path = profile === 'package' ? name.replace(/^package\//u, '') : name;
    if (profile === 'package') assert(name.startsWith('package/'), 'TAR_PACKAGE_PREFIX');
    const entry = { path: safePath(path), name, data: Buffer.from(bytes.subarray(offset + 512, end)), offset, headerSha256: hash(header) };
    assert(header.equals(makeHeader(entry, profile)), `TAR_METADATA: ${name}`);
    entries.push(entry);
    offset = next;
  }
  assert.equal(bytes.length - offset, 1024, 'TAR_TERMINATOR_LENGTH');
  assert(!bytes.subarray(offset).some(byte => byte !== 0), 'TAR_TERMINATOR');
  return entries;
}

function makeHeader(entry, profile) {
  const header = Buffer.alloc(512);
  assert(Buffer.byteLength(entry.name) <= 100, 'USTAR_NAME');
  header.write(entry.name, 0, 'ascii');
  const octal = (start, length, value, suffix = ' \0') => header.write(value.toString(8).padStart(length - suffix.length, '0') + suffix, start, length, 'ascii');
  octal(100, 8, 420);
  if (profile === 'source') {
    octal(108, 8, 501); octal(116, 8, 20);
    octal(124, 12, entry.data.length, ' '); octal(136, 12, 946684800, ' ');
    header.write('kjopek', 265, 'ascii'); header.write('staff', 297, 'ascii');
  } else {
    octal(124, 12, entry.data.length); octal(136, 12, 499162500);
  }
  header.fill(32, 148, 156);
  header.write('0', 156, 'ascii'); header.write('ustar\0' + '00', 257, 'ascii');
  octal(329, 8, 0); octal(337, 8, 0);
  octal(148, 8, header.reduce((sum, byte) => sum + byte, 0), profile === 'source' ? '\0 ' : ' \0');
  return header;
}

function serialize(entries, profile) {
  return Buffer.concat([...entries.flatMap(entry => [makeHeader(entry, profile), entry.data, Buffer.alloc((512 - entry.data.length % 512) % 512)]), Buffer.alloc(1024)]);
}

function regularRoot(path) {
  assert.equal(realpathSync(path), path, `CANONICAL_ROOT: ${path}`);
  for (let ancestor = path; ; ancestor = dirname(ancestor)) {
    assert(lstatSync(ancestor).isDirectory() && !lstatSync(ancestor).isSymbolicLink(), `REGULAR_ROOT: ${ancestor}`);
    if (ancestor === dirname(ancestor)) break;
  }
}

function snapshot(root) {
  regularRoot(root);
  const files = {};
  const folderModes = {};
  const runtime = [];
  const walk = path => {
    const directory = join(root, path);
    const metadata = lstatSync(directory);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink(), 'DIRECTORY');
    folderModes[path] = metadata.mode & 4095;
    runtime.push({ path: path || '.', kind: 'directory', mode: metadata.mode & 4095 });
    for (const name of readdirSync(directory).sort()) {
      const child = safePath(path ? `${path}/${name}` : name);
      const filename = join(root, child);
      const stat = lstatSync(filename);
      assert(!stat.isSymbolicLink(), `SYMLINK: ${child}`);
      if (stat.isDirectory()) walk(child);
      else {
        assert(stat.isFile() && stat.nlink === 1, `REGULAR_FILE: ${child}`);
        const bytes = readFileSync(filename);
        const after = lstatSync(filename);
        assert.equal(after.ino, stat.ino); assert.equal(after.dev, stat.dev);
        assert.equal(after.mode, stat.mode); assert.equal(after.mtimeMs, stat.mtimeMs);
        assert.equal(bytes.length, stat.size);
        files[child] = { ...identity(bytes), mode: stat.mode & 4095 };
        runtime.push({ path: child, kind: 'file', mode: stat.mode & 4095, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  };
  walk('');
  return { files, directories: folderModes, runtimeTreeSha256: hash(JSON.stringify(runtime)) };
}

function materialize(root, entries) {
  assert(!existsSync(root), `DESTINATION_EXISTS: ${root}`);
  regularRoot(dirname(root));
  mkdirSync(root, { mode: 493 }); chmodSync(root, 493);
  const expected = { files: descriptors(entries), directories: directories(descriptors(entries)) };
  for (const path of Object.keys(expected.directories).filter(Boolean).sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
    mkdirSync(join(root, path), { mode: 493 }); chmodSync(join(root, path), 493);
  }
  for (const entry of entries) writeFileSync(join(root, entry.path), entry.data, { flag: 'wx', mode: 420 });
  const actual = snapshot(root);
  equal({ files: actual.files, directories: actual.directories }, expected, 'MATERIALIZED_MAP');
  return actual;
}

function physicalCopyMove(parent, name, entries) {
  const original = join(parent, `${name}-original`);
  const staging = join(parent, `${name}-staging`);
  const moved = join(parent, `${name}-moved`);
  const before = materialize(original, entries);
  mkdirSync(staging, { mode: 493 }); chmodSync(staging, 493);
  for (const path of Object.keys(before.directories).filter(Boolean).sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
    mkdirSync(join(staging, path), { mode: 493 }); chmodSync(join(staging, path), 493);
  }
  for (const path of Object.keys(before.files)) { copyFileSync(join(original, path), join(staging, path)); chmodSync(join(staging, path), 420); }
  equal(snapshot(staging), before, 'COPY_MAP');
  const prior = lstatSync(staging);
  renameSync(staging, moved);
  const after = lstatSync(moved);
  assert.equal(prior.ino, after.ino); assert.equal(prior.dev, after.dev); assert(!existsSync(staging));
  equal(snapshot(original), before, 'ORIGINAL_AFTER_MOVE'); equal(snapshot(moved), before, 'MOVED_MAP');
  return { original, moved, staging, directoryIdentity: { ino: after.ino, dev: after.dev }, before, after: snapshot(moved), enrolledImportCapability: false };
}

function patchJson(name, value, compact = false) {
  safePath(name);
  const relative = `${prefix}candidate-35da1854-v1/${name}`;
  assert(!existsSync(join(repository, relative)), `NO_RETRY: ${relative}`);
  const bytes = JSON.stringify(value, null, compact ? undefined : 2) + '\n';
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${relative}\n${bytes.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, cwd: repository, maxBuffer: 1024 * 1024 });
  assert.equal(readFileSync(join(repository, relative), 'utf8'), bytes);
  return { path: join(repository, relative), ...identity(Buffer.from(bytes)) };
}

function snapshotSummary(value) {
  return { files: Object.keys(value.files).length, directories: Object.keys(value.directories).length, fileMapSha256: hash(canonical(value.files)), directoryMapSha256: hash(canonical(value.directories)), runtimeTreeSha256: value.runtimeTreeSha256 };
}

function movementSummary(value) {
  return { ...value, before: snapshotSummary(value.before), after: snapshotSummary(value.after) };
}

function graph(entries, roots) {
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  const imports = [];
  const visited = new Set();
  const builtins = new Set();
  const visit = path => {
    if (visited.has(path)) return;
    const entry = byPath.get(path); assert(entry, `STATIC_IMPORT_MISSING: ${path}`); visited.add(path);
    const text = entry.data.toString('utf8');
    assert(!/\bimport\s*\(/u.test(text), `DYNAMIC_IMPORT_REVIEW_REQUIRED: ${path}`);
    for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gu)) {
      const specifier = match[1];
      imports.push({ parent: path, specifier });
      if (specifier.startsWith('node:')) builtins.add(specifier);
      else {
        assert(specifier.startsWith('./') || specifier.startsWith('../'), `STATIC_PACKAGE_IMPORT: ${specifier}`);
        const target = posix.normalize(posix.join(posix.dirname(path), specifier)); safePath(target);
        assert(target.startsWith('dist/') && target.endsWith('.js'), `STATIC_IMPORT_PATH: ${target}`); visit(target);
      }
    }
  };
  roots.forEach(visit);
  return { method: 'literal-import text scan, not compiler or loaded-code proof', roots, files: [...visited].sort(), allowedBuiltins: [...builtins].sort(), imports };
}

async function main() {
  assert.equal(repository, '/Users/kjopek/Workspace/safe-bash');
  assert(!existsSync(join(own, 'RESULT.json')), 'NO_RETRY');
  const sealRaw = readFileSync(join(own, 'PRESEAL.json'));
  assert.equal(hash(sealRaw), process.argv[2], 'ROOT_ROUTED_PRESEAL_HASH');
  const seal = JSON.parse(sealRaw);
  for (const [name, descriptor] of Object.entries(seal.files)) equal(identity(readFileSync(join(own, name))), descriptor, `PRESEAL: ${name}`);
  assert.equal(hash(readFileSync(process.execPath)), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011', 'NODE_PIN');
  for (const revision of Object.values(revisions)) assert.equal(git('rev-parse', `${revision}^{commit}`).toString().trim(), revision);
  const selected = readJson(revisions.consumers, consumers + 'SELECTED.json');
  for (const input of selected.selected) {
    const bytes = readGit(input.revision, input.path);
    equal(identity(bytes), { sha256: input.sha256, bytes: input.bytes, mode: 420 }, `SELECTED: ${input.path}`);
    assert.equal(git('rev-parse', `${input.revision}:${input.path}`).toString().trim(), input.blob);
  }
  const carry = readJson(revisions.carry, prefix + 'final-carry-v1/MANIFEST.json');
  assert.equal(carry.coverage.recordCount, 194); assert.equal(carry.overlays.length, 8);
  const verifyPath = join(repository, consumers, 'verify-recipe.mjs');
  for (const [name, expected] of [['verify-recipe.mjs', 'a4f2bb661d91505a22fa414b83cbba26dd6d4f63fcd5bc08d648e0368b97bba1'], ['guards.mjs', '47715566b179d65b5bd9501d667634c8957ba7a5e29b43246fa77824f5d4cd91']]) {
    assert.equal(hash(readGit(revisions.consumers, consumers + name)), expected);
    assert.equal(hash(readFileSync(join(repository, consumers, name))), expected);
  }
  const verify = await import(pathToFileURL(verifyPath).href);
  const frameworkCheck = verify.verifyRecipe('24e28a529cec877b82835d81ba3f274702a28d43ab5285754b7bd1ef0b82f98d');
  const guards = await import(pathToFileURL(join(repository, consumers, 'guards.mjs')).href);
  guards.verifySelected();
  const writeSets = Object.fromEntries(['source', 'evidence', 'handoff'].map(name => [name, git('diff-tree', '--no-commit-id', '--name-status', '-r', revisions[name]).toString().trim().split('\n')]));
  assert(writeSets.source.every(row => row === 'M\tsrc/commands/yq/parser.ts'));
  assert(writeSets.evidence.every(row => row.startsWith('A\ttests/commands/yq-author-20260828/evidence-v')));
  equal(writeSets.handoff, ['A\ttests/commands/yq-author-20260828/FIRST-FAILURE.txt', 'A\ttests/commands/yq-author-20260828/HANDOFF.md'], 'HANDOFF_WRITES');
  const manifest = readJson(revisions.evidence, artifacts + 'SOURCE-MANIFEST.json');
  const manifestByPath = new Map(manifest.files.map(entry => [entry.path, entry]));
  assert.equal(manifestByPath.size, manifest.files.length);
  const baselineEntries = tree(revisions.baseline, [...sourceRoots, ...archiveExtraPaths]);
  const interpreterPath = 'src/commands/structured/interpreter.ts';
  const composed = [...baselineEntries.filter(entry => entry.path !== interpreterPath), ...tree(revisions.length, [interpreterPath]), ...tree(revisions.source, additions), ...tree(revisions.tests, selectedTests), ...tree(revisions.baseline, parentTests)];
  assert.equal(new Set(composed.map(entry => entry.path)).size, composed.length);
  equal(composed.map(entry => entry.path).sort(), [...manifestByPath.keys()].sort(), 'MANIFEST_EXACT_COMPOSITION');
  for (const entry of composed) {
    entry.data = git('cat-file', 'blob', entry.blob);
    const expected = manifestByPath.get(entry.path);
    equal({ ...identity(entry.data), blob: entry.blob, gitMode: entry.gitMode }, { sha256: expected.sha256, bytes: expected.bytes, mode: 420, blob: expected.blob, gitMode: expected.mode }, `MANIFEST_GIT: ${entry.path}`);
  }
  const interpreter = composed.find(entry => entry.path === interpreterPath);
  assert.equal(interpreter.blob, 'd3ba11f0057b07d5ad307c5dfbb5f0612a87a047');
  assert.equal(hash(interpreter.data), 'e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74');
  const archiveEntries = composed.filter(entry => !entry.path.startsWith('tests/'));
  const sourceEntries = archiveEntries.filter(entry => !archiveExtraPaths.includes(entry.path));
  const sourceFiles = descriptors(sourceEntries);
  const sourceBase = readJson(revisions.consumers, consumers + 'SOURCE-BASE.json');
  const sourceAdditions = descriptors(sourceEntries.filter(entry => additions.includes(entry.path)));
  equal(sourceFiles, { ...Object.fromEntries(Object.entries(sourceBase).map(([path, value]) => [path, { sha256: value.sha256, bytes: value.bytes, mode: value.mode }])), ...sourceAdditions }, 'SOURCE_BASE_EXACT');
  const rawArchive = readGit(revisions.evidence, artifacts + 'SOURCE.tar');
  const rawPack = readGit(revisions.evidence, artifacts + 'package/virtual-bash-0.0.0.tgz');
  equal(identity(rawArchive), expectedArtifacts['SOURCE.tar'], 'ARCHIVE_RAW');
  equal(identity(rawPack), expectedArtifacts['package/virtual-bash-0.0.0.tgz'], 'PACK_RAW');
  const sourceTar = parseTar(rawArchive, 'source');
  const packageTarBytes = gunzipSync(rawPack, { maxOutputLength: 16 * 1024 * 1024 });
  const packageEntries = parseTar(packageTarBytes, 'package');
  equal(descriptors(sourceTar), descriptors(archiveEntries), 'SOURCE_ARCHIVE_MAP');
  const baselinePackage = readJson(revisions.consumers, consumers + 'BASELINE-PACKAGE.json');
  const packageFiles = descriptors(packageEntries);
  const outputPaths = additions.filter(path => path.endsWith('.ts')).flatMap(path => ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => path.replace(/^src\//u, 'dist/').replace(/\.ts$/u, extension))).sort();
  const packageAdditions = Object.fromEntries(outputPaths.map(path => { assert(!Object.hasOwn(baselinePackage, path)); assert(packageFiles[path]); return [path, packageFiles[path]]; }));
  equal(packageFiles, { ...baselinePackage, ...packageAdditions }, 'ALL_BASELINE_AND_ADDITIONS');
  equal(packageFiles['README.md'], identity(readGit(revisions.baseline, 'README.md')), 'EXACT_BASELINE_README');
  assert.equal(Object.keys(baselinePackage).length, 846); assert.equal(packageEntries.length, 870); assert.equal(outputPaths.length, 24);
  const bySourcePath = new Map(archiveEntries.map(entry => [entry.path, entry]));
  const reproducedSource = serialize(sourceTar.map(entry => ({ ...entry, data: bySourcePath.get(entry.path).data })), 'source');
  const reproducedPackageTar = serialize(packageEntries, 'package');
  const reproducedPack = gzipSync(reproducedPackageTar, { level: 9, strategy: 0, memLevel: 8, windowBits: 15 });
  reproducedPack[9] = 255;
  const reconstruction = {
    source: { ...identity(reproducedSource), byteExact: reproducedSource.equals(rawArchive), role: 'INDEPENDENT_GIT_BLOB_DATA_SERIALIZATION' },
    packageTar: { ...identity(reproducedPackageTar), byteExact: reproducedPackageTar.equals(packageTarBytes), role: 'INDEPENDENT_SERIALIZATION_OF_BOUND_AUTHOR_OUTPUTS' },
    packageGzip: { ...identity(reproducedPack), byteExact: reproducedPack.equals(rawPack), attempts: 1, zlib: process.versions.zlib, role: 'NOT_INDEPENDENT_SOURCE_TO_JAVASCRIPT' },
  };
  const imports = graph(packageEntries, ['dist/commands/yq/index.js', 'dist/contracts/index.js']);
  const runtimeAllowed = ['node:path', 'node:util', 'node:buffer', 'node:stream', 'node:stream/web'];
  const builtinGaps = imports.allowedBuiltins.filter(name => !runtimeAllowed.includes(name));
  const actualCommit = tree(revisions.source, sourceRoots);
  const actualFiles = Object.fromEntries(actualCommit.map(entry => [entry.path, identity(git('cat-file', 'blob', entry.blob))]));
  const candidateDelta = {
    extra: Object.keys(actualFiles).filter(path => !Object.hasOwn(sourceFiles, path)).sort(),
    missing: Object.keys(sourceFiles).filter(path => !Object.hasOwn(actualFiles, path)).sort(),
    changed: Object.keys(sourceFiles).filter(path => Object.hasOwn(actualFiles, path) && canonical(actualFiles[path]) !== canonical(sourceFiles[path])).sort(),
  };
  const synthetic = [];
  for (const path of ['../escape', '/absolute', 'a//b', 'a/./b', 'a\\b', 'AGENTS.md', 'a/AGENTS.md', '__proto__/file', 'node_modules/a']) {
    assert.throws(() => safePath(path)); synthetic.push({ id: `path:${path}`, result: 'EXPECTED_REJECTION' });
  }
  const fake = { name: 'fixture', path: 'fixture', data: Buffer.from('data') };
  const validTar = serialize([fake], 'source');
  assert.equal(parseTar(validTar, 'source').length, 1); synthetic.push({ id: 'regular-tar', result: 'EXPECTED_ACCEPTANCE' });
  for (const [name, transform] of [
    ['checksum', bytes => { bytes[0] ^= 1; return bytes; }],
    ['symlink', bytes => { bytes[156] = 50; return bytes; }],
    ['unexpected-type', bytes => { bytes[156] = 53; return bytes; }],
    ['truncated', bytes => bytes.subarray(0, bytes.length - 512)],
    ['nonzero-padding', bytes => { bytes[bytes.length - 1] = 1; return bytes; }],
    ['duplicate', () => serialize([fake, fake], 'source')],
  ]) { assert.throws(() => parseTar(transform(Buffer.from(validTar)), 'source')); synthetic.push({ id: name, result: 'EXPECTED_REJECTION' }); }
  const parent = realpathSync('/tmp'); regularRoot(parent);
  const temporary = mkdtempSync(join(parent, 'yq-candidate-admission-35da1854-'));
  chmodSync(temporary, 493);
  assert(!temporary.startsWith(repository + '/'));
  const dataRoot = join(temporary, 'artifacts'); mkdirSync(dataRoot, { mode: 493 }); chmodSync(dataRoot, 493);
  const dataArtifacts = [['SOURCE.tar', rawArchive], ['virtual-bash-0.0.0.tgz', rawPack], ['SOURCE.independent.tar', reproducedSource], ['package.independent.tar', reproducedPackageTar], ['virtual-bash.serialization.tgz', reproducedPack]];
  for (const [name, bytes] of dataArtifacts) writeFileSync(join(dataRoot, name), bytes, { flag: 'wx', mode: 420 });
  const artifactBefore = snapshot(dataRoot);
  const archiveRoot = join(temporary, 'source-archive-273');
  const archiveBefore = materialize(archiveRoot, sourceTar);
  const sourceMove = physicalCopyMove(temporary, 'source-271', sourceEntries);
  const packageMove = physicalCopyMove(temporary, 'package-870', packageEntries);
  const packageTree = { files: packageFiles, directories: directories(packageFiles) };
  const build = patchJson('BOUND-AUTHOR-BUILD.json', {
    candidateCommit: revisions.source, sourceMapSha256: hash(canonical(sourceFiles)), packageMapSha256: hash(canonical(packageTree)),
    classification: 'BOUND_AUTHOR_BUILD', independentlyCompiled: false, rootTrustedBuildReceipt: false,
    evidenceCommit: revisions.evidence, sourceArchive: expectedArtifacts['SOURCE.tar'], packageArtifact: expectedArtifacts['package/virtual-bash-0.0.0.tgz'],
    report: { path: artifacts + 'REPORT.json', ...identity(readGit(revisions.evidence, artifacts + 'REPORT.json')) },
    scope: 'Author source/output attestation plus independent entry binding; not independent build proof or root acceptance',
  });
  const sourceReceipt = { schema: 1, sourceBase: revisions.baseline, acceptedLength: revisions.length, candidateCommit: revisions.source, sourceAdditions };
  const fullReceipt = { ...sourceReceipt, packageAdditions, packageDirectories: packageTree.directories, entries: { yq: 'dist/commands/yq/index.js', contracts: 'dist/contracts/index.js' }, allowedBuiltins: imports.allowedBuiltins, buildReceipt: { path: build.path, sha256: build.sha256 } };
  guards.validateReceiptShape(sourceReceipt, true); guards.validateReceiptShape(fullReceipt);
  equal(guards.expectedPackage(fullReceipt, baselinePackage, selected.readme), packageTree, 'ACTUAL_GUARD_PACKAGE_MAP');
  const sourceReceiptFile = patchJson('SOURCE-RECEIPT.json', sourceReceipt);
  const fullReceiptFile = patchJson('FULL-RECEIPT.json', fullReceipt);
  const attempts = [];
  for (const receipt of [sourceReceiptFile, fullReceiptFile]) {
    let error;
    try { guards.authorizeSources(receipt.path, receipt.sha256); } catch (caught) { error = caught; }
    assert(error, 'Unexpected admission requires root review, never execute');
    assert.equal(error.code, 'SOURCE_BINDING');
    attempts.push({ path: receipt.path, sha256: receipt.sha256, result: 'REJECTED', code: error.code, message: error.message });
  }
  const packageMetadata = JSON.parse(packageEntries.find(entry => entry.path === 'package.json').data);
  assert.equal(Object.keys(packageMetadata.dependencies ?? {}).length, 0);
  const runtimeBindings = patchJson('RUNTIME-BINDINGS.PENDING.json', {
    status: 'NOT_EXECUTION_AUTHORIZATION', rootAcceptedComposition: false, candidateCommit: revisions.source, baselineCommit: revisions.baseline, acceptedLengthCommit: revisions.length,
    source: { root: sourceMove.moved, fileCount: sourceEntries.length, sourceTreeSha256: sourceMove.after.runtimeTreeSha256, sourceMapSha256: hash(canonical(sourceFiles)) },
    sourceArchive: { root: archiveRoot, fileCount: sourceTar.length, treeSha256: archiveBefore.runtimeTreeSha256, extraPaths: archiveExtraPaths },
    compiled: { root: packageMove.moved, compiledTreeSha256: packageMove.after.runtimeTreeSha256, entry: { path: 'dist/commands/yq/index.js', sha256: packageFiles['dist/commands/yq/index.js'].sha256, exportName: 'createYqCommand', proofRole: 'direct-compiled-factory-handler-not-public-package' } },
    consumers: { fullReceipt: fullReceiptFile, sourceReceipt: sourceReceiptFile, entries: Object.fromEntries(['dist/commands/yq/index.js', 'dist/commands/yq/index.d.ts', 'dist/contracts/index.js', 'dist/contracts/index.d.ts'].map(path => [path, packageFiles[path]])), proofRole: 'DIRECT_MATERIALIZED_MODULE_NOT_PUBLIC_PACKAGE', admitted: false },
    buildReceiptSha256: build.sha256, newPaths: additions, builtinGaps, rootExportsUnchanged: true, publicIntegration: 'ABSENT_EXPECTED', tools: selected.tools,
  });
  const manifestFile = patchJson('MAPS.json', {
    schema: 1, revisions, classification: 'INDEPENDENT_STATIC_COMPOSITION_AND_BOUND_AUTHOR_OUTPUTS',
    sourceMapSha256: hash(canonical(sourceFiles)), packageMapSha256: hash(canonical(packageTree)),
    source: { files: sourceFiles, directories: directories(sourceFiles) },
    archive: { files: descriptors(sourceTar), directories: directories(descriptors(sourceTar)), entries: sourceTar.map(({ path, name, offset, headerSha256 }) => ({ path, name, offset, headerSha256 })) },
    fullPackage: { ...packageTree, entries: packageEntries.map(({ path, name, offset, headerSha256 }) => ({ path, name, offset, headerSha256 })) },
    gitSelections: composed.map(({ path, gitMode, blob, revision, data }) => ({ path, gitMode, blob, revision, ...identity(data), proofRole: path.startsWith('tests/') ? 'SELECTED_DATA_NOT_EXECUTED' : 'SOURCE_DATA' })),
    readme: selected.readme, baselinePackageCount: 846, additions: outputPaths, importGraph: imports,
  }, true);
  const movementsFile = patchJson('MATERIALIZATION.json', {
    temporary, artifacts: { root: dataRoot, before: artifactBefore, after: snapshot(dataRoot) },
    archive: { root: archiveRoot, before: snapshotSummary(archiveBefore), after: snapshotSummary(snapshot(archiveRoot)) }, source: movementSummary(sourceMove), package: movementSummary(packageMove),
    observation: 'Full membership, bytes and modes including added entries checked; not append-proof transactions or change-and-restore detection; copies are data only, no enrolled imports',
  });
  equal(snapshot(dataRoot), artifactBefore, 'ARTIFACT_AFTER'); equal(snapshot(archiveRoot), archiveBefore, 'ARCHIVE_AFTER');
  equal(snapshot(sourceMove.original), sourceMove.before, 'SOURCE_ORIGINAL_FINAL'); equal(snapshot(sourceMove.moved), sourceMove.before, 'SOURCE_MOVED_FINAL');
  equal(snapshot(packageMove.original), packageMove.before, 'PACKAGE_ORIGINAL_FINAL'); equal(snapshot(packageMove.moved), packageMove.before, 'PACKAGE_MOVED_FINAL');
  verify.verifyRecipe('24e28a529cec877b82835d81ba3f274702a28d43ab5285754b7bd1ef0b82f98d');
  equal(identity(readGit(revisions.evidence, artifacts + 'SOURCE.tar')), expectedArtifacts['SOURCE.tar'], 'GIT_ARCHIVE_AFTER');
  equal(identity(readGit(revisions.evidence, artifacts + 'package/virtual-bash-0.0.0.tgz')), expectedArtifacts['package/virtual-bash-0.0.0.tgz'], 'GIT_PACKAGE_AFTER');
  const result = patchJson('RESULT.json', {
    date: '2026-08-28', status: 'DATA_BOUND_ADMISSION_BLOCKED_AWAIT_ROOT', revisions, ownPresealSha256: process.argv[2], frameworkCheck, writeSets,
    handoff: { path: 'tests/commands/yq-author-20260828/HANDOFF.md', revision: revisions.handoff, ...identity(readGit(revisions.handoff, 'tests/commands/yq-author-20260828/HANDOFF.md')), absentAt: [revisions.source, revisions.evidence] },
    counts: { authorSelections: composed.length, archivedSource: sourceTar.length, guardSourceBase: Object.keys(sourceBase).length, sourceAdditions: additions.length, guardedSource: sourceEntries.length, fullBaselinePackage: 846, emittedAdditions: outputPaths.length, fullPackage: packageEntries.length, originalFrozenRecords: carry.coverage.recordCount, overlays: carry.overlays.length },
    exactArtifacts: expectedArtifacts, reconstruction, receipts: { source: sourceReceiptFile, full: fullReceiptFile, authorBuild: build, runtimeBindings, maps: manifestFile, movements: movementsFile },
    sourceAdmission: { classification: 'SHAPE_VALID_MAP_BOUND_BUT_NOT_ADMITTED', attempts, actualWholeCommitFileCount: actualCommit.length, selectedFileCount: sourceEntries.length, candidateDelta },
    runtimeAdmission: { accepted: false, requiredBuiltins: imports.allowedBuiltins, frozenBuiltinAllowlist: runtimeAllowed, missingBuiltins: builtinGaps },
    blockers: ['Consumer source guard requires the entire candidate commit tree, not the authorized selected composition; no synthetic commit or guard change authorized', 'Frozen runtime fence omits required node:timers/promises', 'Root acceptance and independent source-to-output compilation remain pending'],
    synthetic, syntheticCount: synthetic.length, temporary,
    execution: { productImports: 0, productRuns: 0, build: 0, compile: 0, npm: 0, nativeYaml: 0, authorCodeExecution: 0, privatePackageImports: 0, syntheticDataChecks: synthetic.length, frameworkReadOnlySourceAdmissionAttempts: attempts.length },
    authorEvidenceNotOurPasses: { runtime: '26 authored tests', parentJq: '19 selected tests', controls: '15 author build/archive/package/consumer controls', globalTypes: 'blocked before build by unclassified foreign .mts', firstFailure: { revision: revisions.handoff, path: 'tests/commands/yq-author-20260828/FIRST-FAILURE.txt', ...identity(readGit(revisions.handoff, 'tests/commands/yq-author-20260828/FIRST-FAILURE.txt')) } },
    remaining: ['Root-routed guard/composition and runtime builtin resolution', 'Independently pinned scoped TypeScript build and full output equality', 'Root-trusted full build admission and enrolled materialization', 'Loaded-code controls, declarations, CARRY/source instrumentation, actual bounded different-agent YAML review', 'Public root/package integration intentionally absent'],
  });
  const expectedHashes = patchJson('EXPECTED-HASHES.json', { schema: 1, routing: 'Root must authenticate this file and final seal from this worker commit and independently supply receipt hashes; embedded self-hashes alone authorize nothing', result, sourceReceipt: sourceReceiptFile, fullReceipt: fullReceiptFile, authorBuild: build, runtimeBindings, maps: manifestFile, movements: movementsFile });
  console.log(JSON.stringify({ result, expectedHashes, reconstruction, counts: { source: sourceEntries.length, archive: sourceTar.length, package: packageEntries.length }, temporary, candidateDelta, builtinGaps, syntheticCount: synthetic.length }, null, 2));
}

await main();
