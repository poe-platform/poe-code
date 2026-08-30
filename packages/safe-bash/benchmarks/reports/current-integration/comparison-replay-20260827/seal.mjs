import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const { freeze, repo } = JSON.parse(await readFile(join(output, 'location.json')));
const source = join(freeze, 'product');
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const state = JSON.parse(await readFile(join(output, 'source-manifest.json')));
const dependencies = JSON.parse(await readFile(join(output, 'dependency-manifest.json')));
for (const [path, entry] of Object.entries(state.paths)) assert.equal(digest(await readFile(join(source, path))), entry.sha256, path);
for (const [root, dependency] of Object.entries(dependencies)) for (const [path, entry] of Object.entries(dependency.paths)) assert.equal(digest(await readFile(join(source, root, path))), entry.sha256, path);
async function preserve(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(digest(await readFile(path)), digest(bytes), `Partial snapshot mismatch: ${path}`); }
}
const profiles = {};
for (const [name, revision, golden] of [['original', '0294afb', 'native-corrected'], ['scratch-aligned', 'd1b10a3', 'native-scratch-aligned']]) {
  const root = join(source, 'profiles', name), harness = join(root, 'benchmarks/expanded'), hashes = {};
  for (const path of git('ls-tree', '-r', '--name-only', revision, '--', 'benchmarks/expanded').toString().trim().split('\n')) {
    const bytes = git('show', `${revision}:${path}`);
    await preserve(join(root, path), bytes); hashes[path] = digest(bytes);
  }
  for (const [goldName, goldRevision] of [['native-first', '8e09db9'], ['native-corrected', '8e09db9'], ...(name === 'scratch-aligned' ? [['native-scratch-aligned', 'd1b10a3']] : [])]) {
    const path = `benchmarks/reports/expanded-20260827/${goldName}/native.json`, bytes = git('show', `${goldRevision}:${path}`);
    assert.equal(digest(await readFile(join(repo, path))), digest(bytes), `Historical golden changed: ${path}`);
    await preserve(join(root, path), bytes); hashes[path] = digest(bytes);
  }
  const goldPath = join(root, `benchmarks/reports/expanded-20260827/${golden}/native.json`), gold = JSON.parse(await readFile(goldPath));
  assert.equal(gold.invalidCount, 0); assert.equal(gold.observations.length, 228);
  for (const [path, expected] of Object.entries(gold.sourceHashes)) assert.equal(hashes[`benchmarks/expanded/${path}`], expected, `${name}/${path}`);
  profiles[name] = { root, harness, revision: git('rev-parse', revision).toString().trim(), goldPath, hashes, oracle: { primaryProfile: gold.primaryProfile, toolIdentities: gold.toolIdentities, sourceHashes: gold.sourceHashes, projections: gold.projections } };
}
await write('profiles.json', profiles);
await writeFile(join(output, 'scratch-profile-commit.patch'), git('diff', 'd1b10a3^', 'd1b10a3', '--', 'benchmarks/expanded'), { flag: 'wx' });
await mkdir(join(source, 'audit'));
for (const name of ['phase.mjs', 'preload.mjs', 'loader.mjs']) await copyFile(join(output, name), join(source, 'audit', name));
await writeFile(join(source, 'audit/config.json'), JSON.stringify({ freeze, source, output, profiles }, null, 2) + '\n', { flag: 'wx' });
const files = {};
async function tree(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await tree(path, relative);
    else { const info = await lstat(path); assert.ok(info.isFile(), `Non-regular frozen file: ${path}`); files[relative] = { sha256: digest(await readFile(path)), mode: info.mode & 0o777, originalSymlink: null }; }
  }
}
await tree(source);
await write('frozen-files.json', files);
for (const [path, entry] of Object.entries(files)) await chmod(join(source, path), entry.mode & ~0o222);
await mkdir(join(freeze, 'home')); await mkdir(join(freeze, 'tmp'));
await write('seal.json', { sealedAt: new Date().toISOString(), sourceTreeSha256: state.sourceTreeSha256, frozenFilesSha256: digest(JSON.stringify(files)), files: Object.keys(files).length, sourceFiles: Object.keys(state.paths).length,
  sourceNotRecopied: true, dependenciesNotRecopied: true, productEntry: join(source, 'src/index.ts'), baselineEntry: join(source, 'benchmarks/node_modules/just-bash/dist/bundle/index.js'), allFrozenFilesRegular: true });
console.log(JSON.stringify({ freeze, files: Object.keys(files).length, sourceFiles: Object.keys(state.paths).length, sourceTreeSha256: state.sourceTreeSha256, profiles: Object.keys(profiles) }, null, 2));
