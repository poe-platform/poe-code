import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat, symlink, appendFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { adapterControls } from './adapter-controls.mjs';
import { typedRawControls } from './typed-raw-controls.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const execution = realpathSync(join(owned, '../execution'));
const repository = realpathSync(join(owned, '../../../..'));
const handoffPath = '/tmp/safe-bash-current-comparison-bridge-implementation-result.txt';
const receiptPath = '/tmp/safe-bash-execution-bridge-author-handoff-20260827.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const readJson = async filename => JSON.parse(await readFile(filename));
const handoff = await readFile(handoffPath);
assert.match(handoff.toString(), /stopped for different review/);
const receipt = await readJson(receiptPath);
const manifestBytes = await readFile(join(execution, 'MANIFEST.json'));
assert.equal(hash(manifestBytes), receipt.manifestSha256);
const delivery = JSON.parse(manifestBytes);
const revisionMode = process.argv[3] === '--r1-r2';
assert.ok(process.argv[3] === undefined || revisionMode, 'only the explicit R1/R2 revision is accepted');
let revisionBinding = null;
if (revisionMode) {
  const revisionPath = join(execution, 'revisions/r1-r2/REVISION.json');
  const revisionBytes = await readFile(revisionPath);
  const revision = JSON.parse(revisionBytes);
  const fixHandoff = await readFile('/tmp/safe-bash-current-comparison-bridge-fix-result.txt');
  assert.match(fixHandoff.toString(), /Stopped for independent recheck/);
  assert.deepEqual(revision.scope, ['R1', 'R2']);
  assert.equal(revision.originalDelivery.sha256, receipt.manifestSha256);
  assert.equal(revision.onlyChangedExistingFile.path, 'expanded.mjs');
  assert.equal(revision.onlyChangedExistingFile.afterSha256, '761bf2422d03f5dcc6162df7d42e1d2fd2bb974ec2e42b9fe0d51e3e406fe3e2');
  revisionBinding = { path: revisionPath, sha256: hash(revisionBytes), fixHandoffSha256: hash(fixHandoff), revision };
}
const destination = join(owned, process.argv[2] ?? 'attempt-001');
assert.equal(dirname(destination), owned);
await mkdir(destination);
const temporary = await mkdtemp(join(realpathSync('/tmp'), 'safe-bash-independent-bridge-'));
const publish = async (name, value) => writeFile(join(destination, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
async function snapshot() {
  const files = [];
  let total = 0;
  async function visit(relative = '') {
    for (const name of (await readdir(join(execution, relative))).sort()) {
      const filename = join(relative, name), stat = await lstat(join(execution, filename));
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) await visit(filename);
      else {
        assert.ok(stat.isFile() && stat.size <= 16 * 1024 * 1024 && files.length < 1024);
        const bytes = await readFile(join(execution, filename));
        total += bytes.length;
        assert.ok(total <= 64 * 1024 * 1024);
        files.push({ path: filename, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await visit();
  return { files, totalBytes: total, sha256: hash(JSON.stringify(files)) };
}
const before = await snapshot();
const expectedFiles = [...delivery.files, { path: 'MANIFEST.json', bytes: manifestBytes.length, sha256: hash(manifestBytes) }];
if (revisionBinding) {
  const revision = revisionBinding.revision;
  const original = expectedFiles.find(record => record.path === 'expanded.mjs');
  const archived = await readFile(join(execution, 'revisions/r1-r2/expanded.before.mjs.data'));
  assert.equal(hash(archived), original.sha256);
  Object.assign(original, revision.currentSourceOverride['expanded.mjs']);
  for (const record of revision.files) expectedFiles.push({ ...record, path: `revisions/r1-r2/${record.path}` });
  const revisionBytes = await readFile(revisionBinding.path);
  expectedFiles.push({ path: 'revisions/r1-r2/REVISION.json', bytes: revisionBytes.length, sha256: hash(revisionBytes) });
}
assert.equal(before.files.length, expectedFiles.length);
for (const record of expectedFiles) assert.deepEqual(before.files.find(item => item.path === record.path), record);
await publish('source-before.json', { handoffPath, handoffSha256: hash(handoff), receiptPath, receipt, manifestSha256: hash(manifestBytes), revisionBinding, ...before });
await writeFile(join(destination, 'author-stopped-handoff.txt'), handoff, { flag: 'wx' });
const { loadCohorts, planCases, preparationCommit, sealHashes } = await import(pathToFileURL(join(execution, 'cohorts.mjs')));
const { loadBinding, verifyClosure } = await import(pathToFileURL(join(execution, 'binding.mjs')));
const { runAttempt, groupExists } = await import(pathToFileURL(join(execution, 'supervise.mjs')));
const { assessAttempt } = await import(pathToFileURL(join(execution, 'assessment.mjs')));
const { sentinelLimits, limitsFor } = await import(pathToFileURL(join(execution, 'limits.mjs')));
const cohorts = loadCohorts(), plan = planCases(cohorts);
const staticChecks = [];
function check(name, operation) {
  try { const detail = operation(); staticChecks.push({ name, satisfied: true, detail }); }
  catch (error) { staticChecks.push({ name, satisfied: false, error: String(error.stack ?? error) }); }
}
check('exact selected recipes/goldens and profile counts, no new24 prerequisite', () => {
  assert.equal(plan.length, 1032);
  for (const profile of ['original', 'aligned']) {
    const selected = plan.filter(row => row.profile === profile);
    assert.equal(selected.length, 448);
    for (const row of selected) {
      const source = cohorts.original.find(item => item.id === row.id);
      assert.deepEqual(row.specimen, source.recipe);
      assert.deepEqual(row.expected, source[profile === 'original' ? 'originalOracle' : 'alignedOracle'].observation);
    }
  }
  const breadth = plan.filter(row => row.profile === 'breadth');
  assert.equal(breadth.length, 136);
  assert.equal(breadth.filter(row => row.specimen.cohort === 'direct-diagnostic').length, 14);
  for (const row of breadth) assert.deepEqual(row.specimen, cohorts.breadth.find(item => item.id === row.id).recipe);
  return { original: 448, aligned: 448, breadth: 136, breadthRecipes: { targets: 54, controls: 7, diagnostics: 7 }, measured: 0 };
});
for (const [local, historical] of [['expanded-common.mjs', '0294afb6e690433aed994868e5ed437ecf58ae48:benchmarks/expanded/common.mjs'], ['breadth-assess.mjs', '849dbf18b1e865c7d12927c11f0e20ba0555c540:benchmarks/reports/baseline-only-20260827/coverage-execution/assess.mjs']]) {
  const bytes = await readFile(join(execution, 'reuse', local));
  check(`byte-identical historical predicate ${local}`, () => { assert.equal(hash(bytes), hash(execFileSync('git', ['show', historical], { cwd: repository, maxBuffer: 1048576 }))); return { historical, sha256: hash(bytes) }; });
}
check('fixed distinct expanded/breadth envelopes', () => {
  assert.equal(limitsFor('original', {}).guestMs, 5000); assert.equal(limitsFor('original', {}).totalMs, 28000);
  assert.equal(limitsFor('breadth', { configuration: 'default' }).guestMs, 30000); assert.equal(limitsFor('breadth', { configuration: 'default' }).totalMs, 50000);
  assert.equal(limitsFor('breadth', { configuration: 'python' }).guestMs, 120000); assert.equal(limitsFor('breadth', { configuration: 'python' }).totalMs, 140000);
});
const cli = [];
for (const mode of ['PREPARE', 'PREFLIGHT', 'MEASURE']) {
  const child = spawnSync(process.execPath, [join(execution, 'run.mjs'), mode], { cwd: temporary, env: { PATH: '/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1048576 });
  cli.push({ mode, status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, error: child.error ? String(child.error) : null });
  check(`CLI ${mode} without ROOT cannot import products`, () => { assert.equal(child.status, mode === 'PREPARE' ? 0 : 2); assert.equal(child.signal, null); assert.equal(JSON.parse(child.stdout).productImports, 0); });
}
await publish('cli.json', cli);
const adapters = await adapterControls(execution, cohorts.profiles.breadth);
await publish('adapter-controls.json', adapters);
const typedRaw = revisionMode ? await typedRawControls(execution) : [];
if (revisionMode) await publish('typed-raw-controls.json', typedRaw);

const host = { root: temporary, cwd: temporary, env: { PATH: '/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } };
const binary = Buffer.from([0, 1, 127, 128, 254, 255]);
const expected = { stdout: binary.toString('base64'), stderr: Buffer.from('independent\n').toString('base64'), exitCode: 0, entries: { binary: { type: 'file', bytes: binary.toString('base64') } } };
const template = await readFile(join(owned, 'sentinel.mjs.data'));
const variants = ['clean', 'wrong-output', 'wrong-vfs', 'wrong-status', 'module-clean', 'worker-leak', 'pipe-leak', 'crash', 'late-rejection', 'malformed', 'oversize', 'unbound-module', 'changed-entry', 'wrong-public-entry'];
const attempts = [];
for (const [index, mode] of variants.entries()) {
  const request = { id: `independent/${mode}`, nonce: randomUUID(), synthetic: true, engine: 'independent-sentinel-not-product', profile: 'original', mode: ['clean', 'wrong-output', 'wrong-vfs', 'wrong-status'].includes(mode) ? mode : 'clean', expected, caps: { ...sentinelLimits, naturalMs: 240 }, heapMiB: 128, host };
  let moduleRoot;
  if (index >= 4) {
    moduleRoot = join(temporary, mode); await mkdir(moduleRoot);
    const packageBytes = Buffer.from(JSON.stringify({ name: 'independent-bridge-sentinel', version: '0.0.0-synthetic', type: 'module', exports: './index.mjs' }));
    const packagePath = join(moduleRoot, 'package.json'), entry = join(moduleRoot, 'index.mjs');
    await writeFile(packagePath, packageBytes); await writeFile(entry, template);
    await writeFile(join(moduleRoot, 'fixture.json'), JSON.stringify({ mode, reportBytes: request.caps.reportBytes }));
    await writeFile(join(moduleRoot, 'unlisted.mjs'), 'export const syntheticOnly = true;\n');
    const files = { [packagePath]: { bytes: packageBytes.length, sha256: hash(packageBytes) }, [entry]: { bytes: template.length, sha256: hash(template) } };
    request.syntheticModule = { packageName: 'independent-bridge-sentinel', packagePath, entry: mode === 'wrong-public-entry' ? join(moduleRoot, 'unlisted.mjs') : entry, files };
    if (mode === 'changed-entry') await writeFile(entry, Buffer.concat([template, Buffer.from('\nexport const changed = true;\n')]));
  }
  const stem = `sentinel-${String(index + 1).padStart(2, '0')}-${mode}`;
  let journal = Promise.resolve();
  const attempt = await runAttempt(request, { onEvent: event => { journal = journal.then(() => appendFile(join(destination, `${stem}.jsonl`), `${JSON.stringify(event)}\n`)); return journal; } });
  await journal;
  const assessment = assessAttempt(request, attempt);
  const semantic = mode.startsWith('wrong-') && mode !== 'wrong-public-entry';
  const positive = ['clean', 'module-clean'].includes(mode);
  const outcomeSatisfied = positive ? attempt.clean && assessment.status === 'pass' && attempt.signals.length === 0 : semantic ? attempt.clean && assessment.status === 'fail' : !attempt.clean && assessment.status !== 'pass';
  const resources = {};
  for (const name of ['imported.json', 'owned-worker.json', 'owned-child.json']) if (moduleRoot) {
    try { resources[name] = await readJson(join(moduleRoot, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const control = { mode, controlSatisfied: outcomeSatisfied && attempt.groupGone && (!['worker-leak', 'pipe-leak'].includes(mode) || Boolean(attempt.result) && attempt.signals.length > 0), observationStatus: assessment.status, clean: attempt.clean, groupGone: attempt.groupGone, signals: attempt.signals, resources };
  await publish(`${stem}.json`, { request, attempt, assessment, control });
  attempts.push({ ...control, raw: `${stem}.json`, coordinatorPid: attempt.coordinatorPid, enginePid: attempt.enginePid ?? null });
  console.log(JSON.stringify(control));
  if (!attempt.groupGone) break;
}

const bindingsRoot = join(temporary, 'binding-controls'); await mkdir(bindingsRoot);
const artifact = async (root, name, content) => { const bytes = Buffer.from(content); await writeFile(join(root, name), bytes); return { root, path: name, bytes: bytes.length, sha256: hash(bytes) }; };
const source = await artifact(bindingsRoot, 'synthetic-source.data', 'not product source');
const pack = await artifact(bindingsRoot, 'synthetic-pack.data', 'not a product archive');
const node = await artifact(bindingsRoot, 'not-an-executable.data', 'static binding check only');
const engines = {};
for (const name of ['virtual-bash', 'just-bash']) {
  const root = join(bindingsRoot, name); await mkdir(root);
  const records = [];
  for (const [filename, content] of [['package.json', JSON.stringify({ name, version: name === 'just-bash' ? '3.4.2' : '0.0.0', exports: './index.mjs', type: 'module' })], ['index.mjs', 'throw new Error("SYNTHETIC BINDING ONLY: MUST NEVER IMPORT");'], ['lock.json', '{}'], ['asset.bin', 'synthetic asset']]) {
    const record = await artifact(root, filename, content); delete record.root; records.push(record);
  }
  engines[name] = { closure: { root, files: records }, packageJson: 'package.json', entry: 'index.mjs', locks: ['lock.json'], assets: ['asset.bin'], heapMiB: 128 };
}
const runnerFiles = before.files.filter(record => record.path.endsWith('.mjs') && !record.path.startsWith('author-evidence/'));
const binding = { schema: 'safe-bash.execution-binding.v1', preparationCommit, seals: sealHashes, profiles: ['original', 'aligned', 'breadth'], candidate: { commit: '1'.repeat(40), gitTree: '2'.repeat(40), sourceSha256: source.sha256, source, packSha256: pack.sha256, pack }, node, runner: { root: execution, files: runnerFiles }, engines, host };
const bindingCases = [];
async function refusal(name, transform, predicate = () => true, staleReceipt = false) {
  const copy = structuredClone(binding); transform(copy);
  const bytes = Buffer.from(JSON.stringify(copy));
  const bindingPath = join(bindingsRoot, `${name}.json`), rootReceiptPath = join(bindingsRoot, `${name}-receipt.json`);
  const rootReceipt = Buffer.from(JSON.stringify({ authority: 'ROOT', purpose: 'MEASURE_HISTORICAL', bindingSha256: staleReceipt ? '0'.repeat(64) : hash(bytes), candidateCommit: copy.candidate.commit, executionAuthorized: true, timingAuthorized: false, qualificationAccepted: true }));
  await writeFile(bindingPath, bytes); await writeFile(rootReceiptPath, rootReceipt);
  try { const result = loadBinding(bindingPath, rootReceiptPath, hash(rootReceipt)); bindingCases.push({ name, refused: false, result, syntheticReceiptNotActualAuthority: true }); }
  catch (error) { bindingCases.push({ name, refused: true, expectedReason: predicate(error), error: { message: String(error.message), actual: error.actual, expected: error.expected }, syntheticReceiptNotActualAuthority: true }); }
}
await refusal('synthetic-cannot-masquerade-as-just-bash342', () => {}, error => error.expected === '70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c');
await refusal('profile-rebinding', value => { value.profiles = ['aligned', 'original', 'breadth']; });
await refusal('source-rebinding', value => { value.candidate.source.sha256 = '0'.repeat(64); value.candidate.sourceSha256 = '0'.repeat(64); });
await refusal('pack-rebinding', value => { value.candidate.pack.sha256 = '0'.repeat(64); value.candidate.packSha256 = '0'.repeat(64); });
await refusal('manifest-rebinding', () => {}, () => true, true);
await refusal('asset-rebinding', value => { value.engines['virtual-bash'].closure.files.find(record => record.path === 'asset.bin').sha256 = '0'.repeat(64); });
await refusal('path-traversal', value => { value.candidate.source.path = '../synthetic-source.data'; });
await symlink(join(bindingsRoot, 'synthetic-source.data'), join(bindingsRoot, 'source-link'));
await refusal('symlink-path', value => { value.candidate.source.path = 'source-link'; });
check('exact synthetic closure positive, no import', () => { assert.equal(Object.keys(verifyClosure(binding.engines['virtual-bash'].closure).files).length, 4); });
check('missing ROOT binding is explicitly unbound', () => { assert.equal(loadBinding().status, 'WAITING_ROOT'); });
await publish('binding-controls.json', { syntheticReceiptsOnly: true, importedPackages: 0, cases: bindingCases });
await publish('static-controls.json', staticChecks);
const cleanup = attempts.map(attempt => ({ mode: attempt.mode, coordinatorPid: attempt.coordinatorPid, enginePid: attempt.enginePid, groupExists: groupExists(attempt.coordinatorPid), descendant: attempt.resources['owned-child.json']?.pid ?? null }));
for (const entry of cleanup) if (entry.descendant) {
  try { process.kill(entry.descendant, 0); entry.descendantExists = true; } catch (error) { entry.descendantExists = error.code === 'ESRCH' ? false : null; }
}
const after = await snapshot();
await publish('source-after.json', after);
const sourceStable = before.sha256 === after.sha256;
const reviewerSources = [];
for (const name of ['verify.mjs', 'adapter-controls.mjs', 'sentinel.mjs.data', 'typed-raw-controls.mjs']) { const bytes = await readFile(join(owned, name)); reviewerSources.push({ path: name, bytes: bytes.length, sha256: hash(bytes) }); }
const summary = { status: 'HOLD', scope: 'independent synthetic bridge review, not products', authorManifestSha256: receipt.manifestSha256, executionTreeBefore: before.sha256, executionTreeAfter: after.sha256, sourceStable, temporary, reviewerSources, process: { node: process.version, executable: realpathSync(process.execPath), platform: process.platform, arch: process.arch }, counters: { sentinelAttempts: attempts.length, sentinelCoordinators: attempts.length, sentinelEngines: attempts.filter(attempt => attempt.enginePid).length, extraNodeDescendants: cleanup.filter(entry => entry.descendant).length, workerThreads: attempts.filter(attempt => attempt.resources['owned-worker.json']).length, cliNegativeOrPreparationChildren: cli.length, syntheticAdapterInvocations: adapters.length, actualProductImports: 0, mainCohortObservations: 0, nativeOracleCalls: 0, networkSocketsOpened: 0 }, staticChecks, bindingCases, adapterIssues: adapters.filter(row => row.issues.length).map(row => ({ profile: row.profile, engine: row.engine, configuration: row.configuration, issues: row.issues })), attempts, cleanup };
summary.revisionBinding = revisionBinding;
summary.typedRawControls = typedRaw;
summary.counters.targetedTypedRawAdapterInvocations = typedRaw.length;
summary.controlsSatisfied = sourceStable && staticChecks.every(row => row.satisfied) && bindingCases.every(row => row.refused && row.expectedReason) && attempts.length === variants.length && attempts.every(row => row.controlSatisfied) && cleanup.every(row => row.groupExists === false && row.descendantExists !== true) && typedRaw.every(row => row.satisfied);
summary.status = summary.controlsSatisfied && summary.adapterIssues.length === 0 ? 'GO_BRIDGE_ONLY' : 'HOLD';
await publish('summary.json', summary);
console.log(JSON.stringify({ destination, status: summary.status, sourceStable, controlsSatisfied: summary.controlsSatisfied, adapterIssues: summary.adapterIssues, counters: summary.counters }, null, 2));
process.exitCode = summary.status === 'GO_BRIDGE_ONLY' ? 0 : 1;
