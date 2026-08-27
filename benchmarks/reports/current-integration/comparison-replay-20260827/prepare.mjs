import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.cwd();
const output = dirname(fileURLToPath(import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repo });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const freeze = await realpath(await mkdtemp('/tmp/safe-bash-comparison-replay-20260827-'));
await write('location.json', { freeze, output, repo, startedAt: new Date().toISOString() });
const source = join(freeze, 'product');
await mkdir(source);
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...selected).toString().split('\0').filter(Boolean))].sort();
const tracked = new Set(git('ls-files', '-z', '--', ...selected).toString().split('\0'));
const state = { head: git('rev-parse', 'HEAD').toString().trim(), status: git('status', '--porcelain=v1').toString(), index: git('diff', '--cached', '--name-status').toString(), selected, paths: {}, missing: [] };
await writeFile(join(output, 'dirty-product.patch'), git('diff', '--binary', '--', ...selected), { flag: 'wx' });
for (const path of paths) {
  const from = join(repo, path), to = join(source, path);
  let info;
  try { info = await lstat(from); } catch (error) { if (error.code === 'ENOENT') { state.missing.push(path); continue; } throw error; }
  assert.ok(info.isFile(), `Source must be regular: ${path}`);
  const bytes = await readFile(from);
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, bytes, { flag: 'wx', mode: info.mode & 0o777 });
  state.paths[path] = { sha256: digest(bytes), bytes: bytes.length, tracked: tracked.has(path), mode: info.mode & 0o777 };
}
assert.deepEqual(paths, [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...selected).toString().split('\0').filter(Boolean))].sort(), 'Source path set changed while copying');
for (const [path, entry] of Object.entries(state.paths)) assert.equal(digest(await readFile(join(repo, path))), entry.sha256, `Live source changed while freezing: ${path}`);
state.liveStableThrough = new Date().toISOString();
state.sourceTreeSha256 = digest(JSON.stringify(state.paths));
await write('source-manifest.json', state);

async function tree(directory, prefix = '', result = {}) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const info = await stat(path);
    if (info.isDirectory()) await tree(path, relative, result);
    else { assert.ok(info.isFile(), path); result[relative] = { sha256: digest(await readFile(path)), mode: info.mode & 0o777, originalSymlink: entry.isSymbolicLink() ? await realpath(path) : null }; }
  }
  return result;
}
const dependencies = {};
for (const relative of ['node_modules', 'benchmarks/node_modules']) {
  const origin = join(repo, relative), destination = join(source, relative);
  const before = await tree(origin);
  for (const [path, entry] of Object.entries(before)) {
    if (entry.originalSymlink) assert.ok(entry.originalSymlink.startsWith(origin + '/'), `External dependency symlink: ${path}`);
    const to = join(destination, path);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(origin, path), to);
    await chmod(to, entry.mode);
  }
  const after = await tree(origin), copied = await tree(destination);
  assert.deepEqual(after, before, 'Dependency source changed during copy');
  for (const [path, entry] of Object.entries(before)) { assert.equal(copied[path].sha256, entry.sha256); assert.equal(copied[path].originalSymlink, null); }
  const lockPath = relative === 'node_modules' ? 'package-lock.json' : 'benchmarks/package-lock.json';
  const packagePath = relative === 'node_modules' ? 'package.json' : 'benchmarks/package.json';
  if (relative !== 'node_modules') for (const path of [lockPath, packagePath]) await copyFile(join(repo, path), join(source, path));
  const lock = JSON.parse(await readFile(join(source, lockPath)));
  const hidden = JSON.parse(await readFile(join(destination, '.package-lock.json')));
  const verified = [];
  for (const [path, metadata] of Object.entries(hidden.packages)) {
    if (!path.startsWith('node_modules/')) continue;
    const installed = JSON.parse(await readFile(join(destination, path.slice('node_modules/'.length), 'package.json')));
    assert.equal(installed.version, metadata.version, path);
    assert.equal(lock.packages[path]?.version, metadata.version, path);
    assert.equal(lock.packages[path]?.integrity, metadata.integrity, path);
    verified.push({ path, version: installed.version, integrity: metadata.integrity });
  }
  dependencies[relative] = { origin, destination, paths: before, copiedTreeSha256: digest(JSON.stringify(copied)), lockSha256: digest(await readFile(join(source, lockPath))), verified,
    provenance: 'Existing installed trees copied once, all bytes compared before/copy/after; installed manifest versions and hidden-lock integrity strings agree with committed locks. Registry tarball integrity NOT re-downloaded or independently revalidated.' };
}
assert.deepEqual(JSON.parse(await readFile(join(source, 'package.json'))).dependencies ?? {}, {});
assert.equal(JSON.parse(await readFile(join(source, 'benchmarks/node_modules/just-bash/package.json'))).version, '3.4.2');
await write('dependency-manifest.json', dependencies);

const profiles = {};
for (const [name, revision, golden] of [
  ['original', '0294afb', 'native-corrected'], ['scratch-aligned', 'd1b10a3', 'native-scratch-aligned'],
]) {
  const root = join(source, 'profiles', name), harness = join(root, 'benchmarks/expanded');
  await mkdir(harness, { recursive: true });
  const hashes = {};
  for (const path of git('ls-tree', '-r', '--name-only', revision, '--', 'benchmarks/expanded').toString().trim().split('\n')) {
    const bytes = git('show', `${revision}:${path}`), destination = join(root, path);
    await writeFile(destination, bytes, { flag: 'wx' });
    hashes[path] = digest(bytes);
  }
  for (const [goldName, goldRevision] of [['native-first', '8e09db9'], ['native-corrected', '8e09db9'], ...(name === 'scratch-aligned' ? [['native-scratch-aligned', 'd1b10a3']] : [])]) {
    const path = `benchmarks/reports/expanded-20260827/${goldName}/native.json`, bytes = git('show', `${goldRevision}:${path}`);
    assert.equal(digest(await readFile(join(repo, path))), digest(bytes), `Historical golden changed: ${path}`);
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes, { flag: 'wx' });
    hashes[path] = digest(bytes);
  }
  const goldPath = join(root, `benchmarks/reports/expanded-20260827/${golden}/native.json`);
  const gold = JSON.parse(await readFile(goldPath));
  assert.equal(gold.invalidCount, 0);
  assert.equal(gold.observations.length, 228);
  for (const [path, expected] of Object.entries(gold.sourceHashes)) assert.equal(hashes[`benchmarks/expanded/${path}`], expected, `${name}/${path}`);
  profiles[name] = { root, harness, revision: git('rev-parse', revision).toString().trim(), goldPath, hashes, oracle: { primaryProfile: gold.primaryProfile, toolIdentities: gold.toolIdentities, sourceHashes: gold.sourceHashes, projections: gold.projections } };
}
await write('profiles.json', profiles);
await writeFile(join(output, 'scratch-profile-commit.patch'), git('diff', 'd1b10a3^', 'd1b10a3', '--', 'benchmarks/expanded'), { flag: 'wx' });
await mkdir(join(source, 'audit'));
for (const name of ['phase.mjs', 'preload.mjs', 'loader.mjs']) await copyFile(join(output, name), join(source, 'audit', name));
await writeFile(join(source, 'audit/config.json'), JSON.stringify({ freeze, source, output, profiles }, null, 2) + '\n', { flag: 'wx' });
const all = await tree(source);
assert.ok(Object.values(all).every(entry => entry.originalSymlink === null));
await write('frozen-files.json', all);
for (const [path, entry] of Object.entries(all)) await chmod(join(source, path), entry.mode & ~0o222);
await mkdir(join(freeze, 'home')); await mkdir(join(freeze, 'tmp'));
console.log(JSON.stringify({ freeze, sourceFiles: Object.keys(state.paths).length, untrackedSource: Object.entries(state.paths).filter(([, entry]) => !entry.tracked).map(([path]) => path), sourceTreeSha256: state.sourceTreeSha256, dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, entry]) => [name, entry.copiedTreeSha256])), profiles: Object.keys(profiles) }, null, 2));
