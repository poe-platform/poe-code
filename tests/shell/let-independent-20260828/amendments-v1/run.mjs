import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertTree, copyRegular, git, hash, inventory, json, packInventory, save } from '../execution-prep-v1/artifacts.mjs';
import { classify, supervise } from '../execution-prep-v1/protocol.mjs';
import { checkTypes } from '../execution-prep-v1/types.mjs';
import { checkApiDiagnostic } from '../candidate-review-v2/type-amendment.mjs';

const revision = dirname(fileURLToPath(import.meta.url)), owned = dirname(revision), scope = join(owned, 'execution-prep-v1'), repository = resolve(owned, '../../..');
const options = Object.fromEntries(process.argv.slice(2).map(value => { const match = /^--([a-z0-9-]+)=(.+)$/u.exec(value); if (!match) throw new Error('named --key=value admission required'); return [match[1], match[2]]; }));
assert.equal(Object.keys(options).length, process.argv.slice(2).length, 'duplicate admission option');
if (!['candidate', 'runtime-sha256', 'preseal', 'label'].every(key => options[key])) { process.stderr.write('REFUSED78: explicit root-authorized --candidate=SHA --runtime-sha256=SHA256 --preseal=SHA --label=NAME required; no product execution\n'); process.exit(78); }
for (const key of Object.keys(options)) assert.ok(['candidate', 'runtime-sha256', 'preseal', 'label', 'mutants', 'mutants-sha256', 'mutant-preseal'].includes(key));
assert.match(options.candidate, /^[a-f0-9]{40}$/u); assert.match(options.preseal, /^[a-f0-9]{40}$/u); assert.match(options['runtime-sha256'], /^[a-f0-9]{64}$/u); assert.match(options.label, /^[a-z0-9-]{1,50}$/u);
const bindings = json(join(owned, 'BINDINGS.json')), originalSeal = json(join(owned, 'SEAL.json')), seal = json(join(scope, 'SEAL.json')), tools = json(join(scope, 'TOOLS.json'));
const frozenFiles = { ...Object.fromEntries(Object.keys(originalSeal).map(name => [name, originalSeal[name]])), 'SEAL.json': hash(readFileSync(join(owned, 'SEAL.json'))), ...Object.fromEntries(Object.entries(seal).map(([name, digest]) => [`execution-prep-v1/${name}`, digest])), 'execution-prep-v1/SEAL.json': hash(readFileSync(join(scope, 'SEAL.json'))) };
for (const [name, digest] of Object.entries(frozenFiles)) {
  assert.equal(hash(readFileSync(join(owned, name))), digest, name);
  assert.equal(hash(git(repository, ['show', `${options.preseal}:${relative(repository, join(owned, name))}`])), digest, `committed preseal ${name}`);
}
assert.equal(realpathSync(process.execPath), tools.node.path); assert.equal(hash(readFileSync(process.execPath)), tools.node.sha256);
function checkTools() { for (const item of tools.trees) assert.deepEqual(inventory(item.path), item.files, item.path); for (const item of [tools.node, tools.patch]) assert.equal(hash(readFileSync(item.path)), item.sha256); }
checkTools();
for (const [name, digest] of Object.entries(json(join(owned, 'candidate-review-v1/SEAL.json')))) {
  assert.equal(hash(readFileSync(join(owned, 'candidate-review-v1', name))), digest);
  assert.equal(hash(git(repository, ['show', '4b94b827fce7d7efc62a4ce52c5a69c1e4cae46a:' + relative(repository, join(owned, 'candidate-review-v1', name))])), digest);
  frozenFiles['candidate-review-v1/' + name] = digest;
}
for (const [name, digest] of Object.entries(json(join(owned, 'candidate-review-v2/SEAL.json')))) {
  assert.equal(hash(readFileSync(join(owned, 'candidate-review-v2', name))), digest);
  assert.equal(hash(git(repository, ['show', 'd9a2e597184c3ce076a7b74c1d0a21098b06805b:' + relative(repository, join(owned, 'candidate-review-v2', name))])), digest);
  frozenFiles['candidate-review-v2/' + name] = digest;
}
const revisionSeal = json(join(revision, 'SEAL.json'));
for (const [name, digest] of Object.entries(revisionSeal)) {
  assert.equal(hash(readFileSync(join(revision, name))), digest);
  assert.equal(hash(git(repository, ['show', options['mutant-preseal'] + ':' + relative(repository, join(revision, name))])), digest);
  frozenFiles['amendments-v1/' + name] = digest;
}
frozenFiles['amendments-v1/SEAL.json'] = hash(readFileSync(join(revision, 'SEAL.json')));
const runtimePath = 'src/shell/runtime.ts';
const candidateRuntime = git(repository, ['show', `${options.candidate}:${runtimePath}`]);
assert.equal(hash(candidateRuntime), options['runtime-sha256']);
const changedProduction = git(repository, ['diff-tree', '--no-commit-id', '--name-only', '-r', options.candidate, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');
assert.deepEqual(changedProduction, [runtimePath], 'candidate commit production write set must be runtime.ts only');
const runtimeBase = bindings.source.find(entry => entry.path === runtimePath);
assert.notEqual(hash(candidateRuntime), runtimeBase.sha256);
const mutantSpecs = options.mutants ? (() => { assert.match(options['mutants-sha256'] ?? '', /^[a-f0-9]{64}$/u); assert.match(options['mutant-preseal'] ?? '', /^[a-f0-9]{40}$/u); const bytes = readFileSync(options.mutants); assert.equal(hash(bytes), options['mutants-sha256']); const path = relative(repository, realpathSync(options.mutants)); assert.ok(path.startsWith(relative(repository, owned) + '/')); assert.deepEqual(bytes, git(repository, ['show', `${options['mutant-preseal']}:${path}`])); return JSON.parse(bytes); })() : [];
if (mutantSpecs.length) assert.deepEqual(mutantSpecs.map(row => row.id).sort(), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']);
const output = join(owned, `actual-${options.label}`); assert.equal(existsSync(output), false); mkdirSync(output);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'let-independent-')));
const report = { started: new Date().toISOString(), options, baseline: bindings.baseline, composition: bindings.source, runtimeBase, runtimeCandidateSha256: hash(candidateRuntime), preseal: frozenFiles, tools, phases: [], behavior: [], guards: [], mutants: [], completed: false, scratchRemoved: false, sourceContentsArchived: false };
report.typeFailures = []; report.diagnosis = []; report.typeAmendments = [];
async function preservedTypes(label, options) {
  let original;
  try { original = await checkTypes(options); }
  catch (error) { report.typeFailures.push({ label, name: error.name, message: error.message, stack: error.stack }); }
  report.typeAmendments.push({ label, result: await checkApiDiagnostic(options) });
  return original ?? null;
}
let sequence = 0;
function record(name, run) { const file = `${String(++sequence).padStart(3, '0')}-${name}.json`; save(join(output, file), run); report.phases.push({ name, file, sha256: hash(readFileSync(join(output, file))), code: run.code, signal: run.signal, failure: run.failure, groupAbsent: run.groupAbsent }); }
const home = join(scratch, 'home'); mkdirSync(home);
const env = { PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: home, TMPDIR: scratch, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', npm_config_cache: join(scratch, 'cache'), npm_config_userconfig: join(scratch, 'user.npmrc'), npm_config_globalconfig: join(scratch, 'global.npmrc'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
writeFileSync(env.npm_config_userconfig, ''); writeFileSync(env.npm_config_globalconfig, '');
async function command(name, args, cwd, wanted = 0) {
  const run = await supervise(process.execPath, args, { cwd, env, timeoutMs: 60000, maxBytes: 8 * 1024 * 1024 }); record(name, run);
  assert.equal(run.code, wanted, `${name}: ${run.stdout}\n${run.stderr}`); assert.equal(run.signal, null); assert.equal(run.failure, null); assert.equal(run.spawnError, null); assert.equal(run.groupAbsent, true); return run;
}
function materialize(label, replacement) {
  const source = join(scratch, label); mkdirSync(source); const selected = {};
  for (const entry of bindings.source) {
    const original = git(repository, ['show', `${entry.revision}:${entry.path}`]); assert.equal(hash(original), entry.sha256);
    const bytes = entry.path === runtimePath ? replacement : original;
    const target = join(source, entry.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' }); selected[entry.path] = hash(bytes);
  }
  for (const tree of tools.trees.filter(item => item.role === 'compiler')) copyRegular(tree.path, join(source, 'node_modules', tree.name));
  return { source, selected };
}
const packageFiles = root => ({ ...Object.fromEntries(['package.json', 'README.md'].map(name => { const path = join(root, name), stat = lstatSync(path); assert.ok(stat.isFile()); return [name, { sha256: hash(readFileSync(path)), bytes: stat.size, mode: stat.mode & 0o777 }]; })), ...Object.fromEntries(Object.entries(inventory(join(root, 'dist'))).map(([name, entry]) => [`dist/${name}`, entry])) });
async function build(project, label) {
  await command(`${label}-build`, [join(project.source, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], project.source);
  for (const [name, digest] of Object.entries(project.selected)) assert.equal(hash(readFileSync(join(project.source, name))), digest);
  return packageFiles(project.source);
}
function harnessAt(consumer) {
  const root = join(consumer, 'harness'); mkdirSync(root, { recursive: true });
  for (const name of Object.keys(frozenFiles)) { const target = join(root, name); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(owned, name), target); }
  return root;
}
function admission(packageRoot, consumer, layout, ids, label) {
  const harnessRoot = existsSync(join(consumer, 'harness')) ? join(consumer, 'harness') : harnessAt(consumer);
  const files = Object.fromEntries(Object.entries(packageFiles(packageRoot)).map(([name, entry]) => [name, entry.sha256]));
  const value = { kind: 'let-independent-loaded-candidate-v1', baseline: bindings.baseline, candidate: options.candidate, layout, packageRoot, harnessRoot, nodeSha256: tools.node.sha256, files, harnessFiles: frozenFiles, holdouts: originalSeal, ...(ids ? { caseIds: ids } : {}) };
  const path = join(consumer, `${label}-manifest.json`); save(path, value); return { path, digest: hash(readFileSync(path)), value };
}
async function body(name, admitted, kind, ids, mutation) {
  const entry = kind === 'amendment' ? '../amendments-v1/worker.mjs' : kind === 'diagnosis' ? '../candidate-review-v1/diagnosis-worker.mjs' : kind === 'literal' ? 'literal-entry.mjs' : kind === 'synthetic' ? 'synthetic-worker.mjs' : 'probe-worker.mjs';
  const harness = admitted.value.harnessRoot;
  const args = ['--permission', ...[admitted.value.packageRoot, dirname(harness), process.execPath].map(path => `--allow-fs-read=${path}`), '--import', join(harness, 'execution-prep-v1/load-guard.mjs'), join(harness, 'execution-prep-v1', entry), admitted.path, admitted.digest, ...(kind === 'synthetic' ? [ids[0]] : [])];
  const run = await supervise(process.execPath, args, { cwd: dirname(harness), env: { ...env, LET_MANIFEST: admitted.path, LET_MANIFEST_SHA256: admitted.digest } }); record(name, run);
  const classification = classify(run, ids, { modulePath: join(admitted.value.packageRoot, 'dist/shell/runtime.js'), moduleSha256: admitted.value.files['dist/shell/runtime.js'], ...(mutation ?? {}) });
  return { name, ...classification };
}
async function admissionControls(base, source) {
  for (const control of ['manifest-digest', 'changed-runtime', 'missing-root', 'changed-declaration', 'wrong-resolution', 'source-fallback', 'source-read-fence']) {
    const consumer = join(scratch, `guard-${control}`); mkdirSync(consumer); writeFileSync(join(consumer, 'package.json'), '{"type":"module","private":true}');
    const target = join(consumer, 'node_modules/virtual-bash'); copyRegular(base, target);
    const admitted = admission(target, consumer, 'moved', ['A0'], 'guard');
    if (control === 'changed-runtime') writeFileSync(join(target, 'dist/shell/runtime.js'), readFileSync(join(target, 'dist/shell/runtime.js'), 'utf8') + '\n');
    if (control === 'missing-root') unlinkSync(join(target, 'dist/index.js'));
    if (control === 'changed-declaration') writeFileSync(join(target, 'dist/index.d.ts'), readFileSync(join(target, 'dist/index.d.ts'), 'utf8') + '\n');
    if (control === 'wrong-resolution') {
      const intended = join(consumer, 'intended'); copyRegular(base, intended); admitted.value.packageRoot = intended;
      writeFileSync(admitted.path, JSON.stringify(admitted.value)); admitted.digest = hash(readFileSync(admitted.path));
    }
    const expectedDigest = control === 'manifest-digest' ? '0'.repeat(64) : admitted.digest;
    const args = ['--permission', ...[consumer, process.execPath].map(path => `--allow-fs-read=${path}`), '--import', join(admitted.value.harnessRoot, 'execution-prep-v1/load-guard.mjs'), join(admitted.value.harnessRoot, 'execution-prep-v1/probe-worker.mjs'), admitted.path, expectedDigest, ...(control === 'source-fallback' ? ['fallback'] : control === 'source-read-fence' ? ['read-fence'] : [])];
    const run = await supervise(process.execPath, args, { cwd: consumer, env: { ...env, LET_MANIFEST: admitted.path, LET_MANIFEST_SHA256: expectedDigest, LET_FORBIDDEN_SOURCE: pathToFileURL(join(source, 'dist/index.js')).href } }); record(`guard-${control}`, run);
    const expectedText = { 'manifest-digest': /manifest SHA256/u, 'changed-runtime': /dist\/shell\/runtime\.js/u, 'missing-root': /ENOENT.*dist\/index\.js/su, 'changed-declaration': /dist\/index\.d\.ts/u, 'wrong-resolution': /intended\/dist\/index\.js/u, 'source-fallback': /unbound module/u, 'source-read-fence': /ERR_ACCESS_DENIED/u }[control];
    const exactSource = !control.startsWith('source-') || run.stderr.includes(join(source, 'dist/index.js'));
    const denied = run.code === 1 && run.signal === null && !run.failure && !run.spawnError && run.groupAbsent && expectedText.test(run.stderr) && exactSource && !run.stdout.includes('"observation"');
    report.guards.push({ control, denied });
  }
}
try {
  const carry = json(join(revision, 'CARRY.json'));
  for (const [name, digest] of Object.entries(carry.files)) {
    assert.equal(hash(readFileSync(join(owned, name))), digest);
    assert.equal(hash(git(repository, ['show', carry.revision + ':' + relative(repository, join(owned, name))])), digest);
  }
  const prior = json(join(owned, 'actual-frozen-02/REPORT.json'));
  assert.equal(prior.completed, true); assert.equal(prior.scratchRemoved, true);
  assert.deepEqual(prior.behavior.filter(row => !row.accepted).map(row => [row.name, row.failed]), [['source-literal', ['P39', 'P58']], ['source-S26', ['S26']], ['moved-literal', ['P39', 'P58']], ['moved-S26', ['S26']]]);
  assert.ok(prior.behavior.every(row => row.coherent)); assert.ok(prior.guards.every(row => row.denied));
  assert.ok(prior.mutants.filter(row => row.id !== 'M3').every(row => row.killed)); assert.equal(prior.mutants.find(row => row.id === 'M3').killed, false);
  const candidate = materialize('source', candidateRuntime), emitted = await build(candidate, 'candidate');
  assert.deepEqual(emitted, prior.candidateEmitted); report.candidateEmitted = emitted; report.sourceSelected = candidate.selected;
  let stripped = candidateRuntime.toString(); const start = stripped.indexOf('  private async letBuiltin('), end = stripped.indexOf('  private async getoptsBuiltin(', start);
  assert.ok(start > 0 && end > start); stripped = stripped.slice(0, start) + stripped.slice(end);
  stripped = stripped.replace('"eval", "getopts", "let",', '"eval", "getopts",').replace('    if (command === "let") return this.letBuiltin(context, state);\n', '');
  assert.deepEqual(Buffer.from(stripped), git(repository, ['show', bindings.cd + ':' + runtimePath]));
  report.strippedExactlyAcceptedCD = { revision: bindings.cd, sha256: hash(stripped) };
  const ids = ['P39-v2', 'U01-default-unset', 'S26-v2'];
  const sourceConsumer = join(scratch, 'source-consumer'); mkdirSync(sourceConsumer); writeFileSync(join(sourceConsumer, 'package.json'), '{"type":"module","private":true}');
  const sourceAdmission = admission(candidate.source, sourceConsumer, 'source', ids, 'source');
  report.behavior.push(await body('source-amendments', sourceAdmission, 'amendment', ids));
  const sourcePositive = admission(candidate.source, sourceConsumer, 'source', ['P21'], 'source-P21');
  report.behavior.push(await body('source-P21-positive', sourcePositive, 'literal', ['P21']));
  const stage = join(scratch, 'pack-stage'); mkdirSync(stage); copyRegular(join(candidate.source, 'dist'), join(stage, 'dist'));
  for (const name of ['package.json', 'README.md']) copyFileSync(join(candidate.source, name), join(stage, name));
  assertTree(stage, emitted); const packed = join(scratch, 'pack'); mkdirSync(packed);
  const npm = join(tools.trees.find(tree => tree.role === 'npm').path, 'bin/npm-cli.js');
  const packRun = await command('pack', [npm, 'pack', '--json', '--offline', '--ignore-scripts', '--pack-destination', packed], stage);
  const metadata = JSON.parse(packRun.stdout); assert.equal(metadata.length, 1); assert.equal(metadata[0].entryCount, 846);
  const tarball = join(packed, metadata[0].filename), packBytes = readFileSync(tarball); assert.deepEqual(packInventory(packBytes), emitted); assert.equal(hash(packBytes), prior.pack.sha256);
  const packageJson = json(join(stage, 'package.json')); assert.equal(Object.keys(packageJson.dependencies ?? {}).length, 0); assert.equal(Object.keys(packageJson.optionalDependencies ?? {}).length, 0);
  report.pack = { sha256: hash(packBytes), entries: 846, metadata: metadata[0], sameAsFrozenIndependentRun: true }; copyFileSync(tarball, join(output, 'virtual-bash-0.0.0.tgz'));
  const installed = join(scratch, 'installed'); mkdirSync(installed); writeFileSync(join(installed, 'package.json'), '{"type":"module","private":true}');
  await command('offline-install', [npm, 'install', tarball, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], installed);
  assertTree(join(installed, 'node_modules/virtual-bash'), emitted);
  const installedAdmission = admission(join(installed, 'node_modules/virtual-bash'), installed, 'moved', ids, 'installed');
  report.behavior.push(await body('installed-amendments', installedAdmission, 'amendment', ids));
  const moved = join(scratch, 'physically moved'); renameSync(installed, moved); assert.equal(existsSync(installed), false); assertTree(join(moved, 'node_modules/virtual-bash'), emitted);
  report.abandonedInstalledPathAbsent = true;
  const movedAdmission = admission(join(moved, 'node_modules/virtual-bash'), moved, 'moved', ids, 'moved');
  report.behavior.push(await body('moved-amendments', movedAdmission, 'amendment', ids));
  const movedPositive = admission(movedAdmission.value.packageRoot, moved, 'moved', ['P21'], 'moved-P21');
  report.behavior.push(await body('moved-P21-positive', movedPositive, 'literal', ['P21']));
  const mutant = mutantSpecs.find(row => row.id === 'M3');
  assert.equal(mutant.candidateSha256, hash(candidateRuntime)); assert.equal(candidateRuntime.toString().split(mutant.needle).length - 1, 1);
  const mutantSource = materialize('M3-v2', candidateRuntime);
  const patch = '*** Begin Patch\n*** Update File: ' + join(mutantSource.source, runtimePath) + '\n@@\n' + mutant.needle.split('\n').map(line => '-' + line).join('\n') + '\n' + mutant.replacement.split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch';
  execFileSync(tools.patch.path, [patch], { cwd: mutantSource.source, timeout: 30000 });
  assert.equal(hash(readFileSync(join(mutantSource.source, runtimePath))), mutant.resultSha256); mutantSource.selected[runtimePath] = mutant.resultSha256;
  const mutantEmitted = await build(mutantSource, 'M3-v2');
  for (const [name, entry] of Object.entries(emitted)) if (!name.startsWith('dist/shell/runtime.')) assert.deepEqual(mutantEmitted[name], entry);
  const mutantConsumer = join(scratch, 'mutant-consumer'); mkdirSync(mutantConsumer);
  const mutantAdmission = admission(mutantSource.source, mutantConsumer, 'mechanism-mutant', ['P21'], 'M3-v2');
  const killed = await body('M3-v2-P21', mutantAdmission, 'literal', ['P21'], { mutantId: 'M3-v2', requiredFailed: ['P21'] });
  report.mutants.push(killed); assert.equal(killed.mutantKilled, true); assert.equal(killed.observations[0].result.stdout, '1:0:0\n');
  const restored = materialize('restored', candidateRuntime); assert.deepEqual(await build(restored, 'restored'), emitted);
  const restoredConsumer = join(scratch, 'restored-consumer'); mkdirSync(restoredConsumer);
  const restoredAdmission = admission(restored.source, restoredConsumer, 'source', ['P21'], 'restored');
  report.behavior.push(await body('restored-P21-positive', restoredAdmission, 'literal', ['P21']));
  assertTree(movedAdmission.value.packageRoot, emitted);
  for (const [name, digest] of Object.entries(candidate.selected)) assert.equal(hash(readFileSync(join(candidate.source, name))), digest);
  checkTools(); for (const [name, digest] of Object.entries(frozenFiles)) assert.equal(hash(readFileSync(join(owned, name))), digest);
  report.carry = carry; report.originalCohortAccepted = false;
  report.accepted = report.behavior.every(row => row.accepted) && killed.mutantKilled;
  report.completed = true;
} catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack }; }
finally { rmSync(scratch, { recursive: true, force: true }); report.scratchRemoved = !existsSync(scratch); report.finished = new Date().toISOString(); save(join(output, 'REPORT.json'), report); }
process.stdout.write(JSON.stringify({ completed: report.completed, accepted: report.accepted === true, result: output, originalCohortAccepted: false, failures: report.behavior.filter(row => !row.accepted).map(row => ({ name: row.name, failed: row.failed, errors: row.errors })), failure: report.failure?.message }) + '\n');
if (!report.accepted) process.exitCode = 1;
