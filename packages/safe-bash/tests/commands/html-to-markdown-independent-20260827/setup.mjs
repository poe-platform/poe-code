import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(own, '../../..');
const capture = join(own, process.argv[2] ?? 'capture-01');
assert(!existsSync(capture), 'unique capture directory required');
mkdirSync(capture);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'html-independent-20260827-')));
const build = join(scratch, 'build');
const installation = join(scratch, 'installation');
const consumer = join(scratch, 'consumer');
const tools = join(scratch, 'tools');
for (const directory of [build, installation, consumer, tools]) mkdirSync(directory);
const candidate = '2272feb92f8c0f151385f59f79eee004c50d14b8';
const supplemental = '21ca7b8c9c4afde7286aac479e070b29bbf5d5ed';
const evidence = '650c96fd6957945b32d6a4bc71f016a8e611cade';
const freeze = 'e761af2ed973e07b9b8cf09aae68ccbfbd475ca1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = {};
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const save = (name, value) => writeFileSync(join(capture, name), JSON.stringify(value, null, 2) + '\n');
const state = { started: new Date().toISOString(), candidate, supplemental, evidence, freeze, scratch, build, installation, consumer, tools, capture, inputs, invocations: [] };
save('state.json', state);
function materialize(relative, revision = candidate) {
  const bytes = git('show', `${revision}:${relative}`);
  inputs[`${revision}:${relative}`] = { sha256: hash(bytes), blob: git('rev-parse', `${revision}:${relative}`).toString().trim(), bytes: bytes.length };
  const target = join(build, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return bytes.toString();
}
function command(id, executable, args, cwd, timeout = 30000) {
  const start = performance.now();
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, npm_config_cache: join(scratch, 'npm-cache'), npm_config_update_notifier: 'false', npm_config_audit: 'false' } });
  writeFileSync(join(capture, `${id}.stdout`), result.stdout ?? '');
  writeFileSync(join(capture, `${id}.stderr`), result.stderr ?? '');
  const receipt = { id, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, elapsedMs: performance.now() - start };
  state.invocations.push(receipt); save('state.json', state);
  assert.equal(result.status, 0, JSON.stringify(receipt));
  return result.stdout;
}
function inventory(directory) {
  const entries = {};
  function visit(current, prefix = '') {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(join(current, entry.name), relative + '/');
      else { assert(entry.isFile(), `nonregular ${relative}`); entries[relative] = hash(readFileSync(join(current, entry.name))); }
    }
  }
  visit(directory); return entries;
}
try {
  state.initialStatus = git('status', '--porcelain=v1').toString();
  state.initialIndex = git('diff', '--cached', '--name-status').toString();
  state.revisions = [candidate, supplemental, evidence, freeze].map(revision => git('show', '-s', '--format=%H %aI %cI', revision).toString().trim());
  state.moduleUnchanged = git('diff', candidate, supplemental, '--', 'src/commands/html-to-markdown').toString() === '' && git('diff', candidate, evidence, '--', 'src/commands/html-to-markdown').toString() === '';
  assert(state.moduleUnchanged);
  const paths = new Set();
  function source(relative) {
    if (paths.has(relative)) return;
    paths.add(relative);
    const text = materialize(relative);
    for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/gu)) {
      const dependency = posix.normalize(posix.join(posix.dirname(relative), match[1])).replace(/\.js$/u, '.ts');
      if (dependency.endsWith('.ts')) source(dependency);
    }
  }
  for (const entry of ['src/commands/html-to-markdown/index.ts', 'src/fs/memory/index.ts', 'src/shell/index.ts']) source(entry);
  for (const entry of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'src/commands/html-to-markdown/README.md']) materialize(entry);
  materialize('tests/commands/html-to-markdown/tsconfig.build.json', supplemental);
  for (const revision of [candidate, supplemental, evidence]) {
    for (const entry of git('ls-tree', '-r', '--name-only', revision, 'src/commands/html-to-markdown', 'tests/commands/html-to-markdown').toString().trim().split('\n')) {
      const bytes = git('show', `${revision}:${entry}`);
      inputs[`${revision}:${entry}`] ??= { sha256: hash(bytes), blob: git('rev-parse', `${revision}:${entry}`).toString().trim(), bytes: bytes.length, evidenceOnly: true };
    }
  }
  const lock = JSON.parse(readFileSync(join(build, 'package-lock.json')));
  state.toolchain = { node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, packages: {} };
  for (const name of ['typescript', '@types/node', 'undici-types']) {
    const from = realpathSync(join(repo, 'node_modules', name));
    const target = join(tools, 'node_modules', name);
    mkdirSync(dirname(target), { recursive: true }); cpSync(from, target, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(target, 'package.json')));
    assert.equal(manifest.version, lock.packages['node_modules/' + name].version, name);
    state.toolchain.packages[name] = { version: manifest.version, lock: lock.packages['node_modules/' + name], files: inventory(target), origin: from, role: 'copied development tool, not product fallback' };
  }
  state.buildOverride = { extends: './tsconfig.build.json', compilerOptions: { typeRoots: [join(tools, 'node_modules/@types')], types: ['node'] }, files: [...paths].sort(), include: [], exclude: [] };
  writeFileSync(join(build, 'independent-build.json'), JSON.stringify(state.buildOverride, null, 2));
  state.sourceBefore = inventory(build);
  command('build', process.execPath, [join(tools, 'node_modules/typescript/bin/tsc'), '-p', 'independent-build.json'], build);
  state.emittedBefore = inventory(join(build, 'dist'));
  const pack = JSON.parse(command('pack', 'npm', ['pack', '--ignore-scripts', '--offline', '--json'], build));
  state.pack = pack;
  const tarball = join(build, pack[0].filename);
  state.tarballSha256 = hash(readFileSync(tarball));
  cpSync(tarball, join(capture, pack[0].filename));
  command('install', 'npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false', tarball], installation);
  mkdirSync(join(consumer, 'node_modules'));
  const installed = join(consumer, 'node_modules/virtual-bash');
  renameSync(join(installation, 'node_modules/virtual-bash'), installed);
  state.installed = installed;
  state.installedBefore = inventory(installed);
  assert.deepEqual(inventory(join(installed, 'dist')), state.emittedBefore);
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json')));
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  state.packageManifest = manifest;
  state.scope = 'Actual packed/installed emitted dependency closure; module-local leaf only. Root and unrelated declared exports are not built or accepted.';
  state.retiredBuild = join(scratch, 'retired-build'); state.retiredInstall = join(scratch, 'retired-installation');
  renameSync(build, state.retiredBuild); renameSync(installation, state.retiredInstall);
  mkdirSync(join(build, 'src/commands/html-to-markdown'), { recursive: true });
  writeFileSync(join(build, 'src/commands/html-to-markdown/index.ts'), 'throw new Error("POISONED_RETIRED_SOURCE_MUST_NOT_LOAD");\n');
  writeFileSync(join(build, 'package.json'), '{"type":"module"}\n');
  state.poisonedSource = join(build, 'src/commands/html-to-markdown/index.ts');
  const metadata = JSON.parse(git('show', `${evidence}:tests/commands/html-to-markdown/evidence/CAPTURES.json`));
  const compressed = Buffer.from(git('show', `${evidence}:tests/commands/html-to-markdown/evidence/CAPTURES.json.gz.base64`).toString(), 'base64');
  assert.equal(hash(compressed), metadata.archiveSha256);
  const archive = JSON.parse(gunzipSync(compressed));
  assert.deepEqual(Object.keys(archive).sort(), metadata.files.map(entry => entry.path).sort());
  for (const entry of metadata.files) {
    const bytes = Buffer.from(archive[entry.path], 'base64');
    assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
  }
  state.authorArchive = { archiveSha256: hash(compressed), filesVerified: metadata.files.length };
  writeFileSync(join(capture, 'author-pandoc.json'), Buffer.from(archive['pandoc/REPORT.json'], 'base64'));
  state.setupCompleted = new Date().toISOString();
  save('state.json', state);
  console.log(JSON.stringify({ capture, scratch, sourceFiles: paths.size, emittedFiles: Object.keys(state.emittedBefore).length, tarballSha256: state.tarballSha256, installed }));
} catch (error) {
  state.setupError = error.stack; save('state.json', state); throw error;
}
