import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, lstat, realpath, readlink, mkdir, symlink, rm, mkdtemp, access, chmod } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { owned, root, sha256, run, save } from './support.mjs';
import { inspectTar } from './packed-tar.mjs';
import { nativeCases, hostCases } from './cases.mjs';

const candidate = '84ab66ca717e0dff21abf57051b41cb553f3c7f3';
assert.equal(process.argv[2], '--root-authorized-84ab66c', 'Explicit ROOT candidate authorization required');
const frozen = 'dc1fcc48251027c240bf1674f1e0af7f0f16a2b4';
const output = 'packed-core-84ab66c.json';
assert.equal(await access(resolve(owned, output)).then(() => true, () => false), false, 'Never overwrite an attempt');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const scratch = await realpath(await mkdtemp('/tmp/safe-bash-env-packed-core-'));
const archiveRoot = resolve(scratch, 'archive'); const consumerRoot = resolve(scratch, 'consumer');
const cache = resolve(scratch, 'cache'); const packages = resolve(scratch, 'packages');
const report = { started: new Date().toISOString(), candidate, frozen, headForContext: git(['rev-parse', 'HEAD']).toString().trim(), scratch, archiveRoot, consumerRoot, manifests: {}, phases: [], product: [], nativeReferences: [], scope: 'Complete committed src and root package/build inputs, not latest live aggregate' };
const manifest = value => { const key = sha256(JSON.stringify(value)); report.manifests[key] = value; return key; };
const filesAt = async (directory, toolLinks = false) => {
  const result = {};
  const visit = async current => {
    for (const name of (await readdir(current)).sort()) {
      const path = resolve(current, name); const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        assert.ok(toolLinks, 'Unexpected symlink: ' + path);
        const actual = await realpath(path); assert.ok(actual.startsWith(directory + '/'), 'External tool symlink'); assert.ok((await lstat(actual)).isFile());
        result[relative(directory, path)] = { link: await readlink(path), target: relative(directory, actual), sha256: sha256(await readFile(actual)) }; continue;
      }
      if (stat.isDirectory()) await visit(path);
      else { assert.ok(stat.isFile()); result[relative(directory, path)] = sha256(await readFile(path)); }
    }
  };
  await visit(directory); return result;
};
const env = { PATH: dirname(process.execPath), HOME: resolve(scratch, 'home'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', npm_config_cache: cache, npm_config_userconfig: resolve(scratch, 'empty-user.npmrc'), npm_config_globalconfig: resolve(scratch, 'empty-global.npmrc'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false' };
const phase = async (id, executable, args, cwd, environment = env) => {
  const result = await run(executable, args, { cwd, env: environment, deadline: id === 'build' || id === 'public-types' ? 60000 : 20000 });
  const captured = { id, executable, args, cwd, env: environment, run: result }; report.phases.push(captured);
  assert.ok(!result.timedOut && !result.overflow && !result.signal && !result.groupAlive, id + ' bounded execution');
  return captured;
};
const requireSuccess = result => assert.equal(result.run.status, 0, result.id + ': ' + Buffer.from(result.run.stdoutHex + result.run.stderrHex, 'hex').toString());
try {
  const prepared = JSON.parse(await readFile(resolve(owned, 'preparation.json')));
  report.preparedInputHash = sha256(await readFile(resolve(owned, 'preparation.json')));
  const frozenFiles = git(['ls-tree', '-r', '--name-only', frozen, '--', 'tests/shell-stress/env-split-consumer']).toString().trim().split('\n');
  report.frozenInputs = manifest(Object.fromEntries(await Promise.all(frozenFiles.map(async path => {
    const bytes = await readFile(resolve(root, path)); assert.equal(sha256(bytes), sha256(git(['show', frozen + ':' + path])), path); return [path, sha256(bytes)];
  }))));
  const native = JSON.parse(await readFile(resolve(owned, 'native-frozen.json')));
  assert.equal(native.casesHash, sha256(await readFile(resolve(owned, 'cases.mjs'))));
  report.nativeReferences = native.profiles.map(profile => ({ role: profile.role, tool: native.envTool, binary: profile.binary, hash: profile.hash, rows: profile.rows.length, reused: true, freshNativeRuns: 0 }));
  const inventory = git(['ls-tree', '-r', '-z', candidate]).toString().split('\0').filter(Boolean).map(line => { const [entry, path] = line.split('\t'); const [mode, type, blob] = entry.split(' '); return { mode, type, blob, path }; });
  const selected = inventory.filter(entry => entry.path.startsWith('src/') || !entry.path.includes('/'));
  assert.ok(selected.some(entry => entry.path === 'src/commands/env-split.ts'));
  assert.ok(selected.every(entry => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)));
  report.candidateTree = git(['rev-parse', candidate + '^{tree}']).toString().trim();
  report.wholeTreeInventoryDigest = sha256(JSON.stringify(inventory)); report.wholeTreeFiles = inventory.length;
  report.selectedGitInputs = manifest(Object.fromEntries(selected.map(entry => [entry.path, { blob: entry.blob, mode: entry.mode }])));
  report.sourceFiles = selected.filter(entry => entry.path.startsWith('src/')).length;
  const inputBytes = git(['archive', '--format=tar', candidate, 'src', ...selected.filter(entry => !entry.path.includes('/')).map(entry => entry.path)]);
  report.archiveSha256 = sha256(inputBytes);
  const archived = inspectTar(inputBytes); report.archiveEntries = manifest(archived.entries);
  assert.deepEqual(Object.keys(archived.files).sort(), selected.map(entry => entry.path).sort());
  await mkdir(archiveRoot); await mkdir(consumerRoot); await mkdir(cache); await mkdir(packages); await mkdir(env.HOME);
  await writeFile(env.npm_config_userconfig, ''); await writeFile(env.npm_config_globalconfig, '');
  for (const entry of selected) {
    const file = archived.files[entry.path]; const blob = createHash('sha1').update(Buffer.from('blob ' + file.data.length + '\0')).update(file.data).digest('hex'); assert.equal(blob, entry.blob, entry.path);
    const path = resolve(archiveRoot, entry.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.data); await chmod(path, file.mode & 0o777);
  }
  const sourceBefore = await filesAt(archiveRoot); report.sourceBefore = manifest(sourceBefore);
  const sourceGuard = async () => {
    const current = Object.fromEntries(await Promise.all(Object.keys(sourceBefore).map(async name => [name, sha256(await readFile(resolve(archiveRoot, name)))])));
    const digest = manifest(current); assert.deepEqual(current, sourceBefore, 'Committed archive inputs changed'); return digest;
  };
  report.sourceAnchors = Object.fromEntries(['src/shell/runtime.ts', 'src/shell/parser.ts', 'src/commands/execution.ts', 'src/commands/env-split.ts', 'package.json', 'src/index.ts'].map(name => [name, sourceBefore[name]]));
  report.contracts = manifest(Object.fromEntries(Object.entries(sourceBefore).filter(([name]) => name.startsWith('src/contracts/'))));
  report.envCommitProductionDelta = git(['diff-tree', '--no-commit-id', '--name-only', '-r', candidate, '--', 'src']).toString().trim().split('\n');
  const packageJson = JSON.parse(await readFile(resolve(archiveRoot, 'package.json')));
  assert.equal(packageJson.name, 'virtual-bash'); assert.deepEqual(packageJson.files, ['dist']);
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies', 'workspaces']) assert.ok(!packageJson[key] || Object.keys(packageJson[key]).length === 0, 'Offline dependency gate: ' + key);
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.build.json');
  const buildConfig = JSON.parse(await readFile(resolve(archiveRoot, 'tsconfig.build.json'))); assert.equal(buildConfig.extends, './tsconfig.json');
  assert.equal(JSON.parse(await readFile(resolve(archiveRoot, 'tsconfig.json'))).extends, undefined);
  report.package = packageJson;
  const modules = await realpath(resolve(root, 'node_modules')); const compiler = resolve(modules, 'typescript/bin/tsc');
  const npm = await realpath(resolve(dirname(process.execPath), 'npm')); const npmRoot = dirname(dirname(npm));
  const compilerInputsBefore = {};
  for (const name of ['typescript', '@types/node', 'undici-types']) {
    const directory = resolve(modules, name);
    for (const [path, hash] of Object.entries(await filesAt(directory))) compilerInputsBefore[resolve(directory, path)] = hash;
  }
  report.toolchain = { node: { version: process.version, path: process.execPath, hash: sha256(await readFile(process.execPath)) }, modules, compiler, compilerHash: sha256(await readFile(compiler)), implementationHash: sha256(await readFile(resolve(modules, 'typescript/lib/_tsc.js'))), npm, npmVersion: JSON.parse(await readFile(resolve(npmRoot, 'package.json'))).version, npmFiles: manifest(await filesAt(npmRoot, true)), compilerInputsBefore: manifest(compilerInputsBefore) };
  assert.equal(report.toolchain.compilerHash, prepared.toolchain.typescript.compilerHash); assert.equal(report.toolchain.implementationHash, prepared.toolchain.typescript.implementationHash); assert.equal(sha256(await readFile(npm)), prepared.toolchain.npm.hash);
  await symlink(modules, resolve(archiveRoot, 'node_modules'));
  const build = await phase('build', process.execPath, [compiler, '-p', resolve(archiveRoot, 'tsconfig.build.json'), '--listFiles'], archiveRoot);
  await rm(resolve(archiveRoot, 'node_modules'));
  build.sourceBefore = report.sourceBefore; build.sourceAfter = await sourceGuard();
  const compilePaths = Buffer.from(build.run.stdoutHex, 'hex').toString().split('\n').filter(path => path.startsWith('/'));
  build.inputHashes = manifest(Object.fromEntries(await Promise.all(compilePaths.map(async path => {
    const actual = await realpath(path); const hash = sha256(await readFile(actual));
    assert.ok(actual.startsWith(archiveRoot + '/') || actual.startsWith(modules + '/'), 'Build alias: ' + actual);
    assert.equal(hash, actual.startsWith(archiveRoot + '/') ? sourceBefore[relative(archiveRoot, actual)] : compilerInputsBefore[actual], 'Unlisted/changed compiler input: ' + actual);
    return [path, { realpath: actual, hash }];
  }))));
  requireSuccess(build);
  const emitted = await filesAt(resolve(archiveRoot, 'dist')); report.emitted = manifest(emitted);
  const pack = await phase('pack', process.execPath, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--no-audit', '--pack-destination', packages], archiveRoot); requireSuccess(pack);
  pack.sourceAfter = await sourceGuard(); assert.deepEqual(await filesAt(resolve(archiveRoot, 'dist')), emitted);
  const packed = JSON.parse(Buffer.from(pack.run.stdoutHex, 'hex').toString()); assert.equal(packed.length, 1); assert.equal(packed[0].name, packageJson.name);
  report.npmPack = packed[0]; assert.equal(packed[0].filename, 'virtual-bash-0.0.0.tgz');
  const tgz = await readFile(resolve(packages, packed[0].filename)); report.tarball = { sha256: sha256(tgz), size: tgz.length, integrity: 'sha512-' + createHash('sha512').update(tgz).digest('base64'), shasum: createHash('sha1').update(tgz).digest('hex') };
  assert.equal(report.tarball.integrity, packed[0].integrity); assert.equal(report.tarball.shasum, packed[0].shasum);
  save('packed-core-84ab66c-tarball.json', { candidate, ...report.tarball, encoding: 'base64', data: tgz.toString('base64') });
  const packedTar = inspectTar(tgz, { compressed: true, prefix: 'package/' }); report.tarEntries = manifest(packedTar.entries);
  const packedHashes = Object.fromEntries(Object.entries(packedTar.files).map(([name, file]) => [name.slice('package/'.length), file.sha256]));
  for (const [name, hash] of Object.entries(packedHashes)) assert.equal(hash, name.startsWith('dist/') ? emitted[name.slice(5)] : sourceBefore[name], 'Packed bytes not from exact archive: ' + name);
  assert.equal(packedHashes['package.json'], sourceBefore['package.json']);
  assert.deepEqual(Object.keys(packedHashes).sort(), packed[0].files.map(entry => entry.path).sort());
  assert.deepEqual(Object.keys(packedHashes).filter(name => name.startsWith('dist/')).map(name => name.slice(5)).sort(), Object.keys(emitted).sort());
  report.packedFiles = manifest(packedHashes);
  await writeFile(resolve(consumerRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
  const install = await phase('install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', '--save=false', resolve(packages, packed[0].filename)], consumerRoot); requireSuccess(install);
  const installed = resolve(consumerRoot, 'node_modules/virtual-bash'); assert.equal((await lstat(installed)).isSymbolicLink(), false); assert.equal(await realpath(installed), installed);
  report.installedRoot = installed; report.installedBefore = manifest(await filesAt(installed)); assert.deepEqual(report.manifests[report.installedBefore], packedHashes);
  const packageNames = (await readdir(resolve(consumerRoot, 'node_modules'))).filter(name => name !== '.package-lock.json'); assert.deepEqual(packageNames, ['virtual-bash']); report.installedPackageNames = packageNames;
  for (const name of ['consumer.mjs', 'cases.mjs', 'packed-public-types.ts']) await writeFile(resolve(consumerRoot, name), await readFile(resolve(owned, name)));
  const typeArgs = [compiler, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--types', 'node', '--typeRoots', resolve(modules, '@types'), '--listFiles', resolve(consumerRoot, 'packed-public-types.ts')];
  const types = await phase('public-types', process.execPath, typeArgs, consumerRoot);
  const typePaths = Buffer.from(types.run.stdoutHex, 'hex').toString().split('\n').filter(path => path.startsWith('/'));
  types.inputHashes = manifest(Object.fromEntries(await Promise.all(typePaths.map(async path => {
    const actual = await realpath(path); const hash = sha256(await readFile(actual));
    assert.ok(actual.startsWith(consumerRoot + '/') || actual.startsWith(modules + '/'), 'Type alias: ' + actual);
    const expected = actual.startsWith(installed + '/') ? packedHashes[relative(installed, actual)] : actual === resolve(consumerRoot, 'packed-public-types.ts') ? sha256(await readFile(resolve(owned, 'packed-public-types.ts'))) : compilerInputsBefore[actual];
    assert.equal(hash, expected, 'Unlisted/changed public type input: ' + actual); return [path, { realpath: actual, hash }];
  }))));
  assert.ok(typePaths.includes(resolve(installed, 'dist/index.d.ts')) && typePaths.includes(resolve(installed, 'dist/contracts/index.d.ts')), 'Actual public declarations required');
  types.guardValid = true;
  for (const fixture of [...nativeCases, ...hostCases]) {
    const before = manifest(await filesAt(installed)); assert.equal(before, report.installedBefore);
    const sourceBeforeRun = await sourceGuard();
    const captured = await phase('consumer:' + fixture.id, process.execPath, ['--unhandled-rejections=strict', resolve(consumerRoot, 'consumer.mjs'), fixture.id], consumerRoot, { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CONSUMER_PACKAGE_ROOT: installed });
    let actual; try { actual = JSON.parse(Buffer.from(captured.run.stdoutHex, 'hex').toString()); } catch (error) { actual = { protocolFailure: error.message }; }
    const after = manifest(await filesAt(installed)); const sourceAfterRun = await sourceGuard();
    const mismatches = Object.entries(actual.loaded ?? {}).filter(([name, hash]) => packedHashes[name] !== hash);
    const valid = captured.run.status === 0 && captured.run.stderrHex === '' && before === after && sourceBeforeRun === sourceAfterRun && !mismatches.length && !!actual.loaded?.['dist/index.js'] && !!actual.loaded?.['dist/commands/env-split.js'] && actual.forbidden?.length === 0 && actual.observations?.length === (fixture.variants?.length ?? 1);
    const row = { id: fixture.id, kind: fixture.kind ?? 'native', before, after, sourceBefore: sourceBeforeRun, sourceAfter: sourceAfterRun, loaded: manifest(actual.loaded ?? {}), valid, mismatches, actual };
    if (!fixture.kind) {
      row.profiles = native.profiles.map(profile => ({ role: profile.role, pass: valid && !actual.observations?.[0]?.error && actual.observations?.[0]?.passed !== false && isDeepStrictEqual(actual.observations?.[0]?.tuple, profile.rows.find(entry => entry.id === fixture.id).tuple) }));
      if (fixture.policyExpected) row.policyPass = valid && !actual.observations?.[0]?.error && isDeepStrictEqual(actual.observations?.[0]?.tuple, fixture.policyExpected);
    } else row.hostPassed = valid ? actual.observations.filter(observation => observation.passed === true).length : 0;
    report.product.push(row);
  }
  report.sourceAfter = await sourceGuard(); report.emittedAfter = manifest(await filesAt(resolve(archiveRoot, 'dist'))); assert.equal(report.emittedAfter, report.emitted);
  report.installedAfter = manifest(await filesAt(installed)); assert.equal(report.installedAfter, report.installedBefore);
  report.npmAfter = manifest(await filesAt(npmRoot, true)); assert.equal(report.npmAfter, report.toolchain.npmFiles);
  report.compilerInputsAfter = manifest(Object.fromEntries(await Promise.all(Object.keys(compilerInputsBefore).map(async path => [path, sha256(await readFile(path))])))); assert.equal(report.compilerInputsAfter, report.toolchain.compilerInputsBefore);
  report.summary = { native: native.profiles.map(profile => ({ role: profile.role, total: nativeCases.length, passed: report.product.filter(row => row.profiles?.find(item => item.role === profile.role)?.pass).length })), host: { cases: hostCases.length, executions: 5, passed: report.product.reduce((sum, row) => sum + (row.hostPassed ?? 0), 0) }, policy: report.product.filter(row => 'policyPass' in row).map(row => ({ id: row.id, pass: row.policyPass })), validRows: report.product.filter(row => row.valid).length, rowProcesses: report.product.length, typecheck: types.run.status };
  report.completed = true;
} catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  report.frozenAfter = manifest(Object.fromEntries(await Promise.all(Object.keys(report.manifests[report.frozenInputs] ?? {}).map(async path => [path, sha256(await readFile(resolve(root, path)))]))));
  report.frozenUnchanged = report.frozenAfter === report.frozenInputs;
  report.finished = new Date().toISOString();
  report.children = report.phases.map(phase => { let alive = false; try { process.kill(-phase.run.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; } return { phase: phase.id, pid: phase.run.pid, alive }; });
  save(output, report);
  await rm(scratch, { recursive: true, force: true });
  save('packed-core-84ab66c-cleanup.json', { at: new Date().toISOString(), candidate, evidenceHash: sha256(await readFile(resolve(owned, output))), scratch, absent: await access(scratch).then(() => false, error => error.code === 'ENOENT'), children: report.children });
}
console.log(JSON.stringify({ completed: report.completed ?? false, failure: report.failure, summary: report.summary, phases: report.phases.map(phase => [phase.id, phase.run.status]) }));
