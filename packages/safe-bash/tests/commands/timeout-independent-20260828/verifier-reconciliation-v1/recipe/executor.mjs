import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recipe, scope, repository, work, raw, read, fileHash, sha, safe, save, write, tree, tarEntries, matchInventory } from './io.mjs';

import { assertRootMissing, assertImportDenied } from './predicates.mjs';
import { focusedControls } from './controls.mjs';

const bindings = read(join(recipe, 'BINDINGS.json'));
const closure = read(join(repository, bindings.closurePath));
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const state = { schema: 'timeout-independent-verifier-reconciliation/1', startedAt: new Date().toISOString(), recipeCommit: process.argv[2], candidate: bindings.candidate, baseline: bindings.baseline, preRunGitSynchronousNaturalReturns: Number(process.env.TIMEOUT_AUTH_GIT_RETURNS), source: null, moved: null, children: [], controls: [], guards: [], types: [], mutants: [], native: { prospective: 12, executed: 0 }, safeJS: 0, attempts: 1, retries: 0, status: 'RUNNING' };
assert.ok(!fs.existsSync(raw) && !fs.existsSync(work)); fs.mkdirSync(raw, { recursive: true }); fs.mkdirSync(work, { recursive: true });
const environment = { PATH: '/usr/bin:/bin', HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), LC_ALL: 'C', LANG: 'C', NODE_NO_WARNINGS: '1', npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'empty-npmrc'), npm_config_globalconfig: join(work, 'empty-global-npmrc'), npm_config_update_notifier: 'false' };
for (const path of [environment.HOME, environment.TMPDIR]) fs.mkdirSync(path);
write(environment.npm_config_userconfig, ''); write(environment.npm_config_globalconfig, '');
function protectedGuard() { for (const row of bindings.protectedRows) { const target = join(repository, row.path); assert.ok(fs.lstatSync(target).isFile()); assert.equal(fileHash(target), row.sha256, row.path); } for (const [name, digest] of Object.entries(read(join(recipe, 'MANIFEST.json')).files)) assert.equal(fileHash(join(recipe, name)), digest, name); }
function absent(pid) { for (const target of [pid, -pid]) { let error; try { process.kill(target, 0); } catch (caught) { error = caught; } assert.equal(error?.code, 'ESRCH', `CHILD_REMAINS:${target}`); } }
async function child(label, args, cwd, extra = {}, budget = 90000) {
  state.phase = label;
  protectedGuard(); assert.equal(fileHash(node), closure.binaries.find(row => row.path === node).sha256);
  const directory = join(raw, `${String(state.children.length + 1).padStart(2, '0')}-${label}`); fs.mkdirSync(directory);
  const record = { label, args, cwd, directory: relative(scope, directory), environment: { ...environment, ...extra }, startedAt: new Date().toISOString(), nodeSha256: fileHash(node), forced: false, bytes: 0 };
  state.children.push(record); save(join(directory, 'PRE.json'), record);
  const handle = spawn(node, args, { cwd, env: record.environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); record.pid = handle.pid;
  const stdout = [], stderr = []; let hard;
  const kill = reason => { if (record.forced) return; record.forced = reason; try { process.kill(-record.pid, 'SIGTERM'); } catch {} hard = setTimeout(() => { try { process.kill(-record.pid, 'SIGKILL'); } catch {} }, 2000); };
  for (const [stream, chunks] of [[handle.stdout, stdout], [handle.stderr, stderr]]) stream.on('data', bytes => { record.bytes += bytes.length; if (record.bytes > 16 * 1024 ** 2) kill('output-budget'); else chunks.push(Buffer.from(bytes)); });
  const watchdog = setTimeout(() => kill('watchdog'), budget);
  await new Promise(resolve => { handle.on('error', error => { record.spawnError = String(error); }); handle.on('exit', (code, signal) => { record.exit = { code, signal }; }); handle.on('close', (code, signal) => { record.close = { code, signal }; clearTimeout(watchdog); clearTimeout(hard); resolve(); }); });
  write(join(directory, 'stdout.data'), Buffer.concat(stdout)); write(join(directory, 'stderr.data'), Buffer.concat(stderr));
  if (record.pid) { absent(record.pid); record.pidAbsent = true; record.processGroupAbsent = true; }
  record.finishedAt = new Date().toISOString(); record.nodeSha256After = fileHash(node); save(join(directory, 'STATUS.json'), record);
  assert.equal(record.nodeSha256After, record.nodeSha256); protectedGuard();
  assert.equal(record.forced, false, `${label}:FORCED_CHILD`); assert.equal(record.spawnError, undefined); assert.deepEqual(record.exit, record.close);
  return { ...record.close, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), directory };
}
const toolMap = {};
function toolEnvironment(label) { return { DU_ADMISSION_WORK: work, DU_ADMISSION_RUN: scope, DU_ADMISSION_LOG: join(raw, `${label}-tool.jsonl`), DU_TOOL_MAP: join(work, 'tool-map.json') }; }
async function tool(label, path, args, cwd = work) {
  const result = await child(label, ['--require', join(recipe, 'tool-observer.cjs'), path, ...args], cwd, toolEnvironment(label));
  const records = fs.readFileSync(join(raw, `${label}-tool.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.filter(row => row.kind === 'tool-observer-start').length, 1); assert.equal(records.filter(row => row.kind === 'tool-observer-exit').length, 1);
  const compiles = records.filter(row => row.kind === 'actual-commonjs-compile'); assert.ok(compiles.length > 0);
  for (const row of compiles) { assert.equal(row.compileSha256, toolMap[row.path]); assert.equal(row.diskSha256, row.compileSha256); }
  for (const row of records.filter(row => row.kind === 'actual-file-read')) if (Object.hasOwn(toolMap, row.path)) assert.equal(row.sha256, toolMap[row.path]);
  return { ...result, records, compiles: compiles.length };
}
let toolBaseline, dependencyBaseline, sourceRoot, sourceBaseline, movedRoot, movedBaseline;
function guard(label) {
  protectedGuard(); if (toolBaseline) matchInventory(tree(join(work, 'tools')), toolBaseline);
  if (dependencyBaseline) matchInventory(tree(join(work, 'dependencies')), dependencyBaseline);
  if (sourceBaseline) matchInventory(tree(sourceRoot), sourceBaseline);
  if (movedBaseline) matchInventory(tree(movedRoot), movedBaseline);
  state.guards.push({ label, at: new Date().toISOString(), status: 'UNCHANGED' });
}
function rejectControl(id, action) { let failed = false, error; try { action(); } catch (caught) { failed = true; error = String(caught); } const row = { id, expected: 'reject', rejected: failed, error }; state.controls.push(row); save(join(raw, `${id}.json`), row); assert.equal(failed, true, id); }
const compiler = join(work, 'tools/typescript/bin/tsc'), npm = join(work, 'tools/npm/bin/npm-cli.js');
async function types(label, consumer) {
  write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, noEmit: true, types: ['node'], typeRoots: [join(work, 'dependencies/node_modules/@types')] }, files: ['consumer.ts'] }));
  const rows = [['root', 2, 2724]];
  for (const [name, status, code] of rows) {
    const target = join(consumer, 'consumer.ts'); if (fs.existsSync(target)) fs.unlinkSync(target); write(target, fs.readFileSync(join(recipe, `types-${name}.ts.data`)));
    const result = await tool(`${label}-${name}`, compiler, ['-p', 'tsconfig.json'], consumer);
    const diagnostics = [...result.stdout.matchAll(/^consumer\.ts\((\d+),(\d+)\): error TS(\d+): (.+)$/gmu)];
    const reads = result.records.filter(row => row.kind === 'actual-file-read');
    for (const row of reads) {
      assert.ok([`${consumer}/`, `${work}/tools/`, `${work}/dependencies/`].some(prefix => row.path.startsWith(prefix)), `TYPE_SOURCE_FALLBACK:${row.path}`);
      if (row.path.startsWith(`${consumer}/node_modules/virtual-bash/`)) {
        const key = relative(join(consumer, 'node_modules/virtual-bash'), row.path); const expected = bindings.packageFiles.find(entry => entry.path === key); assert.ok(expected, `UNBOUND_DECLARATION:${key}`); assert.equal(row.sha256, expected.sha256); assert.ok(key === 'package.json' || key.endsWith('.d.ts'));
      }
    }
    if (!['root', 'subpath'].includes(name)) assert.ok(reads.some(row => row.path === join(consumer, 'node_modules/virtual-bash/dist/commands/timeout/index.d.ts') && row.sha256 === bindings.packageFiles.find(entry => entry.path === 'dist/commands/timeout/index.d.ts').sha256));
    if (name === 'root') assert.ok(reads.some(row => row.path === join(consumer, 'node_modules/virtual-bash/dist/index.d.ts')));
    assert.ok(reads.some(row => row.path === join(consumer, 'node_modules/virtual-bash/package.json')));
    assert.ok(reads.some(row => row.path === target && row.sha256 === fileHash(target)));
    const record = { profile: label, name, status: 'PASS', exitCode: result.code, diagnostics: diagnostics.map(row => ({ line: Number(row[1]), column: Number(row[2]), code: Number(row[3]), message: row[4] })), actualCompiles: result.compiles, actualReads: reads.length };
    try {
      assertRootMissing(result);
    } catch (error) { record.status = 'FAIL'; record.failure = { message: error?.message, stack: error?.stack }; }
    state.types.push(record); save(join(raw, `${label}-${name}-type-outcome.json`), record); guard(`${label}-${name}-POST`);
  }
  return { status: state.types.filter(row => row.profile === label).every(row => row.status === 'PASS') ? 'PASS' : 'FAIL', outcomes: rows.length, profile: label };
}
async function runtime(profile, productRoot, typeProof, mutation) {
  const output = join(raw, profile); fs.mkdirSync(output);
  const source = profile !== 'moved'; const loads = {};
  for (const row of tree(productRoot)) if (row.path.endsWith(source ? '.ts' : '.js')) loads[join(productRoot, row.path)] = row.sha256;
  for (const row of tree(recipe)) if (row.path.endsWith('.mjs')) loads[join(recipe, row.path)] = row.sha256;
  const parent = join(repository, 'tests/commands/timeout-independent-20260828');
  for (const name of ['families.mjs', 'clock.mjs', 'oracle.mjs', 'review-preparation-v1/recipe/support.mjs']) loads[join(parent, name)] = fileHash(join(parent, name));
  const configuration = { profile: source ? 'source' : 'moved', reportingProfile: profile, candidate: bindings.candidate, sourceRoot: source ? productRoot : null, loads, targets: { 'timeout-under-review': join(productRoot, source ? 'src/commands/timeout/index.ts' : 'dist/commands/timeout/index.js'), 'root-under-review': join(productRoot, source ? 'src/index.ts' : 'dist/index.js') }, diagnostics: bindings.diagnostics, numeric: bindings.numeric, staticProof: bindings.staticProof, typeProof, output, trace: join(output, 'module-loads.jsonl'), guardRoots: [{ root: productRoot, entries: tree(productRoot) }], ...(mutation ? { caseIds: [mutation.caseId], intentionalMutation: mutation } : { caseIds: ['PC01'] }) };
  const configPath = join(work, `${profile}-config.json`); save(configPath, configuration);
  guard(`${profile}-PRE`);
  const result = await child(profile, ['--permission', `--allow-fs-read=${parent}`, `--allow-fs-write=${scope}`, '--import', join(recipe, 'preload.mjs'), join(recipe, 'cases.mjs')], work, { TIMEOUT_CONFIG: configPath, TIMEOUT_CONFIG_SHA256: fileHash(configPath) }, 120000);
  const captured = read(join(output, 'RESULT.json')); guard(`${profile}-POST`);
  const observations = fs.readFileSync(configuration.trace, 'utf8').trim().split('\n').map(JSON.parse);
  for (const target of Object.values(configuration.targets)) assert.ok(observations.some(row => row.kind === 'actual-module-load' && row.path === target && row.sha256 === loads[target]), `ACTUAL_ENTRY_LOAD_REQUIRED:${target}`);
  captured.loadProof = { actualModuleLoads: observations.filter(row => row.kind === 'actual-module-load').length, publicEntryClaim: false, profile: configuration.profile };
  assert.equal(captured.cleanup.pending, 0); assert.equal(captured.cleanup.schedulerLive, 0); assert.deepEqual(captured.cleanup.unhandled, []);
  assert.deepEqual(captured.unexecuted, []);
  assert.notEqual(captured.status, 'STOP_NO_RETRY');
  if (mutation) {
    const failed = captured.cases.find(row => row.status === 'FAIL');
    const record = { id: mutation.id, status: 'PASS', actualModuleSha256: mutation.mutantSha256, expectedFailure: mutation.failure, actualFailure: failed?.error, cleanup: captured.cleanup, loads: captured.loadProof, diagnosticObservations: captured.diagnosticObservations };
    try {
      assert.equal(result.code, 1); assert.equal(failed?.id, mutation.caseId); assert.ok(failed.error.text.includes(mutation.failure), 'DESIGNATED_MUTANT_FAILURE:' + mutation.id);
      if (mutation.id === 'M02') {
        const activation = captured.diagnosticObservations.find(row => row.kind === 'PC02-direct-retirement');
        assert.equal(activation.entered, true); assert.equal(activation.threw, true); assert.equal(activation.sameSentinel, true); assert.equal(activation.resources, 0); assert.equal(activation.childClosed, true);
      }
    } catch (error) { record.status = 'FAIL'; record.verifierFailure = { name: error?.name, message: error?.message, stack: error?.stack }; }
    state.mutants.push(record); save(join(raw, mutation.id + '-qualification.json'), record);
  } else {
    state[profile] = captured;
    assert.ok(['DIAGNOSTIC_FROZEN_ASSERTIONS_PASSED', 'DIAGNOSTIC_FROZEN_ASSERTIONS_FAILED'].includes(captured.status));
    assert.equal(result.code, captured.status === 'DIAGNOSTIC_FROZEN_ASSERTIONS_PASSED' ? 0 : 1);
  }
}
async function importNegative(id, consumer, target, kind) {
  const output = join(raw, id); fs.mkdirSync(output);
  const entry = join(consumer, id + '.mjs'); write(entry, fs.readFileSync(join(recipe, 'negative-import.mjs')));
  const configPath = join(work, id + '-config.json');
  save(configPath, { profile: 'moved', sourceRoot, loads: { [entry]: fileHash(entry) }, targets: {}, trace: join(output, 'module-loads.jsonl') });
  const parent = join(repository, 'tests/commands/timeout-independent-20260828');
  const result = await child(id, ['--permission', '--allow-fs-read=' + parent, '--allow-fs-write=' + scope, '--import', join(recipe, 'preload.mjs'), entry], consumer,
    { TIMEOUT_CONFIG: configPath, TIMEOUT_CONFIG_SHA256: fileHash(configPath), NEGATIVE_TARGET: kind === 'unbound-source' ? pathToFileURL(target).href : target, NEGATIVE_LABEL: target });
  const trace = fs.readFileSync(join(output, 'module-loads.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const record = { id, status: 'PASS', kind, target, childCode: result.code, trace };
  try {
    record.observed = JSON.parse(result.stdout);
    assertImportDenied({ result, observed: record.observed, trace, entry, entrySha256: fileHash(entry), target, kind, packageJson: join(consumer, 'node_modules/virtual-bash/package.json') });
  } catch (error) { record.status = 'FAIL'; record.verifierFailure = { name: error?.name, message: error?.message, stack: error?.stack }; }
  state.controls.push(record); save(join(output, 'QUALIFICATION.json'), record); guard(id + '-POST');
}

try {
  state.phase = 'focused-controls'; guard('PRE');
  state.focusedControls = focusedControls(); save(join(raw, 'FOCUSED-CONTROLS.json'), state.focusedControls);
  assert.equal(state.focusedControls.length, 28); assert.ok(state.focusedControls.every(row => row.actual === row.expected));
  const archive = fs.readFileSync(join(repository, bindings.sourceArchive.path)); assert.equal(sha(archive), bindings.sourceArchive.sha256); const entries = tarEntries(archive); matchInventory(entries, bindings.inputs);
  for (const binary of closure.binaries) { assert.equal(fileHash(binary.path), binary.sha256); assert.equal(fs.realpathSync(binary.path), binary.realpath); }
  let regular = 0, aliases = 0;
  for (const packageRow of closure.packages) {
    const destination = packageRow.name === 'npm' || packageRow.name === 'typescript' ? join(work, 'tools', packageRow.name) : join(work, 'dependencies/node_modules', packageRow.name);
    fs.mkdirSync(destination, { recursive: true });
    for (const row of packageRow.records) {
      safe(row.path); const input = join(packageRow.root, row.path), output = join(destination, row.path), stat = fs.lstatSync(input); assert.equal(stat.mode & 511, row.mode);
      if (row.type === 'directory') { assert.ok(stat.isDirectory()); fs.mkdirSync(output, { recursive: true }); }
      else if (row.type === 'symlink') { assert.ok(stat.isSymbolicLink()); assert.equal(fs.readlinkSync(input), row.link); aliases++; }
      else { assert.ok(stat.isFile()); assert.equal(fileHash(input), row.sha256); write(output, fs.readFileSync(input)); fs.chmodSync(output, row.mode); toolMap[output] = row.sha256; regular++; }
    }
  }
  assert.equal(regular, 2274); assert.equal(aliases, 12); state.tools = { regular, metadataOnlyAliases: aliases }; save(join(work, 'tool-map.json'), toolMap); toolBaseline = tree(join(work, 'tools')); dependencyBaseline = tree(join(work, 'dependencies'));
  sourceRoot = join(work, 'source'); fs.mkdirSync(sourceRoot); for (const row of entries) { write(join(sourceRoot, row.path), row.body); fs.chmodSync(join(sourceRoot, row.path), row.mode); } matchInventory(tree(sourceRoot), bindings.inputs);
  save(join(raw, 'PRE-AUTHENTICATION.json'), { at: new Date().toISOString(), candidate: bindings.candidate, inputs: 268, archiveSha256: sha(archive), tools: state.tools, recipeSha256: fileHash(join(recipe, 'MANIFEST.json')) });

  sourceBaseline = tree(sourceRoot);
  const packFile = join(repository, bindings.retainedPack.path); assert.equal(fileHash(packFile), bindings.pack.sha256);
  matchInventory(tarEntries(fs.readFileSync(packFile), true).map(row => ({ ...row, path: row.path.slice(8) })), bindings.packageFiles);
  state.pack = { sha256: fileHash(packFile), members: bindings.packageFiles.length, reproduction: 'BOUND_PRIOR_ACTUAL_NOT_RERUN' };
  const installed = join(work, 'installed'); fs.mkdirSync(installed); write(join(installed, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  state.phase = 'offline-install'; const install = await tool('install', npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', packFile], installed); assert.equal(install.code, 0);
  matchInventory(tree(join(installed, 'node_modules/virtual-bash')), bindings.packageFiles);
  state.phase = 'installed-root-types'; const installedTypes = await types('installed', installed);
  state.phase = 'source-PC01-diagnosis'; await runtime('source', sourceRoot, installedTypes);
  const movedConsumer = join(work, 'physically-moved/consumer'); fs.mkdirSync(join(work, 'physically-moved')); fs.renameSync(installed, movedConsumer); assert.equal(fs.existsSync(installed), false);
  movedRoot = join(movedConsumer, 'node_modules/virtual-bash'); movedBaseline = tree(movedRoot); matchInventory(movedBaseline, bindings.packageFiles);
  fs.unlinkSync(join(movedConsumer, 'tsconfig.json'));
  state.phase = 'moved-root-types'; const movedTypes = await types('moved', movedConsumer);
  state.phase = 'moved-PC01-diagnosis'; await runtime('moved', movedRoot, movedTypes);
  state.phase = 'A09-new-targeted-diagnosis'; await importNegative('A09-new-targeted-diagnosis', movedConsumer, join(repository, 'src/index.ts'), 'unbound-source');
  state.phase = 'A10-public-subpath'; await importNegative('A10-public-subpath', movedConsumer, 'virtual-bash/commands/timeout', 'public-subpath');
  for (const mutation of bindings.mutants) {
    state.phase = mutation.id;
    const mutantRoot = join(work, mutation.id); fs.mkdirSync(mutantRoot);
    for (const row of entries) {
      let bytes = row.body;
      if (row.path === 'src/commands/timeout/index.ts') {
        const source = bytes.toString(), offset = source.lastIndexOf(mutation.before); assert.ok(offset >= 0);
        bytes = Buffer.from(source.slice(0, offset) + mutation.after + source.slice(offset + mutation.before.length)); assert.equal(sha(bytes), mutation.mutantSha256);
      }
      write(join(mutantRoot, row.path), bytes); fs.chmodSync(join(mutantRoot, row.path), row.mode);
    }
    await runtime(mutation.id, mutantRoot, installedTypes, mutation);
    guard(mutation.id + '-AFTER-QUALIFICATION');
  }
  state.phase = 'completed';
  state.status = state.types.every(row => row.status === 'PASS') && state.controls.every(row => row.status === 'PASS') && state.mutants.every(row => row.status === 'PASS')
    ? 'RECONCILIATION_COMPLETE_PC01_BOUNDARY_REVIEW_REQUIRED' : 'RECONCILIATION_COMPLETE_WITH_ADDITIONAL_FINDINGS';
  process.exitCode = 1;
} catch (error) { state.status = 'STOP_NO_RETRY'; state.failure = { name: error?.name, message: error?.message, stack: error?.stack }; process.exitCode = 1; }
finally {
  try { guard('FINAL'); state.integrity = 'PASS'; } catch (error) { state.integrity = { message: error?.message, stack: error?.stack }; state.status = 'STOP_NO_RETRY'; process.exitCode = 1; }
  try { for (const record of state.children) if (record.pid) absent(record.pid); state.allChildrenReaped = true; } catch (error) { state.allChildrenReaped = false; state.cleanupFailure = String(error); process.exitCode = 1; }
  state.finishedAt = new Date().toISOString(); save(join(raw, 'RESULT.json'), state);
  console.log(JSON.stringify({ status: state.status, phase: state.phase, types: state.types.map(row => row.status), controls: state.controls.map(row => ({ id: row.id, status: row.status })), mutants: state.mutants.map(row => ({ id: row.id, status: row.status })), children: state.children.length, reaped: state.allChildrenReaped, failure: state.failure }));
}
