import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recipe, scope, repository, prior, priorRecipe, sha, json, authenticatePrior, decodePrior, declarationClosure, parseLines, priorCommit } from './prior.mjs';

const prefix = relative(repository, recipe), oldPrefix = relative(repository, priorRecipe);
const priorFiles = authenticatePrior(), oldBindings = json(join(priorRecipe, 'BINDINGS.json'));
for (const binary of oldBindings.binaries) assert.equal(sha(fs.readFileSync(binary.path)), binary.sha256);
const original = fs.readFileSync(join(priorRecipe, 'executor.mjs'), 'utf8');
assert.equal(sha(original), 'a296254a1ccf87d5108df3dbd37f17db19cc81f7aa1b426131607f2325e30d8a');
const changes = [];
function put(name, content) {
  const path = `${prefix}/${name}`; assert.equal(fs.existsSync(join(repository, path)), false, path);
  execFileSync('apply_patch', [`*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`], { cwd: repository });
}
const data = (name, value) => put(name, `${JSON.stringify(value, null, 2)}\n`);
function slice(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `${start} -> ${end}`); return source.slice(first, last);
}
let executor = original;
function replace(label, before, after) {
  assert.equal(executor.split(before).length, 2, label);
  changes.push({ label, beforeSha256: sha(before), afterSha256: sha(after), beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after) });
  executor = executor.replace(before, after);
}
const oldCommon = fs.readFileSync(join(priorRecipe, 'common.mjs'), 'utf8');
assert.equal(oldCommon.split(oldPrefix).length, 2);
put('common.mjs', oldCommon.replace(oldPrefix, prefix));
put('binding-contract.mjs', "export { assertReplayBindings } from '../../public29-v1/recipe/binding-contract.mjs';\n");
put('tool-observer.cjs', fs.readFileSync(join(priorRecipe, 'tool-observer.cjs'), 'utf8'));
const admissionExecutor = fs.readFileSync(join(repository, 'tests/integration/du-public-independent-evidence-20260827/admission-v2/executor.mjs'), 'utf8');
const admissionExecutorGit = execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repository, 'show', '5508a2a236763754be97baf7347a36ce27e5ef92:tests/integration/du-public-independent-evidence-20260827/admission-v2/executor.mjs']);
assert.equal(sha(admissionExecutor), sha(admissionExecutorGit), 'PINNED_ARCHIVE_PARSER_SOURCE');
let parser = slice(admissionExecutor, 'function archiveMembers(pack, limit) {', '\nfunction packGuard(');
const originalParser = parser;
parser = parser.replace('function archiveMembers(pack, limit) {', 'export function archiveMembers(pack, limit, onMember) {').replace('      members[member] = sha256(body);', '      members[member] = sha256(body);\n      onMember(member, Buffer.from(body), octal(header, 100, 8) & 0o777);');
put('archive.mjs', `import assert from 'node:assert/strict';\nimport { gunzipSync } from 'node:zlib';\nimport { safe as safeRelative, sha as sha256 } from './common.mjs';\n\n${parser}`);
const diagnosticBody = slice(original, "  assert.equal(result.signal, null); assert.equal(result.stderr, ''); assert.equal(result.code, expected.exitCode, result.stdout);", '\n  return { label, expected, diagnostics, proof, payloadSha256: sha(payload), status:');
put('diagnostic-control.mjs', `import assert from 'node:assert/strict';\nexport function diagnosticProof(result, expected) {\n${diagnosticBody}\n  return diagnostics;\n}\n`);
const { archiveMembers } = await import(pathToFileURL(join(recipe, 'archive.mjs')).href);
const { authenticateTools, authenticateSelected } = await import(pathToFileURL(join(recipe, 'common.mjs')).href);
authenticateTools(oldBindings); authenticateSelected(oldBindings);
const capture = decodePrior(), members = new Map();
const pack = capture.retained.get('reproducible-input/candidate.tgz');
assert.equal(sha(pack), oldBindings.pack.sha256); assert.equal(pack.length, 726693);
assert.deepEqual(archiveMembers(pack, 16 * 1024 ** 2, (path, bytes) => members.set(path, bytes)), oldBindings.packageFiles);
assert.equal(members.size, 834);
const metadata = JSON.parse(members.get('package.json'));
const rootEntry = metadata.exports['.'].types.slice(2), duEntry = metadata.exports['./commands/du'].types.slice(2);
const roots = { root: declarationClosure(rootEntry, members), du: declarationClosure(duEntry, members) };
const missingMetadata = structuredClone(metadata); delete missingMetadata.exports['./commands/du'];
const routes = { schema: 'du-declaration-entry-route/1', candidate: oldBindings.candidate, packageSha256: oldBindings.pack.sha256, packageFiles: oldBindings.packageFiles, roots, typeDependencies: {}, cases: {}, exactT03Stdout: capture.retained.get('raw/042-T03/stdout.data').toString(), priorReportCorrection: 'T04 is ROOT-importing, not leaf-only as suggested in the old recommendation. T05 variants also import ROOT. Neither old report nor fixture is modified.' };
for (const dependency of oldBindings.closure.packages.filter(row => ['@types/node', 'undici-types'].includes(row.name))) for (const row of dependency.records.filter(item => item.type === 'file')) routes.typeDependencies[`node_modules/${dependency.name}/${row.path}`] = row.sha256;
const cases = [
  ['T01', 'tests/integration/du-public-independent-20260827/consumers/positive.ts.data'],
  ['T02', 'tests/integration/du-public-independent-20260827/consumers/negative-options.ts.data'],
  ['T03', 'tests/integration/du-public-independent-20260827/consumers/negative-limits.ts.data'],
  ['T04', 'tests/integration/du-public-independent-20260827/consumers/negative-readonly.ts.data'],
  ['T05-positive', `${oldPrefix}/aggregate-positive.ts.data`], ['T05-replace', `${oldPrefix}/aggregate-replace.ts.data`], ['T05-unknown', `${oldPrefix}/aggregate-unknown.ts.data`],
  ['P03-types', 'tests/integration/du-public-independent-20260827/consumers/positive.ts.data'],
];
for (const [label, payloadPath] of cases) {
  const payload = fs.readFileSync(join(repository, payloadPath));
  const publicImports = [...payload.toString().matchAll(/\bfrom\s+['"](virtual-bash(?:\/commands\/du)?)['"]/gu)].map(match => match[1]);
  assert.ok(publicImports.length > 0);
  const requiredRoots = [...new Set(publicImports.filter(name => !(label === 'P03-types' && name === 'virtual-bash/commands/du')).map(name => name === 'virtual-bash' ? 'root' : 'du'))];
  routes.cases[label] = { payloadPath, payloadSha256: sha(payload), publicImports, requiredRoots, packageMetadataSha256: label === 'P03-types' ? sha(JSON.stringify(missingMetadata)) : sha(members.get('package.json')), missingPublicExport: label === 'P03-types' ? './commands/du' : null, authorizedExecution: !['T01', 'T02'].includes(label) };
}
assert.deepEqual(routes.cases.T03.requiredRoots, ['du']); assert.deepEqual(routes.cases.T04.requiredRoots, ['root']);
for (const label of ['T05-positive', 'T05-replace', 'T05-unknown']) assert.deepEqual(routes.cases[label].requiredRoots, ['root']);
for (const [label, root] of [['T01', 'root'], ['T03', 'du']]) {
  const reads = parseLines(capture.retained.get(`raw/${label}-tool.jsonl`)).filter(row => row.kind === 'actual-file-read');
  for (const [path, digest] of Object.entries(roots[root].required)) assert.ok(reads.some(row => row.path.endsWith(`/node_modules/virtual-bash/${path}`) && row.sha256 === digest), `PRIOR_ACTUAL_TRANSITIVE_CLOSURE:${label}:${path}`);
}
data('ROUTES.json', routes);
replace('continuation imports', "import { assertReplayBindings } from './binding-contract.mjs';", "import { assertReplayBindings } from './binding-contract.mjs';\nimport { prior, priorRecipe, authenticatePrior, decodePrior, parseLines, priorCommit } from './prior.mjs';\nimport { declarationReadProof, assertExactT03 } from './predicate.mjs';\nimport { focusedControls } from './controls.mjs';");
replace('bound old bindings and explicit replay delta', "const bindings = read(join(recipe, 'BINDINGS.json'));\nconst replay = read(join(recipe, 'replay-bindings.json'));", "const priorFiles = authenticatePrior();\nconst bindings = read(join(priorRecipe, 'BINDINGS.json'));\nbindings.protectedFiles.push(...Object.entries(priorFiles).map(([path, sha256]) => ({ commit: priorCommit, path: relative(repository, join(prior, path)), sha256 })));\nconst replay = read(join(priorRecipe, 'replay-bindings.json'));\nconst replayDelta = read(join(recipe, 'REPLAY-DELTA.json'));\nassert.equal(fileHash(join(priorRecipe, 'replay-bindings.json')), replayDelta.originalSha256);\nObject.assign(replay.required, replayDelta.updates);\nassert.equal(sha(JSON.stringify(replay)), replayDelta.resultSha256);\nconst routes = read(join(recipe, 'ROUTES.json'));\nconst priorResult = read(join(prior, 'RESULT-original.json'));\nconst continuationIds = ['T03', 'T04', 'T05', 'P03', 'P04', 'P05', 'P06'];");
replace('no runtime case cohort selected', original.split('\n').find(line => line.startsWith('const semanticIds =')), 'const semanticIds = [];');
replace('separate continuation state', original.split('\n').find(line => line.startsWith('const state =')), "const state = { schema: 'du-public29-declaration-continuation/1', startedAt: new Date().toISOString(), candidate, freeze, packSha256: packSha, mode: 'scoped-committed-archive', recipeCommit: process.argv[2], attempts: 1, retries: 0, source: [], moved: [], cases: [], controls: [], focused: [], declarationProofs: [], children: [], guards: [], phase: 'preflight', failure: null, privateHelperApproved: false, privateHelperLoads: 0, fullGate: false, whole76: false, priorQualifiedCases: 22, priorRuntimeObservations: { source: 19, moved: 19, rerun: 0 }, buildAndPackReproduction: 'bound accepted5508a2a2, not repeated', originalStopPreserved: '83645ad0', oldHold: '3e02038d unchanged' };");
replace('label-aware tool predicate signature', 'function validateTool(log, compiler = false) {', 'function validateTool(log, compiler = false, label, consumerRoot) {');
replace('remove unrelated universal root declaration requirement', "    assert.ok(reads.some(row => row.path.endsWith('/virtual-bash/dist/index.d.ts')));\n", '');
replace('require exact entry and transitive declaration reads', '  toolReads += reads.length; toolCompiles += compiles.length;', "  if (label) state.declarationProofs.push(declarationReadProof(records, label, consumerRoot, join(work, 'tools'), routes));\n  toolReads += reads.length; toolCompiles += compiles.length;");
replace('only two unchanged runtime negative entry helpers', "  for (const name of ['entry.mjs', 'preload.mjs', 'load-proof-hook.mjs', 'public-cases.mjs', 'runtime-cases.mjs', 'binding-contract.mjs', 'replay-bindings.json', 'R07.json', 'missing-export.mjs', 'denied-source.mjs']) write(join(root, 'fixtures', name), fs.readFileSync(join(recipe, name)));", "  for (const name of ['missing-export.mjs', 'denied-source.mjs']) write(join(root, 'fixtures', name), fs.readFileSync(join(priorRecipe, name)));");
replace('remove unused runtime cohort functions', slice(executor, 'function configuration(', 'async function compile('), '');
replace('select route without changing legacy diagnostics', '  const proof = validateTool(log, positivePackage);', "  const proof = validateTool(log, positivePackage, label, root);\n  if (label === 'T03') assertExactT03(result, routes);");
replace('A06 prior acceptance bound without rescore', "  state.controls.push({ id: 'A06', status: 'PASS-new-positive-release', acceptedHtml: bindings.acceptedHtml, not74NameSubstitution: true });", "  assert.equal(priorResult.controls.find(row => row.id === 'A06').status, 'PASS-new-positive-release');\n  state.priorA06 = 'bound83645ad0-not-rerun';\n  assert.equal(priorResult.cases.length, 22);\n  const priorCapture = decodePrior(); state.priorCapture = priorCapture.receipt;\n  firstMoved = { config: JSON.parse(priorCapture.retained.get('raw/moved-P01/config.json')), trace: parseLines(priorCapture.retained.get('raw/moved-P01/module-loads.jsonl')) };\n  state.P05TraceProvenance = '83645ad0 actual moved P01 bytes, not a new load or rerun';\n  await focusedControls(priorCapture, routes, row => { state.focused.push(row); save(join(raw, `FOCUSED-${row.id}.json`), row); });");
replace('authenticate selected Git inventory, no source rematerialization', slice(executor, "  state.phase = 'materialization';", '  for (const dependency of bindings.closure.packages) for (const entry of dependency.records) {'), "  state.phase = 'tool-and-package-setup';\n  state.selected = authenticateSelected(bindings);\n  assert.equal(state.selected.tree, bindings.candidateTree);\n  state.sourceRematerialized = 0;\n");
replace('no source staging', "  write(join(sourceRoot, 'package.json'), '{\"private\":true,\"type\":\"module\"}\\n'); stageFixtures(sourceRoot); sourceSnapshot = tree(sourceRoot);\n", '');
replace('exact authenticated archived tarball, no ephemeral fallback', "  const pack = fs.readFileSync(bindings.pack.path); assert.equal(pack.length, 726693); assert.equal(sha(pack), packSha);", "  const pack = priorCapture.retained.get('reproducible-input/candidate.tgz'); assert.equal(pack.length, 726693); assert.equal(sha(pack), packSha);");
replace('setup only, no P02 or nineteen-times-two rescore', "  append({ id: 'P02', details: state.package });\n  for (const id of semanticIds) await semantic(sourceRoot, 'source', id);\n  for (const id of semanticIds) await semantic(movedRoot, 'moved', id);", "  state.package.classification = 'continuation setup only; no P02 rescore';");
replace('only corrected T03 and previously unrun T04', "  for (const control of read(join(frozen, 'type-controls.json')).controls) {", "  for (const control of read(join(frozen, 'type-controls.json')).controls.filter(row => ['T03', 'T04'].includes(row.case))) {");
replace('unchanged T05 data, no family copy', "  for (const [label, file, expected] of aggregate) state.types.push(await compile(movedRoot, label, fs.readFileSync(join(recipe, file)), expected));", "  for (const [label, file, expected] of aggregate) state.types.push(await compile(movedRoot, label, fs.readFileSync(join(priorRecipe, file)), expected));");
replace('composed completion, not original all-pass footer', "  assert.deepEqual(state.cases.map(row => row.id).sort(), allIds.toSorted());\n  assert.equal(state.source.length, 19); assert.equal(state.moved.length, 19);\n  state.controls.push({ id: 'P03-addendum', status: 'PASS-new-positive-public-completion', uniqueFrozenCases: 29, physicallyMoved: true, actualLoads: true, strictTypes: true });\n  state.status = 'SCOPED_DU29_ASSERTIONS_PASSED';", "  assert.deepEqual(state.cases.map(row => row.id).sort(), continuationIds.toSorted());\n  assert.deepEqual([...priorResult.cases, ...state.cases].map(row => row.id).sort(), allIds.toSorted());\n  assert.equal(state.source.length, 0); assert.equal(state.moved.length, 0);\n  state.controls.push({ id: 'P03-addendum', status: 'PASS-composed-public-completion', uniqueFrozenCases: 29, priorQualified: 22, newlyQualified: 7, physicallyMoved: true, actualRuntimeLoads: 'bound83645ad0', newActualDeclarationReads: true });\n  state.status = 'COMPOSED_SCOPED_DU29_QUALIFIED';");
replace('separate continuation unexecuted set', "  state.actualFrozenPasses = state.cases.length; state.unexecuted = allIds.filter(id => !state.cases.some(row => row.id === id));", "  state.actualFrozenPasses = state.cases.length; state.unexecuted = continuationIds.filter(id => !state.cases.some(row => row.id === id));\n  state.composedQualified = 22 + state.cases.length;");
assert.ok(!executor.includes('await semantic(')); assert.ok(executor.includes(diagnosticBody));
put('executor.mjs', executor);
let launch = fs.readFileSync(join(priorRecipe, 'launch.mjs'), 'utf8');
launch = launch.replace("const bindings = JSON.parse(fs.readFileSync(join(directory, 'BINDINGS.json')));", "const priorDirectory = join(directory, '../../public29-v1');\nassert.equal(hash(fs.readFileSync(join(priorDirectory, 'EVIDENCE-MANIFEST.json'))), 'c1c45fd86a7d9e24f8d31271a09c511a234723f69bb3169025ac8e0b9ae29f51');\nconst priorManifest = JSON.parse(fs.readFileSync(join(priorDirectory, 'EVIDENCE-MANIFEST.json')));\nfor (const [name, digest] of Object.entries(priorManifest.files)) assert.equal(hash(fs.readFileSync(join(priorDirectory, name))), digest, name);\nconst bindings = JSON.parse(fs.readFileSync(join(priorDirectory, 'recipe/BINDINGS.json')));");
put('launch.mjs', launch);
const originalReplay = json(join(priorRecipe, 'replay-bindings.json'));
const updates = { supervisorIdentity: { path: `${prefix}/executor.mjs`, sha256: sha(fs.readFileSync(join(recipe, 'executor.mjs'))) }, admissionPolicy: { path: `${prefix}/RECIPE.md`, sha256: sha(fs.readFileSync(join(recipe, 'RECIPE.md'))), mode: 'scoped-committed-archive', postRunDetectsNewEntries: true }, replayAuthorization: { path: `${prefix}/ROOT-AUTHORIZATION.md`, sha256: sha(fs.readFileSync(join(recipe, 'ROOT-AUTHORIZATION.md'))), candidateCommit: oldBindings.candidate, freezeCommit: oldBindings.freeze } };
Object.assign(originalReplay.required, updates);
data('REPLAY-DELTA.json', { originalPath: `${oldPrefix}/replay-bindings.json`, originalSha256: sha(fs.readFileSync(join(priorRecipe, 'replay-bindings.json'))), updates, resultSha256: sha(JSON.stringify(originalReplay)), otherFieldsChanged: 0 });
const unchanged = [];
for (const [name, start, end] of [['child', 'async function child(', '\nfunction toolEnvironment('], ['compile-diagnostic-assertions', diagnosticBody, '\n  return { label, expected, diagnostics, proof, payloadSha256: sha(payload), status:'], ['package-controls-P03-through-P06', "  const missing = copyConsumer('negative-missing-export');", "  checkpoint('ALL-CASES-POST');"]]) {
  const before = name === 'compile-diagnostic-assertions' ? diagnosticBody : slice(original, start, end), after = name === 'compile-diagnostic-assertions' ? diagnosticBody : slice(executor, start, end);
  assert.equal(before, after); unchanged.push({ name, sha256: sha(before), bytes: Buffer.byteLength(before) });
}
data('ADAPTER.json', { schema: 'du-declaration-predicate-overlay/1', originalExecutor: { path: `${oldPrefix}/executor.mjs`, sha256: sha(original) }, patchedExecutor: { path: `${prefix}/executor.mjs`, sha256: sha(executor) }, originalManifestDoesNotValidatePatchedBytes: true, changes, unchanged, common: { originalSha256: sha(oldCommon), patchedSha256: sha(fs.readFileSync(join(recipe, 'common.mjs'))), delta: 'only hardcoded authenticateRecipe namespace; runtime path is derived from current file location' }, parser: { originalFunctionSha256: sha(originalParser), patchedFunctionSha256: sha(parser), delta: 'export function and retain authenticated member bytes/modes callback; all path/link/checksum/member predicates unchanged', limit: 16 * 1024 ** 2 }, diagnosticsControlBodySha256: sha(diagnosticBody), observerUnchangedSha256: sha(fs.readFileSync(join(priorRecipe, 'tool-observer.cjs'))), oldFilesWritten: 0, fixturePayloadChanges: 0, runtimeCohortExecutionsAuthorized: 0, casesAuthorized: ['T03', 'T04', 'T05', 'P03', 'P04', 'P05', 'P06'] });
console.log(JSON.stringify({ preparedAt: new Date().toISOString(), priorRecords: capture.receipt.records, roots: Object.fromEntries(Object.entries(roots).map(([name, row]) => [name, { entry: row.entrypoint, required: Object.keys(row.required).length }])), routes: Object.fromEntries(Object.entries(routes.cases).map(([name, row]) => [name, row.requiredRoots])), archiveMembers: members.size, actualNewCases: 0 }));
