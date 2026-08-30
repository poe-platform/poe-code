import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recipe, scope, repository, history, frozen, candidate, freeze, packSha, node, work, raw, sha, read, fileHash, save, write, git, gitCalls, safe, tree, fileMap, treeGuard, protectedGuard, authenticateTools, authenticateSelected, authenticateRecipe, packageGuard, loadGuard, errorRecord } from './common.mjs';
import { assertReplayBindings } from './binding-contract.mjs';

const bindings = read(join(recipe, 'BINDINGS.json'));
const replay = read(join(recipe, 'replay-bindings.json'));
const semanticIds = ['P01', 'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'E01', 'E02', 'E03', 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08'];
const allIds = read(join(frozen, 'cases.json')).cases.map(row => row.id);
const state = { schema: 'du-public29-replay/1', startedAt: new Date().toISOString(), candidate, freeze, packSha256: packSha, mode: 'scoped-committed-archive', recipeCommit: process.argv[2], attempts: 1, retries: 0, source: [], moved: [], cases: [], controls: [], children: [], guards: [], phase: 'preflight', failure: null, privateHelperApproved: false, privateHelperLoads: 0, fullGate: false, whole76: false, buildAndPackReproduction: 'bound accepted5508a2a2, not repeated', oldHold: '3e02038d 0/29 preserved' };
assert.ok(!fs.existsSync(raw) && !fs.existsSync(work), 'ONE_ATTEMPT_NO_EXISTING_RUN');
fs.mkdirSync(raw, { recursive: true });
fs.mkdirSync(work, { recursive: true });
save(join(raw, 'START.json'), state);
let sourceRoot, movedRoot, toolsSnapshot, sourceSnapshot, firstMoved, currentCase = null;
let nextChild = 0, toolReads = 0, toolCompiles = 0;
const environment = { PATH: '/usr/bin:/bin', HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), LC_ALL: 'C', LANG: 'C', NODE_NO_WARNINGS: '1', npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'empty-npmrc'), npm_config_globalconfig: join(work, 'empty-global-npmrc'), npm_config_update_notifier: 'false' };
for (const name of ['home', 'tmp']) fs.mkdirSync(join(work, name));
write(environment.npm_config_userconfig, ''); write(environment.npm_config_globalconfig, '');
const toolMap = {};

function checkpoint(label) {
  protectedGuard(bindings);
  assert.equal(fileHash(join(recipe, 'MANIFEST.json')), process.argv[3]);
  for (const [path, digest] of Object.entries(read(join(recipe, 'MANIFEST.json')).files)) assert.equal(fileHash(join(recipe, path)), digest, path);
  authenticateTools(bindings);
  if (toolsSnapshot) treeGuard(tree(join(work, 'tools')), toolsSnapshot);
  if (sourceSnapshot) treeGuard(tree(sourceRoot), sourceSnapshot);
  if (movedRoot) packageGuard(join(movedRoot, 'node_modules/virtual-bash'), bindings.packageFiles);
  state.guards.push({ label, at: new Date().toISOString(), status: 'unchanged' });
}
function append(row) { state.cases.push({ ...row, status: 'PASS' }); }
function negative(id, action) { assert.throws(action); state.controls.push({ id, status: 'EXPECTED_REJECTION' }); }
function jsonLines(path) { return fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
function absent(pid) {
  for (const target of [pid, -pid]) {
    let error;
    try { process.kill(target, 0); } catch (caught) { error = caught; }
    assert.equal(error?.code, 'ESRCH', `PROCESS_OR_GROUP_REMAINS:${target}`);
  }
}
async function child(label, args, cwd, extra = {}, timeout = 45000) {
  const directory = join(raw, `${String(++nextChild).padStart(3, '0')}-${label}`);
  fs.mkdirSync(directory);
  const row = { label, args, cwd, environment: { ...environment, ...extra }, directory: relative(scope, directory), startedAt: new Date().toISOString(), exit: null, close: null, forced: false, outputBytes: 0 };
  state.children.push(row);
  const output = [], diagnostic = [];
  let overflow = false, timer, hardTimer;
  const processChild = spawn(node, args, { cwd, env: row.environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  row.pid = processChild.pid;
  const terminate = reason => {
    if (row.forced) return;
    row.forced = reason;
    try { process.kill(-row.pid, 'SIGTERM'); } catch {}
    hardTimer = setTimeout(() => { try { process.kill(-row.pid, 'SIGKILL'); } catch {} }, 2000);
  };
  for (const [stream, chunks] of [[processChild.stdout, output], [processChild.stderr, diagnostic]]) stream.on('data', bytes => {
    row.outputBytes += bytes.length;
    if (row.outputBytes > 8 * 1024 ** 2) { overflow = true; terminate('output-budget'); }
    else chunks.push(Buffer.from(bytes));
  });
  timer = setTimeout(() => terminate('watchdog'), timeout);
  await new Promise(resolve => {
    processChild.on('error', error => { row.spawnError = errorRecord(error); });
    processChild.on('exit', (code, signal) => { row.exit = { code, signal, at: new Date().toISOString() }; });
    processChild.on('close', (code, signal) => { row.close = { code, signal, at: new Date().toISOString() }; clearTimeout(timer); clearTimeout(hardTimer); resolve(); });
  });
  write(join(directory, 'stdout.data'), Buffer.concat(output));
  write(join(directory, 'stderr.data'), Buffer.concat(diagnostic));
  row.finishedAt = new Date().toISOString();
  if (row.pid) { absent(row.pid); row.pidAbsent = true; row.processGroupEmpty = true; }
  save(join(directory, 'STATUS.json'), row);
  assert.ok(!row.spawnError && !row.forced && !overflow, 'NATURAL_CHILD_REQUIRED');
  assert.deepEqual(row.exit && { code: row.exit.code, signal: row.exit.signal }, row.close && { code: row.close.code, signal: row.close.signal });
  return { code: row.close.code, signal: row.close.signal, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(diagnostic).toString(), directory, row };
}
function toolEnvironment(log) {
  return { DU_ADMISSION_WORK: work, DU_ADMISSION_RUN: scope, DU_ADMISSION_LOG: log, DU_TOOL_MAP: join(work, 'tool-map.json') };
}
function validateTool(log, compiler = false) {
  const records = jsonLines(log);
  assert.equal(records.filter(row => row.kind === 'tool-observer-start').length, 1);
  assert.equal(records.filter(row => row.kind === 'tool-observer-exit').length, 1);
  const compiles = records.filter(row => row.kind === 'actual-commonjs-compile');
  assert.ok(compiles.length > 0);
  for (const row of compiles) { assert.equal(row.compileSha256, toolMap[row.path]); assert.equal(row.diskSha256, row.compileSha256); }
  const reads = records.filter(row => row.kind === 'actual-file-read');
  for (const row of reads) if (Object.hasOwn(toolMap, row.path)) assert.equal(row.sha256, toolMap[row.path]);
  if (compiler) {
    assert.ok(compiles.some(row => row.path.endsWith('/typescript/lib/_tsc.js')));
    assert.ok(reads.some(row => row.path.endsWith('/virtual-bash/dist/index.d.ts')));
    for (const row of reads.filter(row => row.path.includes('/virtual-bash/'))) {
      const key = row.path.split('/node_modules/virtual-bash/')[1];
      assert.equal(row.sha256, bindings.packageFiles[key], `ACTUAL_DECLARATION_READ:${key}`);
      assert.ok(!key.startsWith('src/'));
    }
  }
  toolReads += reads.length; toolCompiles += compiles.length;
  return { reads: reads.length, compiles: compiles.length };
}
function stageFixtures(root) {
  fs.mkdirSync(join(root, 'fixtures'), { recursive: true });
  for (const name of ['entry.mjs', 'preload.mjs', 'load-proof-hook.mjs', 'public-cases.mjs', 'runtime-cases.mjs', 'binding-contract.mjs', 'replay-bindings.json', 'R07.json', 'missing-export.mjs', 'denied-source.mjs']) write(join(root, 'fixtures', name), fs.readFileSync(join(recipe, name)));
}
function configuration(root, profile, id, directory) {
  const expectedLoads = Object.fromEntries(Object.entries(fileMap(root)).filter(([key]) => key.endsWith('.js') || key.endsWith('.mjs') || (profile === 'source' && key.startsWith('node_modules/virtual-bash/src/') && key.endsWith('.ts'))));
  const extension = profile === 'source' ? 'ts' : 'js', folder = profile === 'source' ? 'src' : 'dist';
  return { caseId: id, profile, consumerRoot: root, expectedLoads, tracePath: join(directory, 'module-loads.jsonl'), publicTargets: { 'virtual-bash': `node_modules/virtual-bash/${folder}/index.${extension}`, 'virtual-bash/commands/du': `node_modules/virtual-bash/${folder}/commands/du/index.${extension}` } };
}
async function semantic(root, profile, id) {
  currentCase = `${profile}-${id}`; state.phase = currentCase;
  checkpoint(`${currentCase}-PRE`);
  const before = tree(root), directory = join(raw, `${profile}-${id}`);
  fs.mkdirSync(directory);
  const config = configuration(root, profile, id, directory);
  save(join(directory, 'config.json'), config);
  const result = await child(currentCase, ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${directory}`, `--allow-fs-write=${directory}`, '--import', pathToFileURL(join(root, 'fixtures/preload.mjs')).href, join(root, 'fixtures/entry.mjs')], root, { DU_CONFIG: join(directory, 'config.json') });
  treeGuard(tree(root), before); checkpoint(`${currentCase}-POST`);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null); assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.id, id); assert.equal(receipt.profile, profile); assert.equal(receipt.actualCaseExecutions, 1);
  assert.equal(receipt.status, 'assertions-and-owned-cleanup-completed');
  const trace = jsonLines(config.tracePath), proof = loadGuard(trace, config);
  save(join(directory, 'ACCEPTED.json'), { receipt, proof, traceSha256: fileHash(config.tracePath), naturalChild: result.row });
  state[profile].push({ id, proof, status: 'PASS', directory: relative(scope, directory) });
  if (profile === 'moved') { append({ id, category: allIds.includes(id) ? 'frozen-public-case' : 'invalid' }); if (id === 'P01') firstMoved = { config, trace }; }
}
async function compile(root, label, payload, expected, positivePackage = true) {
  currentCase = label; state.phase = label;
  const target = join(root, 'consumer.ts');
  if (fs.existsSync(target)) fs.unlinkSync(target);
  write(target, payload);
  const configurationPath = join(root, 'tsconfig.json');
  if (!fs.existsSync(configurationPath)) save(configurationPath, { compilerOptions: read(join(frozen, 'type-controls.json')).compilerOptions, files: ['consumer.ts'] });
  const before = tree(root); checkpoint(`${label}-PRE`);
  const log = join(raw, `${label}-tool.jsonl`);
  const result = await child(label, ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${join(work, 'tools')}`, `--allow-fs-read=${join(work, 'tool-map.json')}`, `--allow-fs-read=${join(recipe, 'tool-observer.cjs')}`, `--allow-fs-write=${scope}`, '--require', join(recipe, 'tool-observer.cjs'), join(work, 'tools/typescript/bin/tsc'), '--project', configurationPath, '--pretty', 'false'], root, toolEnvironment(log));
  treeGuard(tree(root), before); checkpoint(`${label}-POST`);
  const proof = validateTool(log, positivePackage);
  assert.equal(result.signal, null); assert.equal(result.stderr, ''); assert.equal(result.code, expected.exitCode, result.stdout);
  const diagnostics = result.stdout.trim() ? result.stdout.trim().split('\n').map(line => {
    const match = /^consumer\.ts\((\d+),(\d+)\): error TS(\d+): (.*)$/u.exec(line);
    assert.ok(match, `UNCLASSIFIED_DIAGNOSTIC:${line}`);
    return { line: Number(match[1]), column: Number(match[2]), code: Number(match[3]), text: match[4] };
  }) : [];
  assert.equal(diagnostics.length, expected.diagnostics.length, result.stdout);
  for (let index = 0; index < diagnostics.length; index++) {
    const actual = diagnostics[index], wanted = expected.diagnostics[index];
    assert.equal(actual.line, wanted.line); assert.equal(actual.code, wanted.code); assert.ok(actual.text.includes(wanted.mentions));
  }
  return { label, expected, diagnostics, proof, payloadSha256: sha(payload), status: 'EXPECTED' };
}
function copyConsumer(label) {
  const target = join(work, label); fs.cpSync(movedRoot, target, { recursive: true, dereference: false, errorOnExist: true }); return target;
}
function assertBindingIdentity(document) {
  assertReplayBindings(document);
  assert.equal(document.required.candidateCommit, candidate);
  assert.equal(document.required.freezeCommit, freeze);
  assert.equal(document.required.freezeManifestSha256, bindings.freezeManifestSha256);
  assert.deepEqual(document.required.sourceInventory, bindings.sourceInventory);
  assert.deepEqual(document.required.supervisorIdentity, replay.required.supervisorIdentity);
  assert.deepEqual(document.required.toolIdentities, replay.required.toolIdentities);
  assert.deepEqual(document.required.replayAuthorization, replay.required.replayAuthorization);
}

try {
  state.toolsPre = authenticateTools(bindings);
  state.seal = authenticateRecipe(process.argv[2]);
  protectedGuard(bindings); assertBindingIdentity(replay);
  for (const row of bindings.protectedFiles) assert.equal(sha(git('show', `${row.commit}:${row.path}`)), row.sha256, row.path);
  assert.equal(git('rev-parse', `${candidate}^{tree}`).toString().trim(), bindings.candidateTree);
  const acceptedHtml = read(join(repository, bindings.acceptedHtml.summaryPath));
  assert.equal(acceptedHtml.status, 'FROZEN_ASSERTIONS_PASSED_WITH_ORIGINAL_UNSCORED_LIMITS');
  assert.equal(acceptedHtml.counts.runtimePassed, 68); assert.equal(acceptedHtml.counts.runtimeFailed, 0);
  const admission = read(join(history, 'run-v3/RESULT.json'));
  assert.equal(admission.authenticatedInputs, 771); assert.equal(admission.packageMembers, 834);
  assert.equal(admission.reproducedPackSha256, packSha); assert.equal(admission.directWholePackByteEqual, true); assert.equal(admission.postUnchanged, true);
  state.controls.push({ id: 'A06', status: 'PASS-new-positive-release', acceptedHtml: bindings.acceptedHtml, not74NameSubstitution: true });
  save(join(raw, 'PRE-AUTHENTICATION.json'), { tools: state.toolsPre, seal: state.seal, protectedFiles: bindings.protectedFiles, acceptedHtml: bindings.acceptedHtml, acceptedAdmission: bindings.acceptedAdmission, fullHistoryProof: false });
  state.phase = 'materialization';
  sourceRoot = join(work, 'source-consumer');
  const sourcePackage = join(sourceRoot, 'node_modules/virtual-bash');
  fs.mkdirSync(sourcePackage, { recursive: true });
  state.selected = authenticateSelected(bindings, (entry, bytes) => { const target = join(sourcePackage, safe(entry.path)); write(target, bytes); fs.chmodSync(target, parseInt(entry.mode.slice(-3), 8)); });
  assert.equal(state.selected.tree, bindings.candidateTree);
  for (const dependency of bindings.closure.packages) for (const entry of dependency.records) {
    safe(entry.path); if (entry.type !== 'file') continue;
    const bytes = fs.readFileSync(join(dependency.root, entry.path)); assert.equal(sha(bytes), entry.sha256);
    const target = join(work, 'tools', dependency.name, entry.path); write(target, bytes); fs.chmodSync(target, entry.mode); toolMap[target] = entry.sha256;
  }
  save(join(work, 'tool-map.json'), toolMap); toolsSnapshot = tree(join(work, 'tools'));
  write(join(sourceRoot, 'package.json'), '{"private":true,"type":"module"}\n'); stageFixtures(sourceRoot); sourceSnapshot = tree(sourceRoot);
  state.phase = 'install-move';
  const pack = fs.readFileSync(bindings.pack.path); assert.equal(pack.length, 726693); assert.equal(sha(pack), packSha);
  const localPack = join(work, 'candidate.tgz'); write(localPack, pack);
  const installed = join(work, 'installed-consumer'); fs.mkdirSync(installed);
  write(join(installed, 'package.json'), '{"name":"du-public-independent-consumer","version":"0.0.0","private":true,"type":"module"}\n');
  checkpoint('npm-install-PRE');
  const npmLog = join(raw, 'npm-tool.jsonl');
  const install = await child('npm-install', ['--require', join(recipe, 'tool-observer.cjs'), join(work, 'tools/npm/bin/npm-cli.js'), 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', localPack], installed, toolEnvironment(npmLog), 90000);
  assert.equal(install.code, 0, install.stderr); assert.equal(install.signal, null); state.npmProof = validateTool(npmLog);
  packageGuard(join(installed, 'node_modules/virtual-bash'), bindings.packageFiles);
  for (const dependency of bindings.closure.packages.filter(row => ['@types/node', 'undici-types'].includes(row.name))) {
    fs.cpSync(join(work, 'tools', dependency.name), join(installed, 'node_modules', dependency.name), { recursive: true });
  }
  stageFixtures(installed);
  const preMove = tree(installed); movedRoot = join(work, 'moved consumer with spaces');
  fs.renameSync(installed, movedRoot); assert.equal(fs.existsSync(installed), false); treeGuard(tree(movedRoot), preMove);
  checkpoint('physically-moved-PRE-FIRST-PUBLIC-EXECUTION');
  state.package = { authenticatedMembers: Object.keys(bindings.packageFiles).length, tarballBytes: pack.length, tarballSha256: sha(pack), installed: true, physicallyMoved: true, oldLocationAbsent: true, publicExecutionBeforeMove: 0, typesBeforeMove: 0, boundFullPackReproduction: bindings.acceptedAdmission };
  append({ id: 'P02', details: state.package });
  for (const id of semanticIds) await semantic(sourceRoot, 'source', id);
  for (const id of semanticIds) await semantic(movedRoot, 'moved', id);
  state.phase = 'strict-types';
  state.types = [];
  for (const control of read(join(frozen, 'type-controls.json')).controls) {
    state.types.push(await compile(movedRoot, control.case, fs.readFileSync(join(frozen, control.file)), control)); append({ id: control.case });
  }
  const aggregate = [
    ['T05-positive', 'aggregate-positive.ts.data', { exitCode: 0, diagnostics: [] }],
    ['T05-replace', 'aggregate-replace.ts.data', { exitCode: 2, diagnostics: [{ line: 2, code: 2353, mentions: 'replace' }] }],
    ['T05-unknown', 'aggregate-unknown.ts.data', { exitCode: 2, diagnostics: [{ line: 2, code: 2353, mentions: 'notADuOption' }] }],
  ];
  for (const [label, file, expected] of aggregate) state.types.push(await compile(movedRoot, label, fs.readFileSync(join(recipe, file)), expected));
  append({ id: 'T05', outcomes: 3 });
  state.phase = 'package-negatives';
  checkpoint('package-negatives-PRE');
  const missing = copyConsumer('negative-missing-export');
  const metadataPath = join(missing, 'node_modules/virtual-bash/package.json'), metadata = read(metadataPath);
  delete metadata.exports['./commands/du']; fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  const missingBefore = tree(missing);
  const missingRun = await child('P03-runtime', ['--permission', `--allow-fs-read=${missing}`, join(missing, 'fixtures/missing-export.mjs')], missing);
  treeGuard(tree(missing), missingBefore);
  assert.equal(missingRun.code, 1); assert.equal(missingRun.stdout, ''); assert.match(missingRun.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/u); assert.match(missingRun.stderr, /\.\/commands\/du/u);
  const missingType = await compile(missing, 'P03-types', fs.readFileSync(join(frozen, 'consumers/positive.ts.data')), bindings.missingExportType, false);
  append({ id: 'P03', runtime: 'ERR_PACKAGE_PATH_NOT_EXPORTED', strictType: missingType });
  const fallback = structuredClone(firstMoved.config); fallback.publicTargets['virtual-bash/commands/du'] = 'node_modules/virtual-bash/src/commands/du/index.ts';
  negative('P04-source-target', () => loadGuard(firstMoved.trace, fallback));
  const denied = await child('P04-permission', ['--permission', `--allow-fs-read=${movedRoot}`, join(movedRoot, 'fixtures/denied-source.mjs')], movedRoot, { DU_FORBIDDEN_SOURCE: join(repository, 'src/index.ts') });
  assert.equal(denied.code, 1); assert.equal(denied.stdout, ''); assert.match(denied.stderr, /ERR_ACCESS_DENIED/u); assert.ok(!denied.stderr.includes('SOURCE_FALLBACK_PERMISSION_WAS_NOT_DENIED'));
  append({ id: 'P04', externalSourceRead: 'permission-denied-before-content' });
  for (const specifier of ['virtual-bash', 'virtual-bash/commands/du']) negative(`P05-missing-${specifier}`, () => loadGuard(firstMoved.trace.filter(row => !(row.event === 'public-resolution' && row.specifier === specifier)), firstMoved.config));
  negative('P05-disk-only', () => loadGuard([], firstMoved.config));
  negative('P05-no-loads', () => loadGuard(firstMoved.trace.filter(row => row.event !== 'module-load'), firstMoved.config));
  for (const field of ['url', 'sha256']) {
    const trace = structuredClone(firstMoved.trace), row = trace.find(row => row.event === 'module-load');
    row[field] = field === 'url' ? pathToFileURL(join(repository, 'src/index.ts')).href : '0'.repeat(64);
    negative(`P05-wrong-${field}`, () => loadGuard(trace, firstMoved.config));
  }
  append({ id: 'P05', intentionalNegatives: 6 });
  for (const field of ['candidateCommit', 'freezeCommit', 'freezeManifestSha256', 'supervisorIdentity', 'toolIdentities', 'replayAuthorization', 'sourceInventory']) {
    const document = structuredClone(replay);
    if (field === 'sourceInventory') document.required[field].pop();
    else if (field === 'toolIdentities') document.required[field][0].sha256 = '0'.repeat(64);
    else if (typeof document.required[field] === 'object') document.required[field].sha256 = '0'.repeat(64);
    else document.required[field] = '0'.repeat(document.required[field].length);
    negative(`P06-binding-${field}`, () => assertBindingIdentity(document));
  }
  for (const mode of ['wrong-source-hash', 'unlisted-source']) {
    const document = structuredClone(replay);
    if (mode === 'wrong-source-hash') document.required.sourceInventory[0].sha256 = '0'.repeat(64);
    else document.required.sourceInventory.push({ ...document.required.sourceInventory[0], path: 'unlisted-input.data' });
    negative(`P06-${mode}`, () => assertBindingIdentity(document));
  }
  const fixtureBinding = structuredClone(bindings); fixtureBinding.protectedFiles[0].sha256 = '0'.repeat(64);
  negative('P06-fixture-hash', () => protectedGuard(fixtureBinding));
  const mutants = join(work, 'guard-controls'); fs.mkdirSync(mutants);
  write(join(mutants, 'input.data'), 'bound'); const baseline = tree(mutants);
  fs.writeFileSync(join(mutants, 'input.data'), 'wrong'); negative('P06-content-change', () => treeGuard(tree(mutants), baseline));
  fs.writeFileSync(join(mutants, 'input.data'), 'bound'); fs.chmodSync(join(mutants, 'input.data'), 0o755); negative('P06-mode-change', () => treeGuard(tree(mutants), baseline));
  fs.chmodSync(join(mutants, 'input.data'), 0o644); fs.unlinkSync(join(mutants, 'input.data')); negative('P06-missing', () => treeGuard(tree(mutants), baseline));
  write(join(mutants, 'input.data'), 'bound'); write(join(mutants, 'unlisted.data'), 'new'); negative('P06-new-entry', () => treeGuard(tree(mutants), baseline));
  negative('P06-AGENTS-name', () => safe('nested/AGENTS.md'));
  fs.symlinkSync('input.data', join(mutants, 'alias')); negative('P06-symlink', () => tree(mutants));
  append({ id: 'P06', selectedProfile: 'complete-pinned-Git-not-live-tree' });
  checkpoint('ALL-CASES-POST');
  assert.deepEqual(state.cases.map(row => row.id).sort(), allIds.toSorted());
  assert.equal(state.source.length, 19); assert.equal(state.moved.length, 19);
  state.controls.push({ id: 'P03-addendum', status: 'PASS-new-positive-public-completion', uniqueFrozenCases: 29, physicallyMoved: true, actualLoads: true, strictTypes: true });
  state.status = 'SCOPED_DU29_ASSERTIONS_PASSED';
} catch (error) {
  state.failure = errorRecord(error); state.failedCase = currentCase; state.status = 'STOP_NO_RETRY';
  process.exitCode = 1;
} finally {
  try { checkpoint('FINAL-INTEGRITY'); state.finalIntegrity = 'PASS'; } catch (error) { state.finalIntegrity = errorRecord(error); process.exitCode = 1; state.status = 'STOP_NO_RETRY'; }
  try { for (const childRow of state.children) if (childRow.pid) absent(childRow.pid); state.allChildrenReaped = true; } catch (error) { state.allChildrenReaped = false; state.cleanupFailure = errorRecord(error); process.exitCode = 1; }
  state.finishedAt = new Date().toISOString(); state.gitSynchronousNaturalReturns = gitCalls;
  state.actualToolReads = toolReads; state.actualToolCompiles = toolCompiles;
  state.actualFrozenPasses = state.cases.length; state.unexecuted = allIds.filter(id => !state.cases.some(row => row.id === id));
  state.sourceUnexecuted = semanticIds.filter(id => !state.source.some(row => row.id === id));
  state.movedUnexecuted = semanticIds.filter(id => !state.moved.some(row => row.id === id));
  save(join(raw, 'RESULT.json'), state);
  console.log(JSON.stringify({ status: state.status, source: state.source.length, moved: state.moved.length, frozen: state.cases.length, unexecuted: state.unexecuted, phase: state.phase, failure: state.failure, allChildrenReaped: state.allChildrenReaped }));
}
