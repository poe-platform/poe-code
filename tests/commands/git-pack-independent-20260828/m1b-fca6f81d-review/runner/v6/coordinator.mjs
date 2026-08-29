import fs from 'node:fs/promises';
import path from 'node:path';
import { Budget } from './budget.mjs';
import { demand, regular, inventory, guard, writeExclusive, under, sha256 } from './primitives.mjs';
import { sourceRequests, authenticateSources } from './source-admission.mjs';
import { readArchive } from './archive.mjs';
import { admitTools, authenticateToolOrigins, materializeFiles, packageGuard, movedGuard, selectedFileMap } from './materialize.mjs';
import { admissionControls } from './admission-controls.mjs';
import { supervise } from './supervisor.mjs';
import { validateCases, runBatch } from './cases.mjs';
import { prepareTypeTools, typeCompiler } from './type-bridge.mjs';
import { loadedControls } from './loaded-controls.mjs';
import { beginBatchPhase, finishBatchPhase, canAdmitBatch } from './batch-phases.mjs';

async function stdoutBytes(root, record, stream = 'stdout') {
  const rows = record.raw.filter(row => row.stream === stream);
  demand(rows.reduce((sum, row) => sum + row.bytes, 0) <= 16777216, 'TOOL_RAW_REASSEMBLY_LIMIT');
  return Buffer.concat(await Promise.all(rows.map(async row => {
    const bytes = await fs.readFile(under(root, row.path));
    demand(bytes.length === row.bytes && sha256(bytes) === row.sha256, 'RAW_REFERENCE');
    return bytes;
  })));
}
function toolEnvironment(root) {
  return {
    PATH: path.join(root, 'tools/bin'), HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'),
    LANG: 'C', LC_ALL: 'C', TZ: 'UTC', UV_THREADPOOL_SIZE: '1', NODE_OPTIONS: '',
    M1B_TOOL_ROOT: path.join(root, 'tools'),
    npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_userconfig: path.join(root, 'npmrc'), npm_config_globalconfig: path.join(root, 'global-npmrc'), npm_config_cache: path.join(root, 'cache')
  };
}
async function requireZero(budget, record) {
  demand(record.code === 0 && record.signal === null && record.closed && !record.timedOut && !record.spawnError && !record.captureError && budget.unsafe === null, 'TOOL_REQUIRED_ZERO_RETIRED');
}
export async function coordinate(context) {
  const { recipe, root, origin, scope, projectionBefore } = context;
  const budget = new Budget(root, recipe.caps, origin);
  budget.reserveWork(context.bootstrapWorkBytes);
  const cancel = message => {
    if (message?.role !== 'ROOT_CANCEL') return;
    budget.fail('OUTER_CANCEL', true);
    for (const child of budget.active.values()) {
      if (child.connected) child.send({ type: 'CANCEL', reason: 'ROOT_CANCEL' }, error => { if (error) budget.fail('CANCEL_DELIVERY', true); });
      child.kill('SIGTERM');
    }
  };
  process.on('message', cancel);
  const result = { schema: 'm1b-independent-result-v1', sourceCommit: recipe.sourceCommit, derivedTree: recipe.derivedTree, packageSha256: recipe.packageSha256, layouts: ['S', 'M'], status: 'FAIL', source: null, batches: [], unrun: [], tools: [], qualification: 'Scoped direct-module proof only; author evidence and native workflows not inherited.' };
  result.coverageScope = recipe.coverageSummary;
  const state = { budget, recipe, root, harnessRoot: path.join(root, 'harness'), env: toolEnvironment(root), node: path.join(root, 'tools/bin/node'), typeCaseRows: new Map(), verifyProjection: () => guard(scope, projectionBefore) };
  state.notifyPhase = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
  let typeTools;
  let controls;
  let buildSource;
  let buildSourceRows;
  let activePhase = null;
  let toolRows;
  let sourceRows;
  let movedRows;
  let installedOriginRows;
  let sourceMap;
  let packageMap;
  let tools;
  let archive;
  let validated;
  let sourceProof;
  let source;
  let moved;
  const readData = async binding => JSON.parse((await regular(under(scope, binding.path), binding)).body.toString('utf8'));
  const verifyOrigins = async () => {
    await state.verifyProjection();
    if (buildSourceRows) await guard(buildSource, buildSourceRows);
    if (typeTools) await guard(typeTools.root, typeTools.snapshot);
    if (state.harnessRows) await guard(state.harnessRoot, state.harnessRows);
    if (controls) await controls.guardRemaining();
    if (tools) await authenticateToolOrigins(tools);
    if (toolRows) await guard(path.join(root, 'tools'), toolRows);
    if (sourceRows) await guard(source, sourceRows);
    if (movedRows) await guard(moved, movedRows);
    if (packageMap) await regular(path.join(recipe.repo, packageMap.encoded.path), packageMap.encoded);
  };
  const phase = async name => {
    if (activePhase !== null) {
      const elapsedMs = budget.elapsed();
      await budget.record('phase-end', { name: activePhase, parentElapsedMs: elapsedMs, absoluteDeadlineOffsetMs: recipe.phaseEndsMs[activePhase] });
      demand(elapsedMs <= recipe.phaseEndsMs[activePhase], 'OUTGOING_PHASE_DEADLINE:' + activePhase);
    }
    activePhase = name;
    budget.admit(budget.deadline(recipe.phaseEndsMs[name]));
    await budget.record('phase', { name, parentElapsedMs: budget.elapsed(), absoluteDeadlineOffsetMs: recipe.phaseEndsMs[name] });
  };
  try {
    await budget.record('root-route', context.rootReceipt);
    await phase('admission');
    sourceMap = await readData(recipe.data.source);
    packageMap = await readData(recipe.data.package);
    tools = await readData(recipe.data.tools);
    demand(sourceMap.sourceCommit === recipe.sourceCommit && sourceMap.derivedTree === recipe.derivedTree && packageMap.sha256 === recipe.packageSha256, 'RECIPE_CANDIDATE_IDENTITY');
    const manifests = await Promise.all(recipe.caseManifests.map(readData));
    validated = validateCases(manifests, recipe);
    await budget.record('planned-all-nesting', { outerBatches: recipe.batches.length, metadata: 1, build: 1, install: 1, typeCompilers: validated.compilerCalls, total: validated.plannedChildStarts, ceiling: 168 });
    await authenticateToolOrigins(tools);
    const requests = sourceRequests(sourceMap);
    const git = tools.binaries.find(row => row.name === 'git');
    await regular(git.origin, git);
    const metadata = await supervise(budget, {
      id: 'source-objects', executable: git.origin, argv: ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', 'cat-file', '--batch'],
      cwd: recipe.repo, env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', LANG: 'C', LC_ALL: 'C', PATH: '' },
      input: Buffer.from(requests.map(row => row.oid).join('\n') + '\n'), streamBytes: { stdout: 8388608, stderr: 262144 }, deadline: budget.deadline(recipe.phaseEndsMs.admission)
    });
    await requireZero(budget, metadata);
    const sourceRaw = await stdoutBytes(root, metadata);
    sourceProof = authenticateSources(sourceMap, requests, sourceRaw);
    result.source = sourceProof.proof;
    await budget.record('selected-source-proof', sourceProof.proof);
    const encoded = (await regular(path.join(recipe.repo, packageMap.encoded.path), packageMap.encoded)).body;
    archive = Buffer.from(encoded.toString('utf8').trim(), 'base64');
    const packageFiles = readArchive(archive, packageMap);
    await budget.record('package-admission', { sha256: packageMap.sha256, members: packageFiles.size, readme: packageFiles.get('README.md').sha256, proofRole: 'AUTHOR_ARTIFACT_BINDING_NOT_INDEPENDENT_BUILD' });
    await phase('setup');
    for (const name of ['home', 'tmp', 'cache', 'control', 'cases', 'types', 'install', 'mutants']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    for (const name of ['npmrc', 'global-npmrc']) await writeExclusive(path.join(root, name), Buffer.alloc(0));
    toolRows = await admitTools(tools, root, budget);
    state.harnessRows = await materializeFiles(state.harnessRoot, recipe.harness.files, async row => (await regular(under(scope, row.path), row)).body, budget);
    const typeManifest = await readData(recipe.data.typeTools);
    typeTools = await prepareTypeTools(state, typeManifest);
    source = path.join(root, 'source');
    sourceRows = await materializeFiles(source, sourceMap.inputs.map(row => ({ ...row, mode: Number.parseInt(row.mode, 8) & 0o777 })), row => sourceProof.selected.get(row.path), budget);
    const archiveFile = path.join(root, 'candidate.tgz');
    budget.reserveWork(archive.length);
    await writeExclusive(archiveFile, archive);
    const sourceBeforeBuild = sourceRows;
    sourceRows = undefined;
    await phase('build');
    await verifyOrigins();
    await guard(source, sourceBeforeBuild);
    budget.reserveWork(recipe.reservations.buildBytes);
    const compiler = path.join(root, 'tools/node_modules/typescript/lib/tsc.js');
    const toolPrefix = ['--import', path.join(state.harnessRoot, 'runner/tool-fence.mjs')];
    const build = await supervise(budget, { id: 'independent-build', executable: state.node, argv: [...toolPrefix, compiler, '-p', path.join(source, 'tsconfig.build.json'), '--typeRoots', path.join(root, 'tools/node_modules/@types'), '--pretty', 'false', '--listFiles'], cwd: source, env: state.env, streamBytes: { stdout: 2097152, stderr: 262144 }, deadline: Math.min(budget.deadline(recipe.phaseEndsMs.build), budget.now() + 120000) });
    result.tools.push({ id: build.id, code: build.code, receipt: build.receipt });
    await requireZero(budget, build);
    const afterBuild = await inventory(source);
    demand(JSON.stringify(afterBuild.filter(row => row.path !== 'dist' && !row.path.startsWith('dist/'))) === JSON.stringify(sourceBeforeBuild), 'BUILD_INPUT_MUTATION');
    const emitted = selectedFileMap(afterBuild.filter(row => row.path.startsWith('dist/')));
    demand(JSON.stringify(emitted) === JSON.stringify(packageMap.files.filter(row => row.path.startsWith('dist/'))), 'INDEPENDENT_BUILD_COMPLETE_BYTES');
    await packageGuard(path.join(source, 'dist'), packageMap.files.filter(row => row.path.startsWith('dist/')).map(row => ({ ...row, path: row.path.slice(5) })));
    const loadedBuild = (await stdoutBytes(root, build)).toString('utf8').split('\n').filter(Boolean);
    const buildAllowed = new Set([...sourceMap.inputs.filter(row => row.path.endsWith('.ts')).map(row => under(source, row.path)), ...toolRows.filter(row => row.kind === 'file' && row.path.endsWith('.d.ts')).map(row => path.join(root, 'tools', row.path))]);
    demand(loadedBuild.length > 0 && loadedBuild.every(filename => buildAllowed.has(filename)), 'BUILD_DECLARATION_CLOSURE');
    buildSource = source;
    buildSourceRows = afterBuild;
    source = path.join(root, 'source-package');
    sourceRows = await materializeFiles(source, packageMap.files, row => regular(under(buildSource, row.path), row).then(value => value.body), budget);
    await packageGuard(source, packageMap.files);
    await budget.record('independent-build-adopted', { emitted: emitted.length, packageMatches: true, compilerZeroRetired: true, role: 'SOURCE_BUILT_NOT_AUTHOR_BYTES' });
    await verifyOrigins();
    await phase('install');
    const installRoot = path.join(root, 'install');
    const installManifest = Buffer.from('{"name":"m1b-owned-install","version":"0.0.0","private":true}\n');
    budget.reserveWork(installManifest.length + recipe.reservations.installBytes);
    await writeExclusive(path.join(installRoot, 'package.json'), installManifest);
    const install = await supervise(budget, { id: 'offline-install', executable: state.node, argv: [...toolPrefix, path.join(root, 'tools/node_modules/npm/bin/npm-cli.js'), 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-bin-links', '--package-lock=false', '--save=false', '--omit=dev', '--prefix', installRoot, archiveFile], cwd: installRoot, env: state.env, streamBytes: { stdout: 2097152, stderr: 262144 }, deadline: Math.min(budget.deadline(recipe.phaseEndsMs.install), budget.now() + 120000) });
    result.tools.push({ id: install.id, code: install.code, receipt: install.receipt });
    await requireZero(budget, install);
    const installed = path.join(installRoot, 'node_modules/virtual-bash');
    installedOriginRows = await packageGuard(installed, packageMap.files);
    moved = path.join(root, 'moved-package');
    await fs.rename(installed, moved);
    movedRows = await movedGuard(installed, moved, packageMap.files);
    demand(JSON.stringify(installedOriginRows) === JSON.stringify(movedRows), 'MOVE_FULL_IDENTITY');
    await budget.record('physical-matrix', { S: { root: source, role: 'INDEPENDENT_COMPILED_DIRECT_MODULE' }, I: { root: installed, role: 'OFFLINE_INSTALL_ORIGIN_ONLY_NOW_ABSENT' }, M: { root: moved, role: 'PHYSICALLY_MOVED_FULL_PACKAGE_DIRECT_MODULE' }, semanticLayouts: 2, publicGitExport: false });
    await verifyOrigins();
    await phase('guards');
    const controlPostimage = recipe.mutants.find(row => row.id === 'L-S01');
    const controlEncoded = (await regular(under(state.harnessRoot, controlPostimage.postimage.path), controlPostimage.postimage)).body;
    const postimage = Buffer.from(controlEncoded.toString('utf8').trim(), 'base64');
    demand(sha256(postimage) === controlPostimage.decoded.sha256, 'GUARD_POSTIMAGE');
    result.admissionControls = await admissionControls({ budget, root, sourceMap, requests, sourceRaw, archive, packageMap, packageFiles, deadline: budget.deadline(recipe.phaseEndsMs.guards), verifyOrigins, postimage });
    const compile = typeCompiler(state, typeTools, packageMap, verifyOrigins);
    controls = loadedControls(state, packageMap);
    let currentPhase = null;
    for (const batch of recipe.batches) {
      if (batch.phase !== currentPhase) { await phase(batch.phase); currentPhase = batch.phase; }
      budget.admit(budget.deadline(recipe.phaseEndsMs[batch.phase]));
      if (!canAdmitBatch(budget.now(), budget.deadline(recipe.phaseEndsMs[batch.phase]), budget.end, recipe.caps.finalizeMs)) {
        await budget.record('remaining-phase-budget-unrun', { batch: batch.id, layout: batch.layout, reason: 'BODY30_AND_VERIFY120_DO_NOT_FIT', caseStarts: 0, parentElapsedMs: budget.elapsed() });
        break;
      }
      await beginBatchPhase(state, batch, 'BODY');
      await verifyOrigins();
      const items = batch.ids.map(id => validated.cases.find(row => row.id === id));
      const ordinaryRoot = batch.layout === 'S' ? source : moved;
      const prepared = await controls.prepare(batch, ordinaryRoot);
      if (prepared.unrun) {
        await budget.record('loaded-precondition-unrun', { batch: batch.id, ids: batch.ids, layout: batch.layout, reason: prepared.unrun, caseStarts: 0 });
        await finishBatchPhase(state, 'UNRUN', prepared.unrun);
        await beginBatchPhase(state, batch, 'VERIFY');
        await verifyOrigins();
        await finishBatchPhase(state, 'UNRUN', prepared.unrun);
        continue;
      }
      budget.admit(state.batchDeadline);
      const receipt = await runBatch(state, batch, items, prepared.root, compile);
      result.batches.push(receipt);
      await controls.complete(batch, prepared, receipt);
      await verifyOrigins();
      await finishBatchPhase(state, 'PASS');
    }
  } catch (error) {
    budget.fail(error instanceof Error ? error.message : 'COORDINATOR_NONERROR_THROW', true);
  } finally {
    if (activePhase !== null && budget.elapsed() > recipe.phaseEndsMs[activePhase]) budget.fail('OUTGOING_PHASE_DEADLINE:' + activePhase, true);
    try { await budget.record('phase-finalization', { parentElapsedMs: budget.elapsed(), deadlineOffsetMs: recipe.caps.wallMs }, true); }
    catch { budget.fail('FINAL_PHASE_CAPTURE', true); }
    for (const [pid, child] of budget.active) {
      child.kill('SIGKILL');
      budget.fail(`UNRETIRED_KNOWN_CHILD:${pid}`, true);
    }
    if (budget.active.size) {
      let timer;
      await Promise.race([Promise.all([...budget.active.values()].map(child => new Promise(resolve => child.once('close', resolve)))), new Promise(resolve => { timer = setTimeout(resolve, Math.max(1, budget.end - budget.now())); })]);
      clearTimeout(timer);
    }
    try {
      let settled = false;
      let timer;
      await Promise.race([budget.closeStreams().then(() => { settled = true; }), new Promise(resolve => { timer = setTimeout(resolve, Math.max(1, budget.end - budget.now())); })]);
      clearTimeout(timer);
      demand(settled, 'UNKNOWN_STREAM_CLEANUP');
    } catch { budget.fail('FINAL_STREAM_CLEANUP', true); }
    if (state.activeBatchPhase) {
      try { await finishBatchPhase(state, 'FAIL', budget.unsafe ?? 'BATCH_UNFINISHED'); }
      catch { budget.fail('BATCH_PHASE_FINALIZATION_FAILED', true); }
    }
    try { await verifyOrigins(); } catch { budget.fail('FINAL_INTEGRITY', true); }
    if (budget.elapsed() > recipe.caps.wallMs) budget.fail('GLOBAL_DEADLINE', true);
    if (validated) {
      const completed = new Set(result.batches.flatMap(batch => batch.completed.map(row => `${batch.layout}:${row.id}`)));
      result.unrun = validated.cases.flatMap(item => item.layouts.filter(layout => !completed.has(`${layout}:${item.id}`)).map(layout => ({ id: item.id, layout, role: item.role, rows: item.rows, variants: item.variants, status: item.role === 'SOURCE_ONLY' ? 'SOURCE_ONLY' : 'UNRUN' })));
    }
    result.status = budget.failures.length || budget.unsafe || budget.active.size ? 'FAIL' : result.unrun.length ? 'INCOMPLETE' : 'PASS_SCOPED_ONLY';
    result.failures = budget.failures;
    result.unsafe = budget.unsafe;
    result.accounting = { elapsedMs: budget.elapsed(), childStarts: budget.starts, includingOuterStarts: budget.starts + 1, peakProcesses: budget.peak, activePids: [...budget.active.keys()], captureBytes: budget.capture, workReserved: budget.work, workPeak: budget.workPeak, cumulativeWorkReservations: budget.workCumulative };
    try {
      result.finalFilesBeforeReceipt = await budget.finalFileTotal();
      await budget.record('FINAL-RESULT', result, true);
      const finalFiles = await budget.finalFileTotal();
      await budget.record('FINAL-ACCOUNTING', { elapsedMs: budget.elapsed(), ...finalFiles, activePids: [...budget.active.keys()] }, true);
      await budget.finalFileTotal();
      if (budget.elapsed() > recipe.caps.wallMs) { budget.fail('FINALIZATION_DEADLINE', true); result.status = 'FAIL'; }
    } catch { budget.fail('FINALIZATION_FAILURE', true); result.status = 'FAIL'; }
  }
  const outcome = { status: result.status, active: budget.active.size, unsafe: budget.unsafe, root, captureCharged: budget.capture, workReserved: budget.work, startsIncludingCoordinator: budget.starts, peakIncludingOuter: budget.peak };
  budget.reserveCapture(Buffer.byteLength(JSON.stringify(outcome)) + 1, true);
  process.removeListener('message', cancel);
  return outcome;
}
