import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, toolInventory, read, save, supervised } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..');
const capture = join(own, process.argv[2] ?? 'run01');
assert(!existsSync(capture)); mkdirSync(capture);
const work = join(capture, 'work'), build = join(work, 'build'), tools = join(work, 'tools'), consumer = join(work, 'consumer');
for (const directory of [build, tools, consumer, join(work, 'home')]) mkdirSync(directory, { recursive: true });
const source = '9ae34a06662db27897043d77d6145700c109b22c', verification = '2c5178caaa90f687cfedd127879bf88e9f2b8f87', evidence = 'cbed49318f91db0be47a9e6638092452b448a0c1', previous = '6177f88d08e42e111822abefe105ad39de6f647b', freeze = 'c10642866846d83a8a1f61e9712a30aab0ed0cd7';
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const inputs = {};
function materialize(revision, path, destination) {
  const bytes = git('show', revision + ':' + path);
  inputs[revision + ':' + path] = { sha256: hash(bytes), blob: git('rev-parse', revision + ':' + path).toString().trim(), bytes: bytes.length };
  mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes); return bytes.toString();
}
const paths = new Set();
function collect(path) {
  if (paths.has(path)) return; paths.add(path);
  const text = materialize(source, path, join(build, path));
  for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/gu)) {
    const dependency = posix.normalize(posix.join(posix.dirname(path), match[1])).replace(/\.js$/u, '.ts');
    if (dependency.endsWith('.ts')) collect(dependency);
  }
}
for (const path of ['src/commands/html-to-markdown/index.ts', 'src/fs/memory/index.ts', 'src/shell/index.ts']) collect(path);
for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'src/commands/html-to-markdown/README.md']) materialize(source, path, join(build, path));
const sourceDelta = git('diff', source + '^', source, '--name-only', '--', 'src').toString().trim().split('\n');
assert.deepEqual(sourceDelta, ['src/commands/html-to-markdown/README.md', 'src/commands/html-to-markdown/render.ts']);
const declaredParent = git('rev-parse', source + '^').toString().trim();
const handoffRevision = '309f6be38cd5c07d3991fc625a1481c28cd798eb';
const handoffBase = 'tests/commands/html-to-markdown/inline-normalization-fix/';
const manifest = JSON.parse(materialize(handoffRevision, handoffBase + 'MANIFEST.json', join(capture, 'supplied-MANIFEST.json')));
const compressed = Buffer.from(git('show', handoffRevision + ':' + handoffBase + 'EVIDENCE.json.gz.base64').toString(), 'base64');
assert.equal(hash(compressed), manifest.compressedSHA256);
const archive = JSON.parse(gunzipSync(compressed));
assert.deepEqual(Object.keys(archive).sort(), Object.keys(manifest.files).sort());
for (const [path, entry] of Object.entries(manifest.files)) { const bytes = Buffer.from(archive[path], 'base64'); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); }
const suppliedTarball = join(capture, 'supplied-package.tgz');
writeFileSync(suppliedTarball, Buffer.from(archive['fixed-01/package.tgz'], 'base64'));
assert.equal(hash(readFileSync(suppliedTarball)), 'aed5586e0e11880d3734fb788f124ccc55cae905b57d01a24bc754da107c325d');
save(join(capture, 'supplied-RESULT.json'), JSON.parse(Buffer.from(archive['fixed-01/RESULT.json'], 'base64')));
materialize(handoffRevision, handoffBase + 'REPORT.md', join(capture, 'supplied-REPORT.md'));
const legacy = join(work, 'legacy'); mkdirSync(legacy);
for (const name of ['consumer.mjs', 'supplemental-consumer.mjs', 'frozen-cases.mjs', 'frozen-protocols.json', 'followup-semantic.json', 'audit-loader.mjs', 'execute.mjs', 'setup.mjs', 'semantic-audit.mjs', 'REPORT.md', 'COMPARATIVE.md', 'CORRECTIONS-v2.md', 'CASE-MATRIX-v2.json', 'EVIDENCE.json']) materialize(previous, 'tests/commands/html-to-markdown-independent-20260827/' + name, join(legacy, name));
const author = join(capture, 'author');
for (const name of ['README.md', 'RAW_REPORT.json', 'ORIGINAL_FOLLOWUP.json', 'SOURCE_RECEIPT.json', 'semantics.json', 'canonical.tap.data', 'verify.mjs', 'worker.mjs']) materialize(evidence, 'tests/commands/html-to-markdown/fix-review/' + name, join(author, name));
for (const name of ['render', 'io', 'limits', 'adversarial']) {
  const path = 'tests/commands/html-to-markdown/' + name + '.test.ts';
  assert.equal(hash(git('show', source + ':' + path)), hash(git('show', '21ca7b8c9c4afde7286aac479e070b29bbf5d5ed:' + path)));
}
for (const [name, digest] of Object.entries(read(join(author, 'RAW_REPORT.json')).sourceBefore)) if (!['render.ts', 'README.md'].includes(name)) assert.equal(hash(git('show', source + ':src/commands/html-to-markdown/' + name)), digest);
const handoff = read(join(author, 'ORIGINAL_FOLLOWUP.json'));
assert.equal(hash(readFileSync(join(legacy, 'followup-semantic.json'))), handoff.fixtureSHA256);
for (const delta of read(join(own, 'EXPECTATION-v2.json')).cases) {
  const old = read(join(legacy, 'followup-semantic.json')).find(row => row.id === delta.id);
  assert.equal(old.input, delta.input); assert.deepEqual(old.limits, delta.limits);
  const documented = handoff.rows.find(row => row.id === delta.id).result;
  assert.deepEqual([documented.exitCode, documented.output, documented.stderr], [delta.status, delta.stdout, delta.stderr]);
}
const lock = read(join(build, 'package-lock.json')), toolchain = {};
for (const name of ['typescript', '@types/node', 'undici-types']) {
  const from = realpathSync(join(repo, 'node_modules', name)), to = join(tools, 'node_modules', name);
  mkdirSync(dirname(to), { recursive: true }); cpSync(from, to, { recursive: true });
  assert.equal(read(join(to, 'package.json')).version, lock.packages['node_modules/' + name].version);
  toolchain[name] = { lock: lock.packages['node_modules/' + name], files: inventory(to) };
}
const npmRoot = realpathSync(join(dirname(process.execPath), '../lib/node_modules/npm'));
const npm = join(npmRoot, 'bin/npm-cli.js'), pandoc = realpathSync('/opt/homebrew/bin/pandoc');
toolchain.npm = { root: npmRoot, files: toolInventory(npmRoot) };
toolchain.node = { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) };
toolchain.pandoc = { path: pandoc, sha256: hash(readFileSync(pandoc)) };
assert.equal(toolchain.pandoc.sha256, '61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d');
save(join(build, 'independent-build.json'), { extends: './tsconfig.build.json', compilerOptions: { typeRoots: [join(tools, 'node_modules/@types')], types: ['node'] }, files: [...paths].sort(), include: [], exclude: [] });
const sourceBefore = inventory(build);
const scriptsBefore = Object.fromEntries(['setup.mjs', 'common.mjs', 'run.mjs', 'probe.mjs', 'seal.mjs', 'EXPECTATION-v2.json', 'FREEZE.md', 'followup.mjs', 'adjacent-probe.mjs', 'NEIGHBORS.json', 'HOLDOUTS.json', 'legacy-ast.mjs', 'holdouts.mjs', 'normalization-probe.mjs'].map(name => [name, hash(readFileSync(join(own, name)))]));
const state = { declaredParent, sourceDelta, handoffRevision, suppliedArchiveSHA256: hash(compressed), suppliedFiles: Object.keys(archive).length, suppliedPackSHA256: hash(readFileSync(suppliedTarball)), started: new Date().toISOString(), source, verification, evidence, previous, freeze, capture, work, build, tools, consumer, legacy, author, npm, npmRoot, pandoc, inputs, sourceBefore, toolchain, scriptsBefore, initialStatus: git('status', '--porcelain=v1').toString(), initialIndex: git('diff', '--cached', '--name-status').toString(), productSourceFiles: paths.size };
save(join(capture, 'PRE-RUN.json'), state);
const env = { PATH: dirname(process.execPath), HOME: join(work, 'home'), TMPDIR: work, npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'absent-user-npmrc'), npm_config_globalconfig: join(work, 'absent-global-npmrc'), npm_config_update_notifier: 'false', npm_config_audit: 'false' };
async function command(id, args, cwd = build) {
  const row = await supervised(join(capture, 'setup'), id, process.execPath, args, { cwd, env, deadlineMs: 30000, inputs: { sourceBefore, tools: hash(Buffer.from(JSON.stringify(toolchain))) }, driver: scriptsBefore['setup.mjs'] });
  assert.equal(row.outcome, 'PASS', id); return readFileSync(join(capture, 'setup', id + '.stdout'), 'utf8');
}
await command('compile', [join(tools, 'node_modules/typescript/bin/tsc'), '-p', 'independent-build.json', '--listFiles']);
state.compilerInputs = {};
for (const path of readFileSync(join(capture, 'setup/compile.stdout'), 'utf8').trim().split('\n')) { assert(path.startsWith(build + '/') || path.startsWith(tools + '/')); state.compilerInputs[path] = hash(readFileSync(path)); }
state.emittedBefore = inventory(join(build, 'dist'));
const pack = JSON.parse(await command('pack', [npm, 'pack', '--offline', '--ignore-scripts', '--json']));
const tarball = join(build, pack[0].filename); state.pack = pack; state.packSHA256 = hash(readFileSync(tarball)); cpSync(tarball, join(capture, pack[0].filename));
const installation = join(work, 'installation'); mkdirSync(installation);
writeFileSync(join(installation, 'package.json'), '{"private":true,"type":"module"}\n');
await command('install', [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', suppliedTarball], installation);
mkdirSync(join(consumer, 'node_modules'));
state.installed = join(consumer, 'node_modules/virtual-bash'); renameSync(join(installation, 'node_modules/virtual-bash'), state.installed);
state.installedBefore = inventory(state.installed); assert.deepEqual(inventory(join(state.installed, 'dist')), state.emittedBefore);
state.independentPackSHA256 = state.packSHA256; state.packSHA256 = state.suppliedPackSHA256;
assert.equal(Object.keys(read(join(state.installed, 'package.json')).dependencies ?? {}).length, 0);
state.isolated = join(work, 'retired-build'); renameSync(build, state.isolated);
state.isolatedBefore = inventory(state.isolated);
mkdirSync(join(build, 'src/commands/html-to-markdown'), { recursive: true });
state.poisonedSource = join(build, 'src/commands/html-to-markdown/index.ts'); writeFileSync(state.poisonedSource, 'throw new Error("POISONED_RETIRED_SOURCE_MUST_NOT_LOAD");\n');
writeFileSync(join(build, 'package.json'), '{"type":"module"}\n');
state.legacyBefore = inventory(legacy); state.authorBefore = inventory(author);
state.setupCompleted = new Date().toISOString(); save(join(capture, 'state.json'), state);
console.log(JSON.stringify({ source, freeze, sourceFiles: paths.size, emittedFiles: Object.keys(state.emittedBefore).length, packSHA256: state.packSHA256, capture }));
