import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { stageCandidate, inspectBuiltPack, candidatePack } from './candidate-stage.mjs';
import { prepareRealFixture, ownRoot } from './stage-baseline.mjs';
import { hash, save, inventory, copyRegular } from '../execution-prep-v1/artifacts.mjs';
import { assertInventory } from '../execution-prep-v1/admission.mjs';
import { supervise, classify } from '../execution-prep-v1/protocol.mjs';
import { cases } from '../execution-prep-v1/plan.mjs';
import { candidateTypes } from './type-runner.mjs';
import { checkTypes } from './guards.mjs';
import { candidateGuards } from './candidate-guards.mjs';
import { installAbsentBuiltin, installStackReversion } from './mutants.mjs';
import { installBehaviorMutant, behaviorMutants } from './source-mutants.mjs';

const revision = process.argv[2], label = process.argv[3];
assert.match(revision ?? '', /^[a-f0-9]{40}$/u); assert.match(label ?? '', /^[a-z0-9-]+$/u);
const evidence = join(ownRoot, 'candidate-evidence-v1', label);
assert.equal(existsSync(evidence), false, 'no output reuse'); mkdirSync(evidence, { recursive: true });
const started = Date.now(), counts = { product: 0, guard: 0, type: 0, tool: 0 };
let stage, infrastructureFailure = false, bytesRetained = 0;
const result = { role: 'one bounded independent DOTGLOB candidate replay', revision, label, started: new Date(started).toISOString(), counts, layouts: [], mutants: [], tools: [], accepted: false };
async function execute(kind, args, options) {
  assert.ok(Date.now() - started < 20 * 60 * 1000, 'total20-minute admission');
  counts[kind]++;
  assert.ok(counts.product + counts.guard <= 240 && counts.type <= 5 && counts.tool <= 16, 'presealed child ceilings');
  const timeoutMs = kind === 'tool' ? 60000 : kind === 'type' ? 20000 : kind === 'guard' ? 10000 : 30000;
  const maxBytes = kind === 'tool' || kind === 'type' ? 2 * 1024 * 1024 : kind === 'guard' ? 1024 * 1024 : 256 * 1024;
  const run = await supervise(stage.binding.node.path, args, { ...options, timeoutMs, maxBytes });
  bytesRetained += run.bytes;
  if (run.failure || run.spawnError || run.signal || !run.closeObserved || !run.groupAbsent || bytesRetained > 64 * 1024 * 1024) {
    infrastructureFailure = true; result.fatalRun = run;
    throw new Error('resource/cleanup failure stops further execution');
  }
  return run;
}
function manifestFor(layout, packageRoot, harnessRoot, scratchRoot, extra = {}) {
  const files = inventory(packageRoot), runtimeModule = join(packageRoot, 'dist/shell/runtime.js'), rootModule = join(packageRoot, 'dist/index.js');
  return { kind: 'dotglob-product-load-v2', acceptedComposition: stage.binding.acceptedComposition, candidate: stage.candidate, rootAuthorizedCandidate: stage.candidate, preparationRevision: revision, packageSha256: candidatePack, candidateInputs: stage.candidateInputs, layout, node: stage.binding.node, packageRoot, harnessRoot, scratchRoot, runtimeModule, rootModule, rootDeclaration: join(packageRoot, 'dist/index.d.ts'), patternModule: join(packageRoot, 'dist/shell/pattern.js'), forbiddenSource: stage.manifest.forbiddenSource, trees: [{ root: packageRoot, files }, { root: harnessRoot, files: inventory(harnessRoot) }], requiredFiles: [runtimeModule, rootModule, join(packageRoot, 'dist/index.d.ts')], binding: { defaultNames: stage.binding.defaultNames }, ...extra };
}
async function layoutRun(layout, packageRoot, consumerRoot, packed) {
  const harnessRoot = join(consumerRoot, 'harness');
  if (!existsSync(harnessRoot)) copyRegular(stage.harnessRoot, harnessRoot);
  const scratchRoot = join(stage.work, 'scratch-' + layout); mkdirSync(scratchRoot); prepareRealFixture(scratchRoot, 'candidate-real');
  const manifest = manifestFor(layout, packageRoot, harnessRoot, scratchRoot);
  const manifestPath = join(stage.work, 'manifest-' + layout + '.json'); save(manifestPath, manifest);
  const worker = join(harnessRoot, 'execution-v2/product-worker.mjs');
  const flags = ['--permission', ...manifest.trees.map(tree => `--allow-fs-read=${tree.root}`), `--allow-fs-read=${manifestPath}`, `--allow-fs-read=${manifest.node.path}`, `--allow-fs-read=${scratchRoot}`, `--allow-fs-write=${scratchRoot}`];
  const env = { PATH: dirname(manifest.node.path), LC_ALL: 'C', TZ: 'UTC', DOTGLOB_MANIFEST: manifestPath, DOTGLOB_MANIFEST_SHA256: hash(readFileSync(manifestPath)) };
  const row = { layout, packageRoot, runtimeModule: manifest.runtimeModule, runtimeSha256: hash(readFileSync(manifest.runtimeModule)), rootModule: manifest.rootModule, rootSha256: hash(readFileSync(manifest.rootModule)), members: inventory(packageRoot), before: inventory(packageRoot), runs: [], sourceDenial: null, late: null, forbiddenSource: manifest.forbiddenSource, defaultNames: [...stage.binding.defaultNames], exports: packed.metadata.exports, dependencies: packed.metadata.dependencies ?? {}, manifest, manifestSha256: env.DOTGLOB_MANIFEST_SHA256 };
  result.layouts.push(row);
  for (const cohort of ['commands', 'unsupported', 'globs', 'states', 'overlay', 'procedures']) {
    const rows = cases()[cohort];
    for (let first = 0; first < rows.length;) {
      if (cohort === 'procedures' && rows[first].id === 'R24') { first++; continue; }
      const count = cohort === 'procedures' ? 1 : Math.min(32, rows.length - first), ids = rows.slice(first, first + count).map(value => value.id);
      const run = await execute('product', [...flags, worker, cohort, String(first), String(count)], { cwd: consumerRoot, env });
      const classification = classify(run, ids, { modulePath: row.runtimeModule, moduleSha256: row.runtimeSha256 });
      row.runs.push({ cohort, ids, first, run, classification });
      if (!classification.accepted) console.log(JSON.stringify({ layout, cohort, first, failed: classification.failed, errors: classification.errors }));
      first += count;
    }
    console.log(JSON.stringify({ layout, completed: cohort, observations: row.runs.filter(value => value.cohort === cohort).reduce((sum, value) => sum + value.classification.observed, 0) }));
  }
  const denial = await execute('guard', [...flags, worker, 'source-denial'], { cwd: consumerRoot, env });
  row.sourceDenial = { run: denial, accepted: denial.code === 78 && denial.stdout.includes('unbound module ' + manifest.forbiddenSource) };
  const ids = [cases().commands[0].id];
  const late = await execute('product', [...flags, worker, 'commands', '0', '1'], { cwd: consumerRoot, env: { ...env, DOTGLOB_LATE_EXIT_CONTROL: '7' } });
  const classified = classify(late, ids, { modulePath: row.runtimeModule, moduleSha256: row.runtimeSha256 });
  row.late = { run: late, ids, classification: classified, accepted: late.code === 7 && classified.passed === 1 && classified.errors.length === 1 && classified.errors[0] === 'exit status contradicts body outcomes' };
  for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  row.after = inventory(packageRoot);
  return { row, manifest, manifestPath, flags, env, worker, consumerRoot };
}

try {
  stage = stageCandidate(revision);
  result.binding = { candidate: stage.candidate, composition: stage.candidateTree, acceptedComposition: stage.binding.acceptedComposition, candidateInputs: stage.candidateInputs, sourceBefore: stage.sourceBefore, node: stage.binding.node, npmVersion: stage.npm.version, selectedInputs: 265 };
  result.work = stage.work;
  const build = await execute('tool', [stage.npmCli, 'run', 'build'], { cwd: stage.buildRoot, env: stage.env }); result.tools.push({ role: 'build', run: build }); assert.equal(build.code, 0, 'actual isolated candidate build');
  const pack = await execute('tool', [stage.npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', join(stage.work, 'packs')], { cwd: stage.buildRoot, env: stage.env }); result.tools.push({ role: 'pack', run: pack }); assert.equal(pack.code, 0);
  const packPath = join(stage.work, 'packs', JSON.parse(pack.stdout)[0].filename), packed = inspectBuiltPack(stage, packPath);
  result.pack = { sha256: packed.sha256, members: packed.members, changed: packed.changed, bytes: readFileSync(packPath).length };
  writeFileSync(join(evidence, 'PACKAGE.tgz.base64'), readFileSync(packPath).toString('base64') + '\n', { flag: 'wx' });
  const sourceConsumer = join(stage.work, 'source-consumer'); mkdirSync(sourceConsumer);
  await layoutRun('source', stage.buildRoot, sourceConsumer, packed);
  const installed = join(stage.work, 'npm-installed'); mkdirSync(installed); writeFileSync(join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
  const installArgs = ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packPath];
  const install = await execute('tool', [stage.npmCli, ...installArgs], { cwd: installed, env: stage.env }); result.tools.push({ role: 'install', run: install }); assert.equal(install.code, 0);
  assertInventory(join(installed, 'node_modules/virtual-bash'), packed.members);
  for (const tool of stage.binding.typeTools) copyRegular(join(stage.moved, 'node_modules', tool.name), join(installed, 'node_modules', tool.name));
  await layoutRun('installed', join(installed, 'node_modules/virtual-bash'), installed, packed);
  const beforeMove = inventory(installed), moved = join(stage.work, 'physically-moved'); renameSync(installed, moved);
  assert.equal(existsSync(installed), false); assert.deepEqual(inventory(moved), beforeMove);
  result.move = { from: join(installed, 'node_modules/virtual-bash'), to: join(moved, 'node_modules/virtual-bash'), fromAbsent: !existsSync(installed), before: packed.members, after: inventory(join(moved, 'node_modules/virtual-bash')) };
  const movedRun = await layoutRun('moved', join(moved, 'node_modules/virtual-bash'), moved, packed);
  result.types = await candidateTypes(stage, moved, execute);
  try { result.typeCheck = { accepted: true, ids: checkTypes(result.types, join(moved, 'node_modules/virtual-bash')) }; } catch (error) { result.typeCheck = { accepted: false, error: String(error) }; }
  result.guards = await candidateGuards(stage, movedRun.manifest, movedRun.manifestPath, movedRun.flags, movedRun.env, movedRun.worker, execute);
  for (const id of ['absent-builtin', 'accepted-stack-reversion', ...behaviorMutants]) {
    const consumerRoot = join(stage.work, 'mutant-' + id); mkdirSync(consumerRoot); copyRegular(join(moved, 'node_modules/virtual-bash'), join(consumerRoot, 'node_modules/virtual-bash')); copyRegular(stage.harnessRoot, join(consumerRoot, 'harness'));
    const packageRoot = join(consumerRoot, 'node_modules/virtual-bash');
    const mutant = id === 'absent-builtin' ? installAbsentBuiltin(packageRoot, packed.members['dist/shell/runtime.js'].sha256) : id === 'accepted-stack-reversion' ? installStackReversion(packageRoot, stage.packageRoot, stage.binding) : installBehaviorMutant(packageRoot, id, packed.members['dist/shell/runtime.js'].sha256);
    const scratchRoot = join(stage.work, 'scratch-mutant-' + id); mkdirSync(scratchRoot); prepareRealFixture(scratchRoot, 'candidate-real');
    const manifest = manifestFor('moved', packageRoot, join(consumerRoot, 'harness'), scratchRoot, { mutant });
    const manifestPath = join(stage.work, 'manifest-mutant-' + id + '.json'); save(manifestPath, manifest);
    const flags = ['--permission', ...manifest.trees.map(tree => `--allow-fs-read=${tree.root}`), `--allow-fs-read=${manifestPath}`, `--allow-fs-read=${manifest.node.path}`, `--allow-fs-read=${scratchRoot}`, `--allow-fs-write=${scratchRoot}`];
    const env = { PATH: dirname(manifest.node.path), LC_ALL: 'C', TZ: 'UTC', DOTGLOB_MANIFEST: manifestPath, DOTGLOB_MANIFEST_SHA256: hash(readFileSync(manifestPath)) };
    const cohort = mutant.cohort ?? 'procedures', first = cases()[cohort].findIndex(row => row.id === mutant.requiredFailed[0]); assert.ok(first >= 0);
    const run = await execute('product', [...flags, join(manifest.harnessRoot, 'execution-v2/product-worker.mjs'), cohort, String(first), '1'], { cwd: consumerRoot, env });
    const classification = classify(run, mutant.requiredFailed, { modulePath: mutant.runtimeModule, moduleSha256: mutant.runtimeSha256, mutantId: id, requiredFailed: mutant.requiredFailed });
    result.mutants.push({ ...mutant, ids: mutant.requiredFailed, run, classification });
    console.log(JSON.stringify({ mutant: id, killed: classification.mutantKilled, errors: classification.errors, failed: classification.failed }));
    for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  }
  const workflow = { kind: 'dotglob-actual-workflow-v2', candidate: stage.candidate, acceptedComposition: stage.binding.acceptedComposition, packageSha256: candidatePack, candidateInputs: stage.candidateInputs, sourceRoot: stage.sourceRoot, sourceAfter: inventory(stage.sourceRoot), pack: { path: packPath }, packageInventory: packed.members, build: { command: 'npm run build', candidate: stage.candidate, candidateInputs: stage.candidateInputs, run: build }, install: { args: installArgs, run: install }, layouts: result.layouts, exports: packed.metadata.exports, move: result.move, types: result.types, typePackageRoot: movedRun.manifest.packageRoot, guards: result.guards, mutants: result.mutants.filter(row => !behaviorMutants.includes(row.id)) };
  const workflowPath = join(stage.work, 'workflow.json'); save(workflowPath, workflow);
  result.workflowSha256 = hash(readFileSync(workflowPath)); result.procedureR24 = [];
  for (const layout of ['shared-parent-workflow']) {
    const manifest = { ...movedRun.manifest, workflow: { path: workflowPath, sha256: result.workflowSha256 } };
    const manifestPath = join(stage.work, 'workflow-manifest-' + layout + '.json'); save(manifestPath, manifest);
    const run = await execute('product', [...movedRun.flags, `--allow-fs-read=${stage.sourceRoot}`, `--allow-fs-read=${workflowPath}`, `--allow-fs-read=${packPath}`, `--allow-fs-read=${manifestPath}`, movedRun.worker, 'procedures', '23', '1'], { cwd: moved, env: { ...movedRun.env, DOTGLOB_MANIFEST: manifestPath, DOTGLOB_MANIFEST_SHA256: hash(readFileSync(manifestPath)) } });
    result.procedureR24.push({ layout, actualLoadLayout: 'moved', run, classification: classify(run, ['R24'], { modulePath: movedRun.manifest.runtimeModule, moduleSha256: packed.members['dist/shell/runtime.js'].sha256 }) });
  }
  assert.deepEqual(inventory(stage.sourceRoot), stage.sourceBefore); assert.deepEqual(inventory(stage.npm.root), stage.npm.files);
  for (const tool of stage.binding.typeTools) assertInventory(join(stage.moved, 'node_modules', tool.name), tool.inventory.files);
  for (const tree of movedRun.manifest.trees) assertInventory(tree.root, tree.files);
  result.sourceAfter = inventory(stage.sourceRoot); result.integrity = 'source/tools/moved-package/harness exact after';
  result.accepted = result.layouts.every(row => row.runs.every(run => run.classification.accepted) && row.sourceDenial.accepted && row.late.accepted) && result.typeCheck.accepted && result.guards.every(row => row.accepted) && result.mutants.every(row => row.classification.mutantKilled) && result.procedureR24.every(row => row.classification.accepted);
} catch (error) { result.error = String(error?.stack ?? error); result.accepted = false; }
finally {
  if (stage && !infrastructureFailure) { rmSync(stage.work, { recursive: true, force: true }); result.cleanup = { exactOwnedRootRemoved: stage.work, absent: !existsSync(stage.work) }; }
  else result.cleanup = { retained: stage?.work ?? null, infrastructureFailure };
  result.finished = new Date().toISOString(); result.bytesRetained = bytesRetained;
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(evidence, 'RESULT.json.gz.base64'), gzipSync(bytes).toString('base64') + '\n', { flag: 'wx' });
  save(join(evidence, 'RESULT-SEAL.json'), { sha256: hash(bytes), bytes: bytes.length, gzipBase64Sha256: hash(readFileSync(join(evidence, 'RESULT.json.gz.base64'))), accepted: result.accepted, error: result.error ?? null, counts, cleanup: result.cleanup });
}
console.log(JSON.stringify({ evidence, accepted: result.accepted, error: result.error ?? null, counts, cleanup: result.cleanup }));
process.exitCode = result.accepted ? 0 : 1;
