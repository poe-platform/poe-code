import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { authenticate, admit, census, digest, tarInventory, verifyTree } from '../../candidate-v1/boundary-app.mjs';
import { verifyTool } from '../../candidate-v1/npm-tool.mjs';
import { assess } from '../preparation-v3/assess.mjs';
import { put, unpack, extract, variantTar, copyRegularTree, verifyTypeTool } from '../preparation-v3/staging.mjs';
import { controller } from '../preparation-v4/controller.mjs';
import { deadline, TOTAL_MS } from '../preparation-v4/deadline.mjs';
import { admitSelectedSource } from './composition.mjs';
const launchClock = deadline();
import { typeCases, runTypes } from '../preparation-v3/types.mjs';
import { prepareCompiledMutation } from '../preparation-v3/compiled-mutation.mjs';
import { admissionControls } from '../preparation-v3/admission-controls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..'), repository = path.resolve(own, '../../..');
const [goFile, goHash, sealHash, label] = process.argv.slice(2);
let budget, work, report, seal, scope;
try {
  launchClock.check('before-initial-admission');
  assert.ok(goFile && goHash && sealHash && label, 'explicit sealed recipe and new ROOT actual GO required');
  assert.match(label, /^[A-Z0-9][A-Z0-9-]{0,39}$/u);
  seal = JSON.parse(authenticate(path.join(here, 'SEAL.json'), sealHash));
  const go = JSON.parse(authenticate(goFile, goHash));
  assert.equal(go.action, 'execute-array-successor-v5'); assert.equal(go.sealSha256, sealHash);
  assert.equal(go.candidate, 'c0adae539c736db0e4023d401562ce958d9ebb00'); assert.match(go.rootReceipt, /^[a-f0-9]{40}$/u);
  assert.equal(go.packageSha256, 'e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3');
  scope = JSON.parse(authenticate(path.join(own, 's06-successor-v1/SCOPE-BINDING-v2.json'), seal.scopeSha256));
  assert.equal(scope.product, go.candidate); assert.equal(scope.package.sha256, go.packageSha256);
  const policy = JSON.parse(authenticate(path.join(here, 'POLICY.json'), seal.policySha256));
  assert.equal(policy.totalElapsedMsIncludingCleanup, TOTAL_MS);
  launchClock.check('after-initial-admission', policy.reservedCleanupMs);
  assert.equal(scope.selectedProjectionSha256, policy.projectionSha256);
  assert.equal(digest(Buffer.from(JSON.stringify(scope.selectedSource))), policy.projectionSha256);
  const verifyRoles = () => {
    for (const role of seal.roles) { launchClock.check('role-admission'); const file = path.join(own, role.path); assert.equal(authenticate(file, role.sha256).length, role.bytes); assert.equal(fs.lstatSync(file).mode & 0o777, role.mode); }
    authenticate(scope.tools.node.path, scope.tools.node.sha256); authenticate(seal.git.path, seal.git.sha256);
    authenticate(path.join(here, 'SEAL.json'), sealHash); authenticate(goFile, goHash);
  };
  verifyRoles(); assert.equal(process.execPath, scope.tools.node.path); assert.equal(process.version, scope.tools.node.version);
  const sourceFiles = new Map(), immutable = [];
  work = path.join(here, `RUN-${label}`); assert.ok(!fs.existsSync(work)); fs.mkdirSync(work);
  assert.equal(fs.realpathSync(work), work);
  report = { kind: 'array-successor-independent-v5', candidate: scope.product, composition: scope.selectedComposition, packageSha256: scope.package.sha256, sealHash, goHash, rootReceipt: go.rootReceipt, work, phases: [], unsafeStop: false, complete: false, limitations: seal.limitations };
  budget = controller(work, policy, { node: scope.tools.node, git: seal.git }, () => { verifyRoles(); for (const tree of immutable) verifyTree(tree); }, launchClock);
  for (const role of seal.storage) { const directory = path.join(work, role.directory); fs.mkdirSync(directory); budget.registerStorage(role.name, directory, role.maxBytes); }
  const git = async (...args) => {
    const run = await budget.child('git', seal.git.path, args, { cwd: repository, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: policy.maxGitMs, maxBytes: policy.maxGitCaptureBytes });
    assert.equal(run.code, 0); return Buffer.from(run.stdout);
  };
  const admittedSource = await admitSelectedSource(authenticate(path.join(own, 's06-successor-v1/SCOPE-BINDING-v2.json'), seal.scopeSha256), args => git(...args), () => launchClock.check('source-admission', policy.reservedCleanupMs));
  for (const [name, item] of admittedSource.files) sourceFiles.set(name, item);
  await budget.record('composition-admission', admittedSource.evidence);
  const capsule = scope.sourceCapsule, encoded = await git('show', `${capsule.commit}:${capsule.path}`);
  assert.equal(digest(encoded), capsule.encodedSha256);
  const decoded = gunzipSync(Buffer.from(encoded.toString(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }); assert.equal(digest(decoded), capsule.decodedSha256);
  const authorTar = Buffer.from(JSON.parse(decoded).package.base64, 'base64'); assert.equal(digest(authorTar), scope.package.sha256); assert.deepEqual(tarInventory(authorTar), scope.package.inventory);
  const oldEncoded = authenticate(path.join(own, 'candidate-v1/ADMISSION-02.json.gz.base64'), '26f232de331bd326e018b2c152405777795c1ea982cd671bda8237c3ea2c8e5a');
  const oldDecoded = gunzipSync(Buffer.from(oldEncoded.toString(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }); assert.equal(digest(oldDecoded), 'adfc29d7b8df6b8fd350e4cc39eeb00fde0301bb13eda2be87a1e41000972288');
  const oldTar = Buffer.from(JSON.parse(oldDecoded).packageBase64, 'base64'); assert.equal(digest(oldTar), '0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26');
  const sourceRoot = path.join(work, 'source'), build = path.join(work, 'build'), tools = path.join(work, 'tools'), apps = path.join(work, 'apps'), artifacts = path.join(work, 'artifacts'), scratch = path.join(work, 'scratch');
  for (const root of [sourceRoot, build]) for (const [name, item] of sourceFiles) put(path.join(root, name), item.bytes, item.mode);
  immutable.push({ root: sourceRoot, entries: census(sourceRoot) });
  for (const tool of scope.tools.typeTools) {
    verifyTypeTool(tool); copyRegularTree(tool.root, path.join(tools, 'node_modules', tool.name));
    if (tool.name !== 'typescript') copyRegularTree(tool.root, path.join(build, 'node_modules', tool.name));
  }
  immutable.push({ root: tools, entries: census(tools) });
  const npmEncoded = authenticate(path.join(own, scope.tools.npm.inventoryPath), scope.tools.npm.encodedSha256);
  const npmDecoded = gunzipSync(Buffer.from(npmEncoded.toString(), 'base64')); assert.equal(digest(npmDecoded), scope.tools.npm.decodedSha256);
  const npm = JSON.parse(npmDecoded); verifyTool(npm);
  for (const directory of ['home','cache','tmp']) fs.mkdirSync(path.join(scratch, directory));
  for (const name of ['user.npmrc','global.npmrc']) put(path.join(scratch, name), '');
  const env = { PATH: path.dirname(scope.tools.node.path), HOME: path.join(scratch, 'home'), TMPDIR: path.join(scratch, 'tmp'), npm_config_cache: path.join(scratch, 'cache'), npm_config_userconfig: path.join(scratch, 'user.npmrc'), npm_config_globalconfig: path.join(scratch, 'global.npmrc'), LC_ALL: 'C', TZ: 'UTC' };
  const nodeRead = roots => ['--permission', ...[...new Set([...roots, scope.tools.node.path])].map(root => `--allow-fs-read=${root}`)];
  const toolCommand = async (label, args, cwd, readRoots, writeRoots) => {
    verifyTool(npm);
    const run = await budget.child('tool', scope.tools.node.path, [...nodeRead(readRoots), ...writeRoots.map(root => `--allow-fs-write=${root}`), ...args], { cwd, env, timeoutMs: policy.maxToolMs });
    verifyTool(npm); report.phases.push({ label, code: run.code }); assert.equal(run.code, 0, `${label}: ${run.stderr}`); return run;
  };
  const compiler = path.join(tools, 'node_modules/typescript/bin/tsc');
  await toolCommand('single-selected-source-build', [compiler, '-p', 'tsconfig.build.json'], build, [build, tools], [build]);
  const packed = await toolCommand('single-full-pack', [path.join(npm.root, 'bin/npm-cli.js'), 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', artifacts], build, [build, npm.root, scratch, artifacts], [scratch, artifacts]);
  const packedRows = JSON.parse(packed.stdout); assert.equal(packedRows.length, 1); assert.match(packedRows[0].filename, /^[a-zA-Z0-9._-]+\.tgz$/u);
  const tarFile = path.join(artifacts, packedRows[0].filename); authenticate(tarFile, scope.package.sha256);
  assert.deepEqual(tarInventory(fs.readFileSync(tarFile)), scope.package.inventory);
  for (const entry of scope.selectedSource) authenticate(path.join(build, entry.path), entry.sha256);
  const oldTarFile = path.join(artifacts, 'old-c7.tgz'); put(oldTarFile, oldTar);
  for (const [name, entry] of Object.entries(tarInventory(oldTar))) if (name.endsWith('.d.ts') && !name.startsWith('dist/shell/arrays/')) assert.deepEqual(scope.package.inventory[name], entry);
  assert.deepEqual(scope.package.inventory['package.json'], tarInventory(oldTar)['package.json']);
  const roles = new Map(seal.appRoles.map(role => [role.destination, authenticate(path.join(own, role.path), role.sha256)]));
  const appCode = app => {
    for (const [name, bytes] of roles) put(path.join(app, name), bytes);
    for (const expected of typeCases) put(path.join(app, 'consumers', `${expected.id}.mts`), fs.readFileSync(path.join(here, '../preparation-v3', expected.fixture)));
    for (const tool of scope.tools.typeTools.filter(tool => tool.name !== 'typescript')) copyRegularTree(tool.root, path.join(app, 'node_modules', tool.name));
  };
  const oldApp = path.join(apps, 'old-ast'); fs.mkdirSync(oldApp); put(path.join(oldApp, 'package.json'), '{"private":true,"type":"module"}\n');
  extract(oldTar, path.join(oldApp, 'node_modules/virtual-bash'));
  for (const name of ['ast-worker.mjs','boundary.mjs','instrumentation.mjs','ast-core.mjs','AST-COMPAT.json']) put(path.join(oldApp, name), roles.get(name));
  const oldManifest = { role: 'old-c7-public-AST-only', packageSha256: digest(oldTar), packageTar: oldTarFile, appRoot: oldApp, entries: census(oldApp), node: scope.tools.node };
  const oldBound = await budget.record('old-ast-manifest', oldManifest);
  const oldRun = await budget.child('product', scope.tools.node.path, [...nodeRead([oldApp, oldTarFile, oldBound.path]), path.join(oldApp, 'ast-worker.mjs'), oldBound.path, oldBound.sha256], { cwd: oldApp, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: policy.maxRuntimeWorkerMs });
  assert.equal(oldRun.code, 0); assert.deepEqual(census(oldApp), oldManifest.entries);
  const oldRows = oldRun.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)), astBaseline = oldRows.filter(row => row.astBaseline).map(row => row.astBaseline);
  assert.deepEqual(astBaseline.map(row => row.id), ['AST01','AST02','AST03','AST04']);
  assert.deepEqual(oldRows.filter(row => row.summary), [{ summary: { baselineAst: 4 } }]);
  assert.ok(oldRows.some(row => row.load?.path === path.join(oldApp, 'node_modules/virtual-bash/dist/index.js') && row.load.sha256 === tarInventory(oldTar)['dist/index.js'].sha256));
  const sourceApp = path.join(apps, 'source-app'); fs.mkdirSync(sourceApp); put(path.join(sourceApp, 'package.json'), '{"private":true,"type":"module"}\n');
  extract(fs.readFileSync(tarFile), path.join(sourceApp, 'node_modules/virtual-bash')); appCode(sourceApp); put(path.join(sourceApp, 'AST-BASELINE.json'), JSON.stringify(astBaseline) + '\n');
  const installed = path.join(apps, 'installed-app'); fs.mkdirSync(installed); put(path.join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
  await toolCommand('single-offline-install', [path.join(npm.root, 'bin/npm-cli.js'), 'install', '--offline', '--ignore-scripts', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', tarFile], installed, [installed, artifacts, npm.root, scratch], [installed, scratch]);
  assert.deepEqual(Object.fromEntries(Object.entries(census(path.join(installed, 'node_modules/virtual-bash'))).filter(([, entry]) => !entry.directory)), scope.package.inventory);
  appCode(installed); put(path.join(installed, 'AST-BASELINE.json'), JSON.stringify(astBaseline) + '\n');
  let sourceTypeReceipt;
  const manifestFor = async (app, layout, typeReceipt, packageTar = tarFile, mutant) => {
    const packageRoot = path.join(app, 'node_modules/virtual-bash'), packageHash = digest(fs.readFileSync(packageTar));
    const trees = [{ root: app, entries: census(app) }, immutable[0], { root: artifacts, entries: census(artifacts) }];
    const manifest = { kind: 'array-candidate-review-v1', candidate: scope.product, baseTree: '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', repository, node: scope.tools.node, trees, sourceRoot, sourceProjection: scope.selectedSource, sourceProjectionSha256: policy.projectionSha256, harnessRoot: app, packageRoot, packageTar, packageSha256: packageHash, layout, defaultCount: 77, rootModule: path.join(packageRoot, 'dist/index.js'), runtimeModule: path.join(packageRoot, 'dist/shell/runtime.js'), rootDeclaration: path.join(packageRoot, 'dist/index.d.ts'), workerModule: path.join(app, 'worker.mjs'), vectorsFile: path.join(app, 'VECTORS.json'), controlsFile: path.join(app, 'CONTROLS.json'), holdoutsFile: path.join(app, 'HOLDOUTS.json'), baselineFile: path.join(app, 'BASELINE.json'), astCasesFile: path.join(app, 'AST-COMPAT.json'), astBaselineFile: path.join(app, 'AST-BASELINE.json'), adapter: { path: path.join(app, 'complete-adapter.mjs') }, requiredFiles: [...roles.keys()].map(name => path.join(app, name)), astTypes: { accepted: true, candidate: scope.product, receiptPath: typeReceipt.path, receiptSha256: typeReceipt.sha256 }, ...(layout === 'moved' ? { priorAppRoot: installed } : {}), ...(mutant ? { mutant } : {}) };
    const bounded = await budget.record(`manifest-${report.phases.length}-${layout}`, manifest);
    const permit = await budget.record(`go-${report.phases.length}-${layout}`, { action: 'execute-array-candidate', rootReceipt: go.rootReceipt, candidate: scope.product, manifestSha256: bounded.sha256 });
    const binding = { manifest, manifestPath: bounded.path, manifestHash: bounded.sha256, goPath: permit.path, goHash: permit.sha256 };
    admit(binding.manifestPath, binding.manifestHash, binding.goPath, binding.goHash); return binding;
  };
  const runBody = async (binding, job, mutant) => {
    const { manifest, manifestPath, manifestHash, goPath, goHash } = binding;
    admit(manifestPath, manifestHash, goPath, goHash);
    if (manifest.layout === 'moved') assert.equal(fs.existsSync(installed), false, 'physical old installation absent');
    const worker = path.join(manifest.harnessRoot, job.cohort === 'guard' ? 'guard-worker.mjs' : 'worker.mjs');
    const run = await budget.child('product', scope.tools.node.path, [...nodeRead([...manifest.trees.map(tree => tree.root), manifestPath, goPath, manifest.astTypes.receiptPath]), worker, manifestPath, manifestHash, goPath, goHash, job.cohort, JSON.stringify(job.ids)], { cwd: manifest.harnessRoot, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: policy.maxRuntimeWorkerMs });
    const loads = [manifest.rootModule, ...(job.cohort === 'guard' ? [] : [manifest.runtimeModule])].map(filename => ({ path: filename, sha256: digest(fs.readFileSync(filename)) }));
    const verdict = assess(run, job.ids, loads, mutant);
    for (const tree of manifest.trees) verifyTree(tree); authenticate(manifestPath, manifestHash); authenticate(goPath, goHash);
    const receipt = await budget.record(`body-${report.phases.length}`, { job, layout: manifest.layout, binding, verdict }); report.phases.push({ job, receipt, accepted: mutant ? verdict.mutantKilled && verdict.coherent : verdict.accepted });
    assert.equal(verdict.coherent, true, JSON.stringify(verdict.errors));
    budget.ordinary(job.label, mutant ? verdict.mutantKilled : verdict.accepted); return verdict;
  };
  for (const layout of ['source-build','installed','moved']) {
    const app = layout === 'source-build' ? sourceApp : layout === 'installed' ? installed : path.join(apps, 'moved-app');
    if (layout === 'moved') { const prior = census(installed); fs.renameSync(installed, app); assert.deepEqual(census(app), prior); assert.equal(fs.existsSync(installed), false); }
    const appTree = { root: app, entries: census(app) }, consumers = Object.fromEntries(typeCases.map(row => [row.id, { path: path.join(app, 'consumers', `${row.id}.mts`), sha256: digest(fs.readFileSync(path.join(app, 'consumers', `${row.id}.mts`))) }]));
    const typesBinding = { action: 'root-authorized-array-types', candidate: scope.product, rootReceipt: go.rootReceipt, node: scope.tools.node, compiler: { path: compiler, sha256: digest(fs.readFileSync(compiler)) }, trees: [appTree, immutable[1]], consumers, consumerRoot: path.join(app, 'consumers'), rootDeclaration: path.join(app, 'node_modules/virtual-bash/dist/index.d.ts'), parserDeclaration: path.join(app, 'node_modules/virtual-bash/dist/shell/parser.d.ts') };
    const typeResults = await runTypes(typesBinding, (executable, args, options) => budget.child('type', executable, args, options));
    verifyTree(appTree); const accepted = typeResults.length === 10 && typeResults.every(row => row.accepted);
    const typeReceipt = await budget.record(`types-${layout}`, { candidate: scope.product, sourceProjectionSha256: policy.projectionSha256, packageSha256: scope.package.sha256, accepted, unapprovedAstChanges: [], publicDeclarations: '211 exact baseline declaration byte/mode matches; runtime AST comparison separate', binding: typesBinding, results: typeResults });
    report.phases.push({ label: `types-${layout}`, accepted, receipt: typeReceipt }); budget.ordinary(`types-${layout}`, accepted);
    if (!accepted) { report.phases.push({ label: `runtime-${layout}`, blocked: 'mandatory actual types did not qualify; not passes' }); continue; }
    if (layout === 'source-build') sourceTypeReceipt = typeReceipt;
    const binding = await manifestFor(app, layout, typeReceipt);
    const guardResults = admissionControls(binding, () => {});
    await budget.record(`admission-controls-${layout}`, guardResults);
    for (const job of seal.jobs.filter(job => job.layout === layout)) await runBody(binding, job);
  }
  assert.ok(sourceTypeReceipt, 'mutants require qualified source-layout type binding');
  const baselineBinding = await manifestFor(sourceApp, 'source-build', sourceTypeReceipt);
  const before = new Map();
  for (const job of seal.jobs.filter(job => job.stage === 'positive-before')) before.set(job.cohort, await runBody(baselineBinding, job));
  const definitions = JSON.parse(fs.readFileSync(path.join(here, '../preparation-v3/MUTANTS.json'))).declarations, originalMembers = unpack(authorTar);
  for (const definition of definitions) {
    const positive = before.get(definition.cohort);
    if (![...definition.requiredFailed, ...definition.requiredPassed].every(id => positive.observations.some(row => row.id === id && row.pass))) { report.phases.push({ label: definition.id, blocked: 'same candidate positive predicate failed; no mutant kill inference' }); budget.ordinary(definition.id, false); continue; }
    const fields = ['id','member','originalSha256','originalBytes','mode','replacements','prefix','finalLF','changedSha256','changedBytes'];
    const specification = Object.fromEntries(fields.map(key => [key, definition[key]]));
    const changed = prepareCompiledMutation(originalMembers.get(definition.member).bytes, specification), tar = variantTar(authorTar, definition.member, changed);
    const variantFile = path.join(artifacts, `${definition.id}.tgz`); put(variantFile, tar);
    const app = path.join(apps, `mutant-${definition.id}`); fs.mkdirSync(app); put(path.join(app, 'package.json'), '{"private":true,"type":"module"}\n');
    extract(tar, path.join(app, 'node_modules/virtual-bash')); appCode(app); put(path.join(app, 'AST-BASELINE.json'), JSON.stringify(astBaseline) + '\n');
    const variantInventory = tarInventory(tar); assert.equal(Object.keys(variantInventory).length, 862);
    for (const [name, entry] of Object.entries(scope.package.inventory)) if (name !== definition.member) assert.deepEqual(variantInventory[name], entry);
    const receipt = await budget.record(`types-inheritance-${definition.id}`, { candidate: scope.product, sourceProjectionSha256: policy.projectionSha256, packageSha256: digest(tar), accepted: true, unapprovedAstChanges: [], qualification: 'not a fresh compiler pass: all declaration/package bytes equal qualified source package; one disclosed JS mutation only', inheritedFrom: sourceTypeReceipt });
    const mutant = { id: definition.id, path: path.join(app, 'node_modules/virtual-bash', definition.member), sha256: definition.changedSha256, requiredFailed: definition.requiredFailed, requiredPassed: definition.requiredPassed };
    const binding = await manifestFor(app, 'source-build', receipt, variantFile, mutant);
    await runBody(binding, { label: definition.id, cohort: definition.cohort, ids: definition.ids }, mutant);
    const finalCensus = census(app); await budget.record(`variant-census-${definition.id}`, { app, entries: finalCensus });
    fs.rmSync(app, { recursive: true }); assert.equal(fs.existsSync(app), false);
  }
  const restored = await manifestFor(sourceApp, 'source-build', sourceTypeReceipt);
  for (const job of seal.jobs.filter(job => job.stage === 'positive-after')) await runBody(restored, job);
  verifyRoles(); verifyTool(npm); for (const tree of immutable) verifyTree(tree);
  authenticate(tarFile, scope.package.sha256); report.complete = true;
} catch (reason) {
  if (!report) { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
  else { report.unsafeStop = true; report.error = String(reason?.stack ?? reason); }
} finally {
  if (report && budget) {
    try {
      const terminal = await budget.finalize(report, () => ({ finalCensuses: ['source','build','tools','apps','artifacts','scratch'].map(name => ({ root: path.join(work, name), entries: census(path.join(work, name)) })) }), value => new Promise((resolve, reject) => { process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()); }));
      launchClock.check('coordinator-exit-selection');
      process.exitCode = terminal.unsafeStop ? 78 : terminal.accepted ? 0 : 1;
    } catch (reason) { console.error(`unsafe final receipt/cleanup: ${String(reason)}`); process.exitCode = 78; }
  }
}
