import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assessCommittedRevision, verifyFreshCommittedArchive } from '../combined-8670ebe8/committed-archive.mjs';
import { stageNative, verifyNativeStaging } from '../preflight-repair/preflight.mjs';
import { isolatedHistory } from '../history.mjs';
import { supervise } from '../supervise.mjs';
import { inspectRuntime, probeGuardedRuntime, requireMatchingLauncher } from '../runtime-profile-20260827/profile.mjs';

const runtime = inspectRuntime();
if (!runtime.supported) { console.log(JSON.stringify({ runtime, suiteLaunched: false })); process.exit(78); }
requireMatchingLauncher(runtime);

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const candidate = '8670ebe8f0d39966c2de2638780437398e5f8490';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const policy = JSON.parse(readFileSync(new URL('../combined-8670ebe8/policy.json', import.meta.url)));
const admission = assessCommittedRevision({ repository, candidate, profile: policy });
assert.deepEqual(admission.issues, []);
assert.equal(admission.native.assets.length, 49);
const output = resolve(process.argv[2] ?? '');
assert.ok(process.argv.length === 3 && output.startsWith('/tmp/safe-bash-package-8670-') && !existsSync(output));
mkdirSync(output);
const temporary = realpathSync(mkdtempSync('/tmp/safe-bash-package-execution-'));
const source = join(temporary, 'source'), consumer = join(temporary, 'consumer');
for (const directory of [source, consumer, join(temporary, 'home'), join(temporary, 'tmp'), join(temporary, 'native')]) mkdirSync(directory);
const environment = { PATH: dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin', HOME: join(temporary, 'home'), TMPDIR: join(temporary, 'tmp'), TMP: join(temporary, 'tmp'), TEMP: join(temporary, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0', TSX_DISABLE_CACHE: '1', npm_config_cache: join(temporary, 'npm-cache'), npm_config_userconfig: join(temporary, 'npmrc'), npm_config_globalconfig: join(temporary, 'global-npmrc'), npm_config_registry: 'http://127.0.0.1:1', npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
const npmPath = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim());
const npmRoot = resolve(dirname(npmPath), '..');
writeFileSync(environment.npm_config_userconfig, ''); writeFileSync(environment.npm_config_globalconfig, '');
const report = { candidate, startedAt: new Date().toISOString(), temporary, source, consumer, scope: 'SEPARATE8670 runtime-consumer/package cohort; no canonical tests or private engine; not completion or rescoring of attempt v4', admission: { assets: admission.native.assets, scopeInputs: policy.scopeInputs.length }, phases: [], sourceChanges: [], fallbackControls: [] };
report.runtime = runtime;
report.npm = { executable: npmPath, sha256: hash(readFileSync(npmPath)), version: execFileSync(process.execPath, [npmPath, '--version'], { encoding: 'utf8', env: environment }).trim() };
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
let bound;
function verifyTracked() {
  const changes = [];
  for (const [path, expected] of Object.entries(bound.files)) {
    const file = join(source, path), stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() !== expected.symlink || (stat.mode & 0o777) !== expected.mode || hash(expected.symlink ? Buffer.from(readlinkSync(file)) : readFileSync(file)) !== expected.sha256) changes.push(path);
  }
  return changes;
}
function manifest(directory) {
  const files = [];
  function walk(prefix = '') {
    for (const name of readdirSync(join(directory, prefix)).sort()) {
      const local = prefix ? prefix + '/' + name : name, file = join(directory, local), stat = lstatSync(file);
      assert.equal(stat.isSymbolicLink(), false, file);
      if (stat.isDirectory()) walk(local);
      else { assert.ok(stat.isFile()); files.push({ path: local, bytes: stat.size, sha256: hash(readFileSync(file)) }); }
    }
  }
  walk(); return files;
}

function copyDependencies(origin, destination) {
  const files = {}, skippedBins = [];
  const visit = directory => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), local = relative(origin, path), info = lstatSync(path);
      if (name === ".bin") { skippedBins.push(local); continue; }
      assert.equal(info.isSymbolicLink(), false, `Dependency source link needs explicit review: ${path}`);
      if (info.isDirectory()) visit(path);
      else {
        assert.ok(info.isFile()); const bytes = readFileSync(path), target = join(destination, local);
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); chmodSync(target, info.mode & 0o777);
        assert.notEqual(lstatSync(target).ino, info.ino); assert.equal(lstatSync(target).nlink, 1);
        files[local] = { sha256: hash(bytes), bytes: bytes.length, mode: info.mode & 0o777 };
      }
    }
  };
  visit(origin);
  const bins = {};
  for (const directory of skippedBins) for (const name of readdirSync(join(origin, directory))) {
    const local = join(directory, name), original = join(origin, local), bin = join(destination, local), info = lstatSync(original);
    mkdirSync(dirname(bin), { recursive: true });
    if (info.isSymbolicLink()) {
      const target = realpathSync(original); assert.ok(target.startsWith(origin + "/"), `External binary link: ${original}`);
      const targetRelative = relative(origin, target), installed = join(destination, targetRelative); assert.ok(existsSync(installed));
      writeFileSync(bin, "#!/bin/sh\nexec " + quote(installed) + ' "$@"\n'); chmodSync(bin, 0o755);
      bins[local] = { sourceKind: "link", targetRelative, sha256: hash(readFileSync(bin)), mode: 0o755 };
    } else {
      assert.ok(info.isFile()); copyFileSync(original, bin); chmodSync(bin, info.mode & 0o777);
      bins[local] = { sourceKind: "regular", sha256: hash(readFileSync(bin)), mode: info.mode & 0o777 };
    }
  }
  return { origin, destination, files, bins, binPolicy: "Regular wrappers preserve the exact installed .bin link target; no symlink is reused and no manifest-based bin selection is invented" };
}
async function phase(label, executable, args, cwd = source, expectedStatus = 0) {
  const env = { ...environment, FULL_GATE_IMPORTS: join(output, 'imports', label) };
  const selectedExecutable = executable === 'npm' ? process.execPath : executable;
  const selectedArgs = executable === 'npm' ? [npmPath, ...args] : args;
  const result = await supervise(selectedExecutable, selectedArgs, { cwd, env, timeoutMs: 240000, stdout: join(output, label + '.stdout.log'), stderr: join(output, label + '.stderr.log'), observeSockets: true });
  result.observedNodeCommands = result.observed.map(entry => entry.command).filter(command => /^(?:\S+\/)?node(?:\s|$)/u.test(command));
  result.mixedNodeExecutables = result.observedNodeCommands.map(command => command.split(/\s+/u)[0]).filter(path => path.startsWith('/') && realpathSync(path) !== runtime.identity.path);
  result.label = label; result.expectedStatus = expectedStatus; result.sourceChanges = verifyTracked();
  report.phases.push(result); save(label + '.result.json', result); save('report.json', report);
  assert.deepEqual(result.sourceChanges, [], 'Tracked candidate changed during ' + label);
  assert.equal(result.clean, true, 'Unclean owned processes during ' + label);
  assert.deepEqual(result.mixedNodeExecutables, [], 'Observed mixed Node runtime during ' + label);
  return result;
}
try {
  const archive = join(temporary, 'source.tar');
  execFileSync('git', ['--no-replace-objects', 'archive', '--output', archive, candidate], { cwd: repository, timeout: 120000 });
  report.archiveSha256 = hash(readFileSync(archive));
  execFileSync('/usr/bin/tar', ['-xf', archive, '-C', source], { timeout: 120000 });
  bound = verifyFreshCommittedArchive(source, admission.entries);
  report.archive = { candidate, tree: execFileSync('git', ['rev-parse', candidate + '^{tree}'], { cwd: repository, encoding: 'utf8' }).trim(), count: bound.count, manifestSha256: hash(JSON.stringify(bound.files)) };
  save('archive-inputs.json', bound);
  report.history = await isolatedHistory(repository, source, candidate, join(temporary, 'history.pack'), environment);
  report.dependencies = copyDependencies(join(repository, 'node_modules'), join(source, 'node_modules'));
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json')));
  for (const [path, expected] of Object.entries(lock.packages).filter(([path]) => path)) {
    const filename = join(source, path, 'package.json');
    if (expected.optional && !existsSync(filename)) continue;
    assert.equal(JSON.parse(readFileSync(filename)).version, expected.version, 'Cached dependency version: ' + path);
  }
  report.native = stageNative(admission, { snapshot: source, nativeRoot: join(temporary, 'native'), environment });
  verifyNativeStaging(report.native);
  const harness = join(temporary, 'harness'); mkdirSync(harness);
  const guard = join(harness, 'import-guard.mjs');
  writeFileSync(guard, execFileSync('git', ['show', '6699804a:tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'], { cwd: repository }));
  const expectedSource = Object.fromEntries(['src/commands/execution.ts', 'src/commands/env-split.ts'].map(path => [path, bound.files[path].sha256]));
  report.runtimeProbe = probeGuardedRuntime({ executable: process.execPath, root: temporary, source, harness, guard, expectedSource, environment });
  save('runtime-probe.json', report.runtimeProbe);
  if (report.runtimeProbe.status !== 0) { const error = new Error('Guarded runtime feature probe refused before package tests'); error.exitCode = 78; throw error; }
  Object.assign(environment, report.runtimeProbe.environment, { FULL_GATE_TOOL_ROOTS: JSON.stringify([npmRoot]) });
  report.bindingBefore = Object.fromEntries(['package.json', 'package-lock.json', 'src/index.ts', 'src/plugins/index.ts'].map(path => [path, bound.files[path]]));
  console.log(JSON.stringify({ phase: 'fresh-package-cohort-admitted', ...report.archive, binding: report.bindingBefore, nativeAssets: admission.native.assets.length, noCanonicalExecution: true }));
  const consumers = await phase('current-consumers', process.execPath, ['scripts/verify-current-consumers.mjs', '--source-commit', candidate]);
  const receipt = readFileSync(join(output, 'current-consumers.stdout.log'), 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).find(row => row.directory && row.sourceCommit === candidate);
  assert.ok(receipt);
  assert.ok(receipt.directory.startsWith(join(source, 'tests/plugins/qualified-current-release/.runs') + '/'));
  const consumerReport = JSON.parse(readFileSync(join(receipt.directory, 'result.json')));
  assert.equal(consumerReport.sourceCommit, candidate);
  assert.equal(consumerReport.sourceUnchanged, true);
  assert.equal(consumerReport.testsUnchanged, true);
  assert.equal(consumerReport.rootDistUnchanged, true);
  for (const entry of consumerReport.sources) assert.equal(bound.files[entry.path]?.sha256, entry.sha256, 'Nested current-consumer source binding: ' + entry.path);
  report.currentConsumers = consumerReport.currentConsumers;
  report.currentConsumersStatus = consumers.status;
  const captures = join(output, 'current-consumers'); mkdirSync(captures);
  for (const name of readdirSync(receipt.directory).filter(name => name.endsWith('.json'))) copyFileSync(join(receipt.directory, name), join(captures, name));
  const built = manifest(join(consumerReport.root, 'dist'));
  assert.ok(built.length > 0);
  assert.equal(existsSync(join(source, 'dist')), false);
  cpSync(join(consumerReport.root, 'dist'), join(source, 'dist'), { recursive: true });
  assert.deepEqual(manifest(join(source, 'dist')), built);
  report.buildReuse = { inputCommit: candidate, policy: 'Reuse authenticated unchanged nested-consumer build, no second build or stale live dist', files: built };
  const packed = await phase('pack', 'npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output]);
  assert.equal(packed.status, 0);
  const artifact = JSON.parse(readFileSync(join(output, 'pack.stdout.log')))[0];
  const tarball = join(output, artifact.filename); report.packageSha256 = hash(readFileSync(tarball));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'separate-8670-moved-consumer', private: true, type: 'module' }));
  const installed = await phase('install', 'npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', tarball], consumer);
  assert.equal(installed.status, 0);
  const packageRoot = join(consumer, 'node_modules/virtual-bash');
  assert.equal(existsSync(join(packageRoot, 'src')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(packageRoot, 'package.json'))).dependencies ?? {}, {});
  assert.deepEqual(manifest(join(packageRoot, 'dist')), built);
  report.packageBefore = manifest(packageRoot);
  const fixtureRoot = join(source, 'tests/integration/full-gate-20260827/combined-b494675c');
  copyFileSync(join(fixtureRoot, 'public.mjs'), join(consumer, 'public.mjs'));
  copyFileSync(join(fixtureRoot, 'consumer.mts.fixture'), join(consumer, 'consumer.mts'));
  report.publicFixtureHashes = { runtime: hash(readFileSync(join(consumer, 'public.mjs'))), types: hash(readFileSync(join(consumer, 'consumer.mts'))) };
  const publicResult = await phase('public', process.execPath, ['public.mjs'], consumer);
  if (publicResult.status === 0) report.public = JSON.parse(readFileSync(join(output, 'public.stdout.log')));
  const compiler = join(source, 'node_modules/typescript/bin/tsc');
  const typeArgs = ['--noEmit', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--skipLibCheck', 'false', '--types', 'node', '--typeRoots', join(source, 'node_modules/@types'), '--traceResolution'];
  const types = await phase('public-types', process.execPath, [compiler, ...typeArgs, 'consumer.mts'], consumer);
  assert.equal(types.status, 0);
  const bindings = await import(pathToFileURL(join(source, 'scripts/typecheck-consumers.mjs')).href);
  const binding = bindings.createBuiltPackageBinding(source);
  bindings.assertBuiltConsumerResolution(readFileSync(join(output, 'public-types.stdout.log'), 'utf8'), consumer, source, binding);
  report.publicTypesCandidateBound = true;
  writeFileSync(join(consumer, 'negative.mts'), 'import { __missing8670PublicExport } from "virtual-bash"; void __missing8670PublicExport;\n');
  const negative = await phase('public-negative-types', process.execPath, [compiler, ...typeArgs, 'negative.mts'], consumer, 2);
  assert.equal(negative.status, 2);
  const negativeText = readFileSync(join(output, 'public-negative-types.stdout.log'), 'utf8');
  assert.deepEqual([...negativeText.matchAll(/error (TS\d+):/g)].map(match => match[1]), ['TS2305']);
  assert.match(negativeText, /__missing8670PublicExport/u);
  bindings.assertBuiltConsumerResolution(negativeText, consumer, source, binding);
  report.fallbackControls.push({ name: 'missing candidate export remains exact TS2305 on authenticated candidate declarations', status: 'pass' });
  const denied = JSON.parse(readFileSync(join(receipt.directory, 'current-consumer-source-denied.json')));
  assert.equal(denied.status, 1); assert.match(denied.stderr, /ERR_ACCESS_DENIED/u);
  assert.ok(denied.stderr.includes(join(consumerReport.root, 'src/index.ts')));
  report.fallbackControls.push({ name: 'unchanged current-consumer Node permission control denies actual source read', status: 'pass', source: 'current-consumers/current-consumer-source-denied.json' });
  for (const [name, specifier, missing] of [['root', 'virtual-bash', 'dist/index.js'], ['contracts', 'virtual-bash/contracts', 'dist/contracts/index.js']]) {
    const directory = join(temporary, 'missing-' + name); mkdirSync(directory);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'missing-' + name, private: true, type: 'module' }));
    const target = join(directory, 'node_modules/virtual-bash'); cpSync(packageRoot, target, { recursive: true });
    rmSync(join(target, missing));
    const result = await phase('missing-' + name + '-fallback', process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(specifier) + ');'], directory, 1);
    assert.equal(result.status, 1); assert.match(readFileSync(join(output, 'missing-' + name + '-fallback.stderr.log'), 'utf8'), /ERR_MODULE_NOT_FOUND/u);
    report.fallbackControls.push({ name: 'missing packed ' + specifier + ' does not resolve repository source or another build', status: 'pass' });
  }
  report.packageAfter = manifest(packageRoot); assert.deepEqual(report.packageAfter, report.packageBefore);
  assert.deepEqual(manifest(join(source, 'dist')), built);
  report.sourceChanges = verifyTracked(); assert.deepEqual(report.sourceChanges, []);
  report.bindingAfter = Object.fromEntries(Object.keys(report.bindingBefore).map(path => [path, { sha256: hash(readFileSync(join(source, path))) }]));
  report.dependencyChanges = [];
  for (const [path, expected] of Object.entries({ ...report.dependencies.files, ...report.dependencies.bins })) {
    const file = join(report.dependencies.destination, path);
    if (!existsSync(file) || hash(readFileSync(file)) !== expected.sha256) report.dependencyChanges.push(path);
  }
  assert.deepEqual(report.dependencyChanges, []);
  report.status = report.phases.every(phase => phase.status === phase.expectedStatus) && report.public?.count === 70 ? 'separate-package-cohort-passed-not-whole-gate' : 'separate-package-cohort-failed';
  if (report.status.endsWith('-failed')) process.exitCode = 1;
} catch (error) {
  report.status = 'separate-package-cohort-failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = error.exitCode === 78 ? 78 : 1;
} finally {
  if (bound) report.sourceChanges = verifyTracked();
  report.sourceBindingScope = 'Exact path-set/blob/mode admission, then original tracked paths checked before/after. Generated nested consumer/build outputs are separately authenticated; no universal append-proof tree claim.';
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary);
  report.finishedAt = new Date().toISOString(); save('report.json', report);
  console.log(JSON.stringify({ candidate, status: report.status, phases: report.phases.map(({label,status})=>({label,status})), count: report.public?.count, error: report.error, sourceChanges: report.sourceChanges, temporaryRemoved: report.temporaryRemoved, output }));
}
