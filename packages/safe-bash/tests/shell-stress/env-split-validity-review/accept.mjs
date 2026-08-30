import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, readlink, lstat, realpath, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';


const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
assert.equal(root, '/Users/kjopek/Workspace/safe-bash');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, timeout: 20000, maxBuffer: 128 * 1024 * 1024 });
const fixtureCommit = 'f2906a064d2558c634cdc1b71a7b74fd2f6d022a';
const fixturePrefix = 'tests/shell-stress/env-split-validity';
const packedCommit = 'b44fa142a0da9593df533c56fd149cb38603ea68';
const preparationCommit = '2fdc16ae8130830dc6f51c70cba540ca3716bc4c';
const authorThreadId = '01a042ee-bfce-7b80-b667-af14bd426f64';
const reviewerThreadId = '01a042ef-2082-7a20-a1b5-c3ba7235ff76';
assert.notEqual(authorThreadId, reviewerThreadId);
const committed = (commit, filename) => git(['show', commit + ':' + filename]);
const revisedFiles = Object.fromEntries(git(['ls-tree', '-r', '--name-only', fixtureCommit, '--', fixturePrefix]).toString().trim().split('\n').map(filename => [relative(fixturePrefix, filename), committed(fixtureCommit, filename)]));
assert.equal(Object.keys(revisedFiles).length, 15);
const freeze = JSON.parse(revisedFiles['freeze-v1.json']);
assert.equal(freeze.sourceCommit, '84ab66ca717e0dff21abf57051b41cb553f3c7f3');
assert.equal(freeze.tarballSha256, '3ac9f899fbabb14e0473a9345113642fbfd2d12ac6e957659695b6b9e2fbac8c');
for (const [filename, hash] of Object.entries(freeze.fixtureFiles)) assert.equal(sha256(revisedFiles[filename]), hash);
const { nativeCases, hostCases } = await import('data:text/javascript;base64,' + revisedFiles['cases.mjs'].toString('base64'));
const previousReview = JSON.parse(committed(packedCommit, 'tests/shell-stress/env-split-holdout/core-review-84ab66c.json'));
const hostIds = previousReview.hosts.map(row => row.id);
const runnerHashes = Object.fromEntries(['accept.mjs', 'independent-controls.mjs', 'PREPARATION.md', 'pins.json'].map(filename => [filename, sha256(readFileSync(resolve(owned, filename)))]));
for (const filename of ['PREPARATION.md', 'pins.json']) assert.equal(runnerHashes[filename], sha256(committed(preparationCommit, 'tests/shell-stress/env-split-validity-review/' + filename)));
const output = resolve(process.argv[2] ?? resolve(owned, 'acceptance-1.json'));
assert.ok(output.startsWith(owned + '/') || output.startsWith('/tmp/'), 'Owned or regular /tmp output only');
assert.equal(existsSync(output), false, 'Never overwrite an author/reviewer attempt');
const scratch = await realpath(await mkdtemp('/tmp/safe-bash-env-validity-review-'));
const archive = resolve(scratch, 'archive');
const beforeMove = resolve(scratch, 'installation');
const consumer = resolve(scratch, 'moved-consumer');
const installed = resolve(consumer, 'node_modules/virtual-bash');
const report = { role: 'different independent fixture-validity acceptance', reviewerThreadId, authorThreadId, preparationCommit, runnerDerivedFrom: { commit: fixtureCommit, path: fixturePrefix + '/run-v1.mjs', sha256: sha256(revisedFiles['run-v1.mjs']) }, runnerHashes, started: new Date().toISOString(), sourceCommit: freeze.sourceCommit, fixtureCommit, scratch, phases: [], hidden: [], hosts: [], consumer: [], originalHidden: [], originalHosts: [], originalConsumer: [], independentControls: [], manifests: {}, freshNativeRuns: 0 };
const manifest = value => { const digest = sha256(JSON.stringify(value)); report.manifests[digest] = value; return digest; };
const transport = resolve(scratch, 'transport');
await mkdir(transport);
for (const filename of ['packed-tar.mjs', 'support.mjs']) await writeFile(resolve(transport, filename), committed(packedCommit, 'tests/shell-stress/env-split-consumer/' + filename));
const { inspectTar } = await import(pathToFileURL(resolve(transport, 'packed-tar.mjs')).href);
const filesAt = async (directory, toolLinks = false) => {
  const result = {};
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) {
        assert.ok(toolLinks, 'No alias: ' + path);
        const actual = await realpath(path); assert.ok(actual.startsWith(directory + '/') && (await lstat(actual)).isFile());
        result[relative(directory, path)] = { link: await readlink(path), target: relative(directory, actual), sha256: sha256(await readFile(actual)) };
        continue;
      }
      if (entry.isDirectory()) await visit(path);
      else { assert.ok(entry.isFile()); result[relative(directory, path)] = sha256(await readFile(path)); }
    }
  }
  await visit(directory); return result;
};
async function frozenGuard() {
  for (const [path, expected] of Object.entries(freeze.originalFiles)) assert.equal(sha256(await readFile(resolve(root, path))), expected.sha256, 'Original changed: ' + path);
  for (const [filename, expected] of Object.entries(revisedFiles)) assert.deepEqual(committed(fixtureCommit, fixturePrefix + '/' + filename), expected);
  for (const [filename, hash] of Object.entries(runnerHashes)) assert.equal(sha256(await readFile(resolve(owned, filename))), hash);
  for (const filename of ['packed-tar.mjs', 'support.mjs']) assert.deepEqual(await readFile(resolve(transport, filename)), committed(packedCommit, 'tests/shell-stress/env-split-consumer/' + filename));
  return true;
}
const environment = { PATH: dirname(process.execPath), HOME: resolve(scratch, 'home'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', npm_config_cache: resolve(scratch, 'cache'), npm_config_userconfig: resolve(scratch, 'user.npmrc'), npm_config_globalconfig: resolve(scratch, 'global.npmrc'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false' };
async function phase(id, executable, args, cwd, env = environment, input = '', deadline = 60000) {
  const record = { id, executable, args, cwd, env, started: new Date().toISOString() };
  report.phases.push(record);
  record.run = await new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = []; const stderr = []; let bytes = 0; let timedOut = false; let overflow = false; let watchdogKilled = false;
    const killOwned = () => { watchdogKilled = true; try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const timer = setTimeout(() => { timedOut = true; killOwned(); }, deadline);
    const append = target => chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { overflow = true; killOwned(); } else target.push(Buffer.from(chunk)); };
    child.stdout.on('data', append(stdout)); child.stderr.on('data', append(stderr));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      let groupAlive = false;
      try { process.kill(-child.pid, 0); groupAlive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (groupAlive) killOwned();
      accept({ pid: child.pid, status, signal, timedOut, overflow, watchdogKilled, groupAlive, stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex') });
    });
    child.stdin.end(input);
  });
  record.finished = new Date().toISOString();
  assert.equal(record.run.timedOut || record.run.overflow || record.run.groupAlive || record.run.watchdogKilled, false, id + ' failed bounded child lifecycle');
  assert.equal(record.run.signal, null);
  return record;
}
const success = record => assert.equal(record.run.status, 0, record.id + ': ' + Buffer.from(record.run.stdoutHex + record.run.stderrHex, 'hex').toString());
const json = path => JSON.parse(committed(packedCommit, path));
const historical = json('tests/shell-stress/env-split-consumer/packed-core-84ab66c.json');
const hiddenHistorical = json('tests/shell-stress/env-split-holdout/core-candidate-84ab66c.json');
const nativeHidden = json('tests/shell-stress/env-split-holdout/native-aligned.json');
const nativeConsumer = json('tests/shell-stress/env-split-consumer/native-frozen.json');
let packageHashes; let sourceHashes; let consumerInputs;
async function packageGuard() { const current = await filesAt(installed); assert.deepEqual(current, packageHashes); return manifest(current); }
async function product(id, script, args = [], request, allowFixtureFailure = false) {
  const before = await packageGuard();
  const sourceBefore = manifest(await sourceGuard());
  const inputBefore = manifest(await inputGuard());
  const captured = await phase(id, process.execPath, ['--unhandled-rejections=strict', resolve(consumer, script), ...args], consumer, { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CONSUMER_PACKAGE_ROOT: installed }, request ? JSON.stringify(request) : '', 20000);
  success(captured); assert.equal(captured.run.stderrHex, '', id + ' child stderr');
  const actual = JSON.parse(Buffer.from(captured.run.stdoutHex, 'hex').toString());
  const after = await packageGuard();
  assert.equal(before, after); assert.deepEqual(actual.forbidden, []);
  assert.ok(actual.loaded['dist/index.js'] && actual.loaded['dist/contracts/index.js'] && actual.loaded['dist/commands/env-split.js']);
  for (const [path, hash] of Object.entries(actual.loaded)) assert.equal(hash, packageHashes[path], 'Actual loaded file hash: ' + path);
  captured.loaded = manifest(actual.loaded); captured.packageBefore = before; captured.packageAfter = after;
  captured.sourceBefore = sourceBefore; captured.sourceAfter = manifest(await sourceGuard());
  captured.inputBefore = inputBefore; captured.inputAfter = manifest(await inputGuard());
  captured.requestSha256 = request ? sha256(JSON.stringify(request)) : null;
  captured.actual = actual;
  assert.equal(captured.sourceBefore, captured.sourceAfter); assert.equal(captured.inputBefore, captured.inputAfter);
  if (!allowFixtureFailure) assert.equal(actual.failure, undefined, id + ': ' + JSON.stringify(actual.failure));
  return actual;
}
async function sourceGuard() {
  const current = Object.fromEntries(await Promise.all(Object.keys(sourceHashes).map(async filename => [filename, sha256(await readFile(resolve(archive, filename)))])));
  assert.deepEqual(current, sourceHashes); return current;
}
async function inputGuard() {
  const current = Object.fromEntries(await Promise.all(Object.keys(consumerInputs).map(async filename => [filename, sha256(await readFile(resolve(consumer, filename)))])));
  assert.deepEqual(current, consumerInputs); return current;
}
const hiddenTuple = row => ({ ...row.result, effects: row.effects });
const nativeHiddenTuple = row => ({ status: row.result.status, stdout: row.result.stdout, stderr: row.result.stderr, effects: row.after });
const match = (actual, expected) => ({ exact: isDeepStrictEqual(actual, expected), fields: Object.fromEntries(Object.keys(expected).map(key => [key, isDeepStrictEqual(actual[key], expected[key])])) });
try {
  report.frozenBefore = await frozenGuard();
  assert.equal(process.version, historical.toolchain.node.version);
  assert.equal(sha256(await readFile(process.execPath)), historical.toolchain.node.hash);
  report.node = { path: process.execPath, version: process.version, sha256: sha256(await readFile(process.execPath)) };
  const selected = historical.manifests[historical.selectedGitInputs];
  const inventory = git(['ls-tree', '-r', '-z', freeze.sourceCommit]).toString().split('\0').filter(Boolean).map(line => { const [entry, path] = line.split('\t'); const [mode, type, blob] = entry.split(' '); return { mode, type, blob, path }; });
  assert.deepEqual(Object.fromEntries(inventory.filter(entry => entry.path.startsWith('src/') || !entry.path.includes('/')).map(entry => [entry.path, { blob: entry.blob, mode: entry.mode }])), selected);
  report.wholeTreeInventoryDigest = sha256(JSON.stringify(inventory)); assert.equal(report.wholeTreeInventoryDigest, historical.wholeTreeInventoryDigest);
  const archiveBytes = git(['archive', '--format=tar', freeze.sourceCommit, ...Object.keys(selected)]);
  const archived = inspectTar(archiveBytes);
  report.sourceArchiveSha256 = sha256(archiveBytes); assert.equal(report.sourceArchiveSha256, historical.archiveSha256);
  assert.deepEqual(Object.keys(archived.files).sort(), Object.keys(selected).sort());
  await mkdir(archive); await mkdir(beforeMove); await mkdir(environment.HOME); await mkdir(environment.npm_config_cache);
  await writeFile(environment.npm_config_userconfig, ''); await writeFile(environment.npm_config_globalconfig, '');
  for (const [path, entry] of Object.entries(archived.files)) {
    assert.equal(createHash('sha1').update(Buffer.from('blob ' + entry.data.length + '\0')).update(entry.data).digest('hex'), selected[path].blob);
    await mkdir(dirname(resolve(archive, path)), { recursive: true }); await writeFile(resolve(archive, path), entry.data);
  }
  sourceHashes = await filesAt(archive); assert.deepEqual(sourceHashes, historical.manifests[historical.sourceBefore]);
  report.sourceBefore = manifest(sourceHashes);
  const compiler = historical.toolchain.compiler; const modules = historical.toolchain.modules;
  assert.equal(sha256(await readFile(compiler)), historical.toolchain.compilerHash);
  assert.equal(sha256(await readFile(resolve(modules, 'typescript/lib/_tsc.js'))), historical.toolchain.implementationHash);
  const toolInputs = historical.manifests[historical.toolchain.compilerInputsBefore];
  for (const [path, hash] of Object.entries(toolInputs)) assert.equal(sha256(await readFile(path)), hash, 'Compiler toolchain changed: ' + path);
  report.compilerToolInputs = manifest(toolInputs);
  await symlink(modules, resolve(archive, 'node_modules'));
  const build = await phase('archived-source-build', process.execPath, [compiler, '-p', resolve(archive, 'tsconfig.build.json'), '--listFiles'], archive);
  await rm(resolve(archive, 'node_modules')); success(build); assert.equal(build.run.stderrHex, '');
  const actualBuildFiles = Buffer.from(build.run.stdoutHex, 'hex').toString().trim().split('\n');
  const expectedBuildFiles = Object.keys(historical.manifests[historical.phases.find(phase => phase.id === 'build').inputHashes]).map(path => path.startsWith(historical.archiveRoot + '/') ? resolve(archive, relative(historical.archiveRoot, path)) : path);
  assert.deepEqual([...actualBuildFiles].sort(), expectedBuildFiles.sort());
  report.buildInputs = manifest(Object.fromEntries(await Promise.all(actualBuildFiles.map(async path => { const actual = await realpath(path); const expected = actual.startsWith(archive + '/') ? sourceHashes[relative(archive, actual)] : toolInputs[actual]; const hash = sha256(await readFile(actual)); assert.equal(hash, expected); return [path, { realpath: actual, sha256: hash }]; }))));
  const emitted = await filesAt(resolve(archive, 'dist')); assert.deepEqual(emitted, historical.manifests[historical.emitted]); report.emitted = manifest(emitted);
  const tarball = json('tests/shell-stress/env-split-consumer/packed-core-84ab66c-tarball.json');
  const tgz = Buffer.from(tarball.data, 'base64');
  assert.equal(sha256(tgz), tarball.sha256); assert.equal(tgz.length, tarball.size); assert.equal(tarball.sha256, freeze.tarballSha256);
  assert.equal(createHash('sha1').update(tgz).digest('hex'), tarball.shasum);
  assert.equal('sha512-' + createHash('sha512').update(tgz).digest('base64'), tarball.integrity);
  const tar = inspectTar(tgz, { compressed: true, prefix: 'package/' });
  packageHashes = Object.fromEntries(Object.entries(tar.files).map(([path, file]) => [path.slice('package/'.length), file.sha256]));
  assert.deepEqual(packageHashes, historical.manifests[historical.packedFiles]);
  for (const [path, hash] of Object.entries(packageHashes)) assert.equal(hash, path.startsWith('dist/') ? emitted[path.slice(5)] : sourceHashes[path]);
  report.tarball = { sha256: tarball.sha256, size: tgz.length, shasum: tarball.shasum, integrity: tarball.integrity, files: Object.keys(packageHashes).length, reusedOriginalPack: true, newPack: false };
  report.packedFiles = manifest(packageHashes);
  const packageJson = JSON.parse(tar.files['package/package.json'].data);
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies', 'workspaces']) assert.equal(Object.keys(packageJson[key] ?? {}).length, 0, key);
  assert.equal(packageJson.name, 'virtual-bash'); report.package = packageJson;
  const tarPath = resolve(scratch, 'virtual-bash-original-84ab.tgz'); await writeFile(tarPath, tgz);
  await writeFile(resolve(beforeMove, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const npm = historical.toolchain.npm;
  const npmBefore = await filesAt(dirname(dirname(npm)), true);
  assert.deepEqual(npmBefore, historical.manifests[historical.toolchain.npmFiles]);
  report.npmFilesBefore = manifest(npmBefore);
  report.npmEntrypointSha256 = sha256(await readFile(npm));
  success(await phase('offline-original-tgz-install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarPath], beforeMove));
  assert.equal((await lstat(resolve(beforeMove, 'node_modules/virtual-bash'))).isSymbolicLink(), false);
  assert.deepEqual((await readdir(resolve(beforeMove, 'node_modules'))).filter(name => !name.startsWith('.')), ['virtual-bash']);
  await rename(beforeMove, consumer); assert.equal(existsSync(beforeMove), false);
  report.move = { from: beforeMove, to: consumer, oldPathAbsent: true, packageRoot: await realpath(installed), packageIsRealDirectory: (await lstat(installed)).isDirectory() };
  report.installedBefore = await packageGuard();
  report.revisedInputHashes = Object.fromEntries(Object.entries(revisedFiles).map(([filename, bytes]) => [filename, sha256(bytes)]));
  report.inputCrosswalk = [];
  for (const [oldPath, revisedName] of [
    ['env-split-consumer/cases.mjs', 'cases.mjs'],
    ['env-split-holdout/product-row-bytes-v2.mjs', 'product-row-v1.mjs'],
    ['env-split-holdout/hosts.mjs', 'hosts-v1.mjs'],
    ['env-split-consumer/consumer.mjs', 'consumer-v1.mjs'],
    ['env-split-consumer/packed-public-types.ts', 'public-types.mts'],
  ]) {
    const oldBytes = committed(packedCommit, 'tests/shell-stress/' + oldPath);
    report.inputCrosswalk.push({ oldCommit: packedCommit, oldPath, oldSha256: sha256(oldBytes), revisedCommit: fixtureCommit, revisedName, revisedSha256: sha256(revisedFiles[revisedName]), identical: oldBytes.equals(revisedFiles[revisedName]) });
  }
  assert.ok(report.inputCrosswalk[0].identical && report.inputCrosswalk[1].identical);
  const copied = Object.fromEntries(['cases.mjs', 'consumer-v1.mjs', 'hidden-v1.mjs', 'hosts-v1.mjs', 'product-row-v1.mjs', 'controls-v1.mjs', 'public-types.mts', 'invalid-binding.mts'].map(filename => [filename, revisedFiles[filename]]));
  const originalCopies = {
    'consumer-original.mjs': 'env-split-consumer/consumer.mjs',
    'hosts-original.mjs': 'env-split-holdout/hosts.mjs',
    'product-row.mjs': 'env-split-holdout/product-row.mjs',
    'product-row-bytes-v2.mjs': 'env-split-holdout/product-row-bytes-v2.mjs',
  };
  for (const [filename, originalPath] of Object.entries(originalCopies)) copied[filename] = committed(packedCommit, 'tests/shell-stress/' + originalPath);
  copied['hidden-original.mjs'] = Buffer.from(revisedFiles['hidden-v1.mjs'].toString().replace("'./hosts-v1.mjs'", "'./hosts-original.mjs'").replace("'./product-row-v1.mjs'", "'./product-row-bytes-v2.mjs'"));
  copied['independent-controls.mjs'] = await readFile(resolve(owned, 'independent-controls.mjs'));
  report.originalWrapperAdaptation = 'Only hidden-v1 static helper imports select the unchanged original host and setup-v2 row modules. The original helper throws remain fixture failures; wrapper serializes the outer assertion, never absent inner stderr.';
  for (const [filename, bytes] of Object.entries(copied)) await writeFile(resolve(consumer, filename), bytes);
  consumerInputs = Object.fromEntries(Object.entries(copied).map(([filename, bytes]) => [filename, sha256(bytes)]));
  report.consumerInputHashes = manifest(consumerInputs);
  const typeOptions = historical.phases.find(phase => phase.id === 'public-types').args.slice(1, -1);
  const types = await phase('moved-installed-public-types', process.execPath, [compiler, ...typeOptions, resolve(consumer, 'public-types.mts')], consumer); success(types); assert.equal(types.run.stderrHex, '');
  const typeFiles = Buffer.from(types.run.stdoutHex, 'hex').toString().trim().split('\n');
  assert.ok(typeFiles.includes(resolve(installed, 'dist/index.d.ts')) && typeFiles.includes(resolve(installed, 'dist/contracts/index.d.ts')));
  report.typeInputs = manifest(Object.fromEntries(await Promise.all(typeFiles.map(async path => {
    const actual = await realpath(path); const hash = sha256(await readFile(actual));
    const expected = actual.startsWith(installed + '/') ? packageHashes[relative(installed, actual)] : actual === resolve(consumer, 'public-types.mts') ? freeze.fixtureFiles['public-types.mts'] : toolInputs[actual];
    assert.equal(hash, expected, 'Unlisted type input: ' + actual); return [path, { realpath: actual, sha256: hash }];
  }))));
  const negative = await phase('invalid-byte-binding-type-negative', process.execPath, [compiler, ...typeOptions.filter(arg => arg !== '--listFiles'), resolve(consumer, 'invalid-binding.mts')], consumer);
  assert.equal(negative.run.status, 2); assert.equal(negative.run.stderrHex, '');
  const diagnostic = Buffer.from(negative.run.stdoutHex, 'hex').toString(); assert.match(diagnostic, /invalid-binding\.mts\(2,\d+\): error TS2741:/u); assert.match(diagnostic, /\[Symbol\.asyncIterator\]/u); assert.equal((diagnostic.match(/error TS/gu) ?? []).length, 1);
  report.nativeProfiles = { hidden: nativeHidden.profiles.map(({ rows, ...profile }) => ({ ...profile, rows: freeze.hiddenIds.length, reusedImmutableCapture: true })), consumer: { tool: nativeConsumer.envTool, profiles: nativeConsumer.profiles.map(({ rows, controls, ...profile }) => ({ ...profile, rows: rows.length, originalControlsRetained: controls.length, reusedImmutableCapture: true })) } };
  const originalRows = nativeHidden.profiles[0].rows.filter(row => ['command', 'single-optional'].includes(row.category));
  assert.deepEqual(originalRows.map(row => row.id), freeze.hiddenIds);
  for (const row of originalRows) {
    const actual = await product('original-hidden:' + row.id, 'hidden-original.mjs', [], { kind: 'row', id: row.id, row });
    const tuple = hiddenTuple(actual.result.result);
    const prior = hiddenHistorical.records.find(record => record.kind === 'row' && record.id === row.id);
    assert.deepEqual(tuple, prior.comparison.actual);
    report.originalHidden.push({ id: row.id, category: row.category, inputSha256: sha256(JSON.stringify(row)), tuple, ...match(tuple, nativeHiddenTuple(row)) });
  }
  for (const id of hostIds) {
    const actual = await product('original-host:' + id, 'hidden-original.mjs', [], { kind: 'host', id }, true);
    report.originalHosts.push(actual);
    if (id === 'literal-invoke-replace-env-parent') {
      assert.equal(actual.failure?.name, 'AssertionError'); assert.equal(actual.result, undefined);
      assert.match(actual.failure.message, /parent:private/u);
    } else { assert.equal(actual.failure, undefined); assert.equal(actual.result.result.passed, true); }
  }
  for (const fixture of [...nativeCases, ...hostCases]) {
    const actual = await product('original-consumer:' + fixture.id, 'consumer-original.mjs', [fixture.id]);
    const previous = historical.product.find(row => row.id === fixture.id).actual;
    assert.equal(actual.observations.length, previous.observations.length);
    for (let index = 0; index < actual.observations.length; index++) {
      const observation = actual.observations[index];
      assert.equal(observation.passed, false);
      for (const key of ['variant', 'tuple', 'passed', 'error', 'sameReason', 'ticks', 'sinks', 'waiterCalls', 'disposed']) assert.deepEqual(observation[key], previous.observations[index][key], fixture.id + ':' + key);
    }
    report.originalConsumer.push({ id: fixture.id, kind: fixture.kind ?? 'native', actual,
      profiles: !fixture.kind ? nativeConsumer.profiles.map(profile => ({ role: profile.role, ...match(actual.observations[0].tuple, profile.rows.find(row => row.id === fixture.id).tuple) })) : undefined });
  }
  for (const profile of nativeHidden.profiles) for (const id of freeze.hiddenIds) {
    const row = profile.rows.find(row => row.id === id); assert.ok(row);
    const actual = await product('hidden:' + profile.id + ':' + id, 'hidden-v1.mjs', [], { kind: 'row', id, row });
    const tuple = hiddenTuple(actual.result.result); const expected = nativeHiddenTuple(row);
    const record = { id, category: row.category, profile: profile.id, inputSha256: sha256(JSON.stringify(row)), actual: actual.result, expected, tuple, ...match(tuple, expected), supportedCore: row.category === 'command' };
    report.hidden.push(record);
    if (profile.id === 'gnu97-darwin-primary') {
      const replayedOriginal = report.originalHidden.find(row => row.id === id);
      assert.equal(record.inputSha256, replayedOriginal.inputSha256); assert.deepEqual(tuple, replayedOriginal.tuple);
      const prior = hiddenHistorical.records.find(record => record.kind === 'row' && record.id === id);
      assert.deepEqual(tuple, prior.comparison.actual, 'Unexpected product change; stop before any fixture expectation change: ' + id);
      if (freeze.diagnosticProfiles[id]) { assert.deepEqual(tuple, freeze.diagnosticProfiles[id]); record.additionalVirtualDiagnosticProfile = true; assert.equal(record.exact, false); }
    }
  }
  for (const id of hostIds) {
    const actual = await product('hidden-host:' + id, 'hidden-v1.mjs', [], { kind: 'host', id });
    report.hosts.push(actual); assert.equal(actual.result.result.passed, true);
  }
  for (const fixture of [...nativeCases, ...hostCases]) {
    const actual = await product('consumer:' + fixture.id, 'consumer-v1.mjs', [fixture.id]);
    const record = { id: fixture.id, kind: fixture.kind ?? 'native', supportedCore: !fixture.kind && !fixture.header, actual };
    report.consumer.push(record);
    assert.equal(actual.observations.length, fixture.variants?.length ?? 1);
    for (const observation of actual.observations) {
      assert.notEqual(observation.passed, false, 'Revised fixture assertion failed: ' + JSON.stringify(observation.error));
      assert.equal(observation.disposed, true);
      if (!fixture.kind) {
        assert.equal(observation.error, null);
        const prior = historical.product.find(row => row.id === fixture.id).actual.observations[0].tuple;
        assert.deepEqual(observation.tuple, prior, 'Primary tuple changed: ' + fixture.id);
        record.profiles = nativeConsumer.profiles.map(profile => { const expected = profile.rows.find(row => row.id === fixture.id).tuple; return { role: profile.role, expected, ...match(observation.tuple, expected) }; });
      } else {
        assert.equal(observation.passed, true);
        const original = report.originalConsumer.find(row => row.id === fixture.id).actual.observations.find(row => row.variant === observation.variant);
        assert.deepEqual(observation.tuple, original.tuple, 'Primary host tuple must not change');
        assert.deepEqual(observation.ticks, original.ticks); assert.deepEqual(observation.sinks, original.sinks);
        assert.equal(observation.waiterCalls, original.waiterCalls);
        if (fixture.kind === 'budget') {
          assert.deepEqual(observation.budget, { original: 4, setupCommands: 3, revised: 7 });
          assert.deepEqual({ command: original.calls.at(-1).command, args: original.calls.at(-1).args }, { command: 'printf', args: ['%s|%s', '', 'parent-public'] });
          assert.deepEqual(observation.calls.filter(call => call.command !== 'parentbefore').map(call => call.command), original.calls.slice(0, -1).map(call => call.command));
        }
      }
    }
  }
  report.controls = await product('additional-explicit-replacement-controls', 'controls-v1.mjs');
  assert.equal(report.controls.observations.length, 12); assert.ok(report.controls.observations.every(row => row.passed));
  for (const group of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) {
    const actual = await product('independent:' + group, 'independent-controls.mjs', [group]);
    report.independentControls.push(actual); assert.equal(actual.passed, true);
  }
  report.installedAfter = await packageGuard();
  const sourceAfter = Object.fromEntries(await Promise.all(Object.keys(sourceHashes).map(async path => [path, sha256(await readFile(resolve(archive, path)))])));
  assert.deepEqual(sourceAfter, sourceHashes); report.sourceAfter = manifest(sourceAfter);
  assert.deepEqual(await filesAt(resolve(archive, 'dist')), emitted);
  for (const [path, hash] of Object.entries(toolInputs)) assert.equal(sha256(await readFile(path)), hash);
  assert.equal(sha256(await readFile(tarPath)), tarball.sha256);
  assert.deepEqual(await filesAt(dirname(dirname(npm)), true), npmBefore);
  report.consumerInputsAfter = manifest(await inputGuard());
  report.summary = {
    originalHidden: { total: report.originalHidden.length, strictExact: report.originalHidden.filter(row => row.exact).length },
    originalHosts: { total: report.originalHosts.length, passed: report.originalHosts.filter(row => row.result?.result.passed).length },
    originalConsumer: nativeConsumer.profiles.map(profile => ({ profile: profile.role, total: 10, assertionsPassed: 0, rawExact: report.originalConsumer.filter(row => row.profiles?.find(item => item.role === profile.role)?.exact).length })),
    originalConsumerHosts: { cases: 3, executions: 5, passed: 0 },
    independentControls: { groups: report.independentControls.length, passed: report.independentControls.filter(row => row.passed).length, variants: report.independentControls.reduce((sum, row) => sum + row.observations.length, 0) },
    hidden: nativeHidden.profiles.map(profile => { const rows = report.hidden.filter(row => row.profile === profile.id); return { profile: profile.id, total: rows.length, strictExact: rows.filter(row => row.exact).length, command: { total: 42, strictExact: rows.filter(row => row.category === 'command' && row.exact).length }, protocol: { total: 6, strictExact: rows.filter(row => row.category === 'single-optional' && row.exact).length, supportedCoreCredit: 0 }, additionalVirtualDiagnosticChecks: rows.filter(row => row.additionalVirtualDiagnosticProfile).length }; }),
    hiddenHosts: { total: 7, passed: report.hosts.length },
    consumer: nativeConsumer.profiles.map(profile => ({ profile: profile.role, total: 10, strictExact: report.consumer.filter(row => row.profiles?.find(item => item.role === profile.role)?.exact).length, supportedCore: report.consumer.filter(row => row.supportedCore && row.profiles.find(item => item.role === profile.role).exact).length, unsupportedShebang: 3 })),
    consumerHosts: { cases: 3, executions: 5, passed: report.consumer.filter(row => row.kind !== 'native').reduce((sum, row) => sum + row.actual.observations.filter(observation => observation.passed).length, 0) },
    additionalPolicyControls: { total: 12, passed: report.controls.observations.filter(row => row.passed).length },
    childProcesses: report.phases.length,
  };
  assert.deepEqual(report.summary.originalHidden, { total: 48, strictExact: 40 });
  assert.deepEqual(report.summary.originalHosts, { total: 7, passed: 6 });
  assert.equal(report.summary.hidden[0].command.strictExact, 39);
  assert.equal(report.summary.hidden[0].additionalVirtualDiagnosticChecks, 3);
  assert.equal(report.summary.hidden[0].protocol.strictExact, 1);
  assert.equal(report.summary.hiddenHosts.passed, 7);
  assert.equal(report.summary.consumerHosts.passed, 5);
  assert.ok(report.summary.consumer.every(profile => profile.strictExact === 7 && profile.supportedCore === 7));
  assert.deepEqual(report.summary.independentControls, { groups: 6, passed: 6, variants: 14 });
  report.completed = true;
} catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  try { report.frozenAfter = await frozenGuard(); } catch (error) { report.freezeFailure = error.message; process.exitCode = 1; }
  report.finished = new Date().toISOString();
  await rm(scratch, { recursive: true, force: true }); report.cleanup = { scratchAbsent: !existsSync(scratch), childGroups: report.phases.filter(phase => phase.run).map(phase => { let alive = false; try { process.kill(-phase.run.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; } return { id: phase.id, pid: phase.run.pid, alive }; }) };
  assert.equal(existsSync(output), false);
  const text = JSON.stringify(report, null, 2) + '\n';
  execFileSync('apply_patch', [], { cwd: root, input: '*** Begin Patch\n*** Add File: ' + output + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n', maxBuffer: 32 * 1024 * 1024 });
  console.log(JSON.stringify({ output, summary: report.summary, failure: report.failure, cleanup: report.cleanup.scratchAbsent, frozenAfter: report.frozenAfter }));
}
