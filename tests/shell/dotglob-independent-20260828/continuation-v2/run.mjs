import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { stageCandidate, inspectBuiltPack } from '../execution-v2/candidate-stage.mjs';
import { ownRoot, prepareRealFixture } from '../execution-v2/stage-baseline.mjs';
import { installAbsentBuiltin, installStackReversion } from '../execution-v2/mutants.mjs';
import { installBehaviorMutant } from '../execution-v2/source-mutants.mjs';
import { hash, inventory, copyRegular, save } from '../execution-prep-v1/artifacts.mjs';
import { assertInventory, digestFile } from '../execution-prep-v1/admission.mjs';
import { supervise, classify } from '../execution-prep-v1/protocol.mjs';
import { copyHarness, makeManifest, saveManifest } from './stage.mjs';
import { history, carried, correctedRow, matrix, bindLoads, checkMutant, historyEncodedSha256 } from './proof.mjs';
import { runGuards } from './guards.mjs';

const revision = process.argv[2], label = process.argv[3];
assert.match(revision ?? '', /^[a-f0-9]{40}$/u); assert.match(label ?? '', /^[a-z0-9-]+$/u);
const output = join(ownRoot, 'continuation-evidence-v2', label);
assert.equal(existsSync(output), false, 'fresh output only'); mkdirSync(output, { recursive: true });
const started = Date.now();
let stage, unsafe = false, outputBytes = 0;
const result = { role: 'root-authorized single narrow DOTGLOB continuation', revision, label, started: new Date(started).toISOString(), accepted: false, tools: [], layouts: [], mutants: [], guards: [], children: [], counts: { product: 0, guard: 0, tool: 0 } };
async function execute(kind, args, options) {
  assert.ok(Date.now() - started < 15 * 60 * 1000, '15-minute total ceiling');
  result.counts[kind]++;
  assert.ok(result.counts.product + result.counts.guard <= 48 && result.counts.tool <= 4, 'sealed child budget');
  const run = await supervise(stage.binding.node.path, args, { ...options, timeoutMs: kind === 'tool' ? 60000 : kind === 'guard' ? 10000 : 30000, maxBytes: kind === 'tool' ? 2 * 1024 * 1024 : kind === 'guard' ? 1024 * 1024 : 256 * 1024 });
  result.children.push({ kind, pid: run.pid, code: run.code, signal: run.signal, closeObserved: run.closeObserved, groupAbsent: run.groupAbsent, failure: run.failure, spawnError: run.spawnError, bytes: run.bytes });
  outputBytes += run.bytes;
  if (run.failure || run.spawnError || run.signal || !run.closeObserved || !run.groupAbsent || outputBytes > 64 * 1024 * 1024) { unsafe = true; result.unsafeRun = run; throw new Error('unsafe resource/cleanup result; no further execution'); }
  return run;
}
async function invoke(kind, bound, id, options = {}) {
  const run = await execute(kind, [...bound.flags, bound.worker, id], { cwd: bound.manifest.appRoot, env: bound.env });
  if (kind === 'product' && run.code !== 0 && run.code !== 1 && !options.expectedGuard) { unsafe = true; result.unsafeRun = run; throw new Error('unexpected product admission/loader exit; stop before further children'); }
  return run;
}
function app(stage, name, packageSource) {
  const appRoot = join(stage.work, name); mkdirSync(appRoot); copyHarness(stage, appRoot);
  if (packageSource) copyRegular(packageSource, join(appRoot, 'node_modules/virtual-bash'));
  return appRoot;
}
function bind(layout, appRoot, packageRoot, name, extra = {}) {
  const scratchRoot = join(stage.work, 'scratch-' + name); mkdirSync(scratchRoot); prepareRealFixture(scratchRoot, 'candidate-real');
  const manifest = makeManifest(stage, revision, layout, appRoot, packageRoot, scratchRoot, extra);
  return saveManifest(stage, name, manifest);
}
async function observation(bound, id) {
  const { manifest } = bound, appBefore = inventory(manifest.appRoot);
  const run = await invoke('product', bound, id);
  const record = { layout: manifest.layout, id, run, manifestSha256: bound.sha256, rootModule: manifest.rootModule, rootSha256: hash(readFileSync(manifest.rootModule)), runtimeModule: manifest.runtimeModule, runtimeSha256: hash(readFileSync(manifest.runtimeModule)), contractsModule: manifest.contractsModule, contractsSha256: hash(readFileSync(manifest.contractsModule)), boundary: manifest.boundary, expectedRootURL: manifest.expectedRootURL, appBefore, appAfter: inventory(manifest.appRoot) };
  assert.deepEqual(record.appAfter, appBefore, 'exact append-aware app integrity');
  for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  record.classification = classify(run, [id], { modulePath: record.runtimeModule, moduleSha256: record.runtimeSha256 });
  if (!record.classification.coherent) { unsafe = true; result.unsafeObservation = record; throw new Error('incoherent or incomplete product capture'); }
  if (record.classification.observations.some(row => row.cleanupErrors.length !== 0)) { unsafe = true; result.unsafeObservation = record; throw new Error('owned cleanup failure stops further execution'); }
  if (record.classification.failed.some(failed => !record.classification.observations.find(row => row.id === failed)?.error?.startsWith('AssertionError '))) { unsafe = true; result.unsafeObservation = record; throw new Error('non-assertion execution/cleanup error is not a semantic failure'); }
  console.log(JSON.stringify({ layout: manifest.layout, id, accepted: record.classification.accepted, failed: record.classification.failed }));
  return record;
}
async function r24(layout, appRoot, packageRoot, glob, original, build, pack, install, move) {
  const proofRoot = join(stage.work, 'proof-' + layout); mkdirSync(proofRoot);
  const proof = { kind: 'dotglob-R24-v2-local-plus-carried', layout, candidate: stage.candidate, packageSha256: stage.pack.sha256, candidateInputs: stage.candidateInputs, glob, build, pack, install, move, mutants: result.mutants, guards: result.guards };
  const proofPath = join(proofRoot, 'proof.json'); save(proofPath, proof);
  const bound = bind(layout, appRoot, packageRoot, 'r24-' + layout, { historyPath: original, sourceRoot: stage.sourceRoot, packPath: stage.pack.path, proof: { path: proofPath, sha256: hash(readFileSync(proofPath)) } });
  bound.manifest.trees.push(...[proofRoot, stage.historyRoot, stage.sourceRoot, join(stage.work, 'packs')].map(root => ({ root, files: inventory(root) })));
  const complete = saveManifest(stage, 'r24-final-' + layout, bound.manifest);
  return observation(complete, 'R24-v2');
}

try {
  correctedRow();
  stage = stageCandidate(revision); result.work = stage.work;
  result.binding = { candidate: stage.candidate, composition: stage.candidateTree, acceptedComposition: stage.binding.acceptedComposition, candidateInputs: stage.candidateInputs, sourceBefore: stage.sourceBefore, node: stage.binding.node, npmVersion: stage.npm.version, preparationRevision: revision };
  const seal = JSON.parse(readFileSync(join(stage.harnessRoot, 'continuation-v2/SEAL.json')));
  for (const [name, expected] of Object.entries(seal.files)) { digestFile(join(stage.harnessRoot, name), expected); digestFile(join(ownRoot, name), expected); }
  stage.historyRoot = join(stage.work, 'historical-2e2bfa68'); mkdirSync(stage.historyRoot);
  const original = join(stage.historyRoot, 'original.json.gz.base64');
  writeFileSync(original, digestFile(join(stage.harnessRoot, 'candidate-evidence-v1/review-01/RESULT.json.gz.base64'), historyEncodedSha256), { flag: 'wx' });
  const old = history(original); result.carried = carried(old, stage.binding);
  const buildRun = await execute('tool', [stage.npmCli, 'run', 'build'], { cwd: stage.buildRoot, env: stage.env });
  const build = { command: 'npm run build', run: buildRun }; result.tools.push(build); assert.equal(buildRun.code, 0);
  const packRun = await execute('tool', [stage.npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', join(stage.work, 'packs')], { cwd: stage.buildRoot, env: stage.env });
  const pack = { command: 'npm pack --json --ignore-scripts', run: packRun }; result.tools.push(pack); assert.equal(packRun.code, 0);
  stage.pack = inspectBuiltPack(stage, join(stage.work, 'packs', JSON.parse(packRun.stdout)[0].filename));
  assert.deepEqual(stage.pack.members, old.pack.members);
  result.pack = { sha256: stage.pack.sha256, members: stage.pack.members, changed: stage.pack.changed, metadata: stage.pack.metadata };
  writeFileSync(join(output, 'PACKAGE.tgz.base64'), readFileSync(stage.pack.path).toString('base64') + '\n', { flag: 'wx' });
  const sourceApp = app(stage, 'source-app');
  const source = { layout: 'source', appRoot: sourceApp, packageRoot: stage.buildRoot, glob: await observation(bind('source', sourceApp, stage.buildRoot, 'source-glob'), 'G039-v2') }; result.layouts.push(source);
  const installedApp = app(stage, 'installed-app'); writeFileSync(join(installedApp, 'package.json'), '{"private":true,"type":"module"}\n', { flag: 'wx' });
  const installArgs = ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', stage.pack.path];
  const installRun = await execute('tool', [stage.npmCli, ...installArgs], { cwd: installedApp, env: stage.env });
  const install = { args: installArgs, run: installRun }; result.tools.push(install); assert.equal(installRun.code, 0);
  const installedPackage = join(installedApp, 'node_modules/virtual-bash'); assertInventory(installedPackage, stage.pack.members);
  const installedBound = bind('installed', installedApp, installedPackage, 'installed-glob');
  const installed = { layout: 'installed', appRoot: installedApp, packageRoot: installedPackage, glob: await observation(installedBound, 'G039-v2') }; result.layouts.push(installed);
  await runGuards(stage, installedBound, invoke, result.guards);
  for (const [id, predicate] of matrix) {
    const appRoot = app(stage, 'mutant-' + id, installedPackage), packageRoot = join(appRoot, 'node_modules/virtual-bash');
    const mutation = id === 'absent-builtin' ? installAbsentBuiltin(packageRoot, stage.pack.members['dist/shell/runtime.js'].sha256) : id === 'accepted-stack-reversion' ? installStackReversion(packageRoot, stage.packageRoot, stage.binding) : installBehaviorMutant(packageRoot, id, stage.pack.members['dist/shell/runtime.js'].sha256);
    const mutant = await observation(bind('moved', appRoot, packageRoot, 'changed-' + id, { mutant: mutation }), predicate);
    const mutantInventory = inventory(packageRoot);
    for (const [name, entry] of Object.entries(stage.pack.members)) if (/^dist\/shell\/(?:runtime|shell)\./u.test(name)) writeFileSync(join(packageRoot, name), digestFile(join(installedPackage, name), entry.sha256));
    assertInventory(packageRoot, stage.pack.members);
    const restored = await observation(bind('moved', appRoot, packageRoot, 'restored-' + id), predicate);
    const record = { id, mutation, mutant, mutantInventory, restored, restoredInventory: inventory(packageRoot) }; result.mutants.push(record);
    try { record.verdict = checkMutant(record, stage.pack.members); } catch (error) { record.verdict = { id, killed: false, error: String(error) }; }
    console.log(JSON.stringify({ mutant: id, verdict: record.verdict }));
  }
  source.r24 = await r24('source', sourceApp, stage.buildRoot, source.glob, original, build, pack, install, null);
  installed.r24 = await r24('installed', installedApp, installedPackage, installed.glob, original, build, pack, install, null);
  const beforeMove = inventory(installedApp), movedApp = join(stage.work, 'physically-moved-app'); renameSync(installedApp, movedApp);
  const move = { from: installedApp, to: movedApp, fromAbsent: !existsSync(installedApp), before: beforeMove, after: inventory(movedApp) };
  assert.equal(move.fromAbsent, true); assert.deepEqual(move.before, move.after); result.move = move;
  const movedPackage = join(movedApp, 'node_modules/virtual-bash');
  const moved = { layout: 'moved', appRoot: movedApp, packageRoot: movedPackage, glob: await observation(bind('moved', movedApp, movedPackage, 'moved-glob'), 'G039-v2') }; result.layouts.push(moved);
  moved.r24 = await r24('moved', movedApp, movedPackage, moved.glob, original, build, pack, install, move);
  assert.deepEqual(inventory(stage.sourceRoot), stage.sourceBefore);
  assert.deepEqual(inventory(stage.npm.root), stage.npm.files);
  for (const tool of stage.binding.typeTools) assertInventory(join(stage.moved, 'node_modules', tool.name), tool.inventory.files);
  assertInventory(movedPackage, stage.pack.members); assert.equal(hash(readFileSync(stage.pack.path)), stage.pack.sha256);
  result.sourceAfter = inventory(stage.sourceRoot); result.integrity = 'source/tool/pack/package/each-app pre-post verified';
  result.accepted = result.layouts.length === 3 && result.layouts.every(row => row.glob.classification.accepted && row.r24.classification.accepted) && result.mutants.length === 11 && result.mutants.every(row => row.verdict.killed) && result.guards.length === 9 && result.guards.every(row => row.accepted);
} catch (error) { result.error = String(error?.stack ?? error); result.accepted = false; }
finally {
  result.unsafeStop = unsafe;
  if (stage) {
    try { result.finalSourceCensus = inventory(stage.sourceRoot); result.finalNodeSha256 = hash(readFileSync(stage.binding.node.path)); }
    catch (error) { result.finalInspectionError = String(error); result.accepted = false; }
    rmSync(stage.work, { recursive: true, force: true }); result.cleanup = { exactOwnedRootRemoved: stage.work, absent: !existsSync(stage.work) };
  } else result.cleanup = { noReturnedStage: true };
  result.finished = new Date().toISOString(); result.childOutputBytes = outputBytes;
  const raw = Buffer.from(JSON.stringify(result, null, 2) + '\n'); assert.ok(raw.length <= 64 * 1024 * 1024, 'retained result ceiling');
  const encoded = Buffer.from(gzipSync(raw).toString('base64') + '\n'); writeFileSync(join(output, 'RESULT.json.gz.base64'), encoded, { flag: 'wx' });
  save(join(output, 'RESULT-SEAL.json'), { sha256: hash(raw), bytes: raw.length, encodedSha256: hash(encoded), accepted: result.accepted, counts: result.counts, error: result.error ?? null, unsafeStop: unsafe, cleanup: result.cleanup });
}
console.log(JSON.stringify({ output, accepted: result.accepted, counts: result.counts, error: result.error ?? null, unsafeStop: unsafe, cleanup: result.cleanup }));
process.exitCode = result.accepted ? 0 : 1;
