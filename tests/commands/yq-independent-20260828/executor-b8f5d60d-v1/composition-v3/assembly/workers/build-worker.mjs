import { dirname, join } from 'node:path';
import { assertTree, canonical, directoriesFor, directory, equal, freshDirectory, guard, inside, regularBytes, requireFact, sha256, snapshot, validateApi, validateManifest, writeFresh } from './build-fs.mjs';
import { compareOutputs, emittedPaths, makePackage, serializePackage } from './build-outputs.mjs';

async function saveJson(api, artifacts, name, value) {
  const receipt = await api.writeJson(`build/${name}`, value);
  requireFact(inside(api.request.evidenceRoot, receipt.path), 'EVIDENCE_LOCATION');
  const raw = await regularBytes(receipt.path, 16777216);
  requireFact(raw.identity.sha256 === receipt.sha256 && raw.identity.bytes === receipt.bytes, 'EVIDENCE_PUBLICATION');
  equal(JSON.parse(raw.bytes), value, 'EVIDENCE_JSON_VALUE');
  artifacts.push(receipt);
  return receipt;
}

async function saveBytes(api, artifacts, name, bytes) {
  const receipt = await api.writeBytes(`build/${name}`, bytes);
  requireFact(inside(api.request.evidenceRoot, receipt.path), 'EVIDENCE_LOCATION');
  const raw = await regularBytes(receipt.path, 16777216);
  requireFact(raw.identity.sha256 === receipt.sha256 && raw.identity.bytes === receipt.bytes && raw.bytes.equals(bytes), 'EVIDENCE_BYTE_VALUE');
  artifacts.push(receipt);
  return receipt;
}

async function admit(api, artifacts) {
  const request = api.request, bindings = request.bindings;
  const plan = await api.readBoundJson('buildPlan');
  requireFact(sha256(canonical(plan)) === '3a6718dcdc7e60a030f439fa7d9f0f495128daa8df8621deee0d523b00716301', 'SEALED_BUILD_PLAN');
  requireFact(plan.candidate === bindings.candidate && plan.coreVersion === api.version, 'BUILD_PLAN_ORIGIN');
  const source = await api.readBoundJson('sourceManifest');
  const expectedPackage = await api.readBoundJson('packageManifest');
  requireFact(sha256(canonical(source)) === plan.sourceManifestCanonicalSha256 && sha256(canonical(source.files)) === plan.sourceMapSha256, 'SOURCE_MANIFEST_PIN');
  requireFact(sha256(canonical(expectedPackage)) === plan.packageMapSha256, 'PACKAGE_MANIFEST_PIN');
  validateManifest(source, plan.bounds); validateManifest(expectedPackage, plan.bounds);
  requireFact(Object.keys(source.files).length === 271 && Object.keys(expectedPackage.files).length === 870, 'SELECTED_COUNTS');
  const paths = emittedPaths(source.files);
  requireFact(paths.length === 868 && new Set(paths).size === 868, 'EMITTED_SOURCE_COUNT');
  equal([...paths, 'README.md', 'package.json'].sort(), Object.keys(expectedPackage.files).sort(), 'SOURCE_OUTPUT_BIJECTION');
  for (const [path, descriptor] of Object.entries(source.files)) requireFact(descriptor.mode === 420 && !path.startsWith('tests/') && !path.includes('node_modules'), 'SOURCE_PROJECTION');
  requireFact(Object.values(expectedPackage.files).every(entry => entry.mode === 420), 'PACKAGE_MODES');
  await directory(bindings.sourceRoot); await directory(bindings.toolRoot);
  await directory(request.scratchRoot, null); await directory(request.evidenceRoot, null);
  const roots = [bindings.sourceRoot, bindings.toolRoot, request.scratchRoot, request.evidenceRoot];
  for (const root of roots) requireFact(root !== plan.forbiddenWorkspace && !inside(plan.forbiddenWorkspace, root), 'WORKSPACE_INPUT_FORBIDDEN');
  for (const [index, root] of roots.entries()) for (const other of roots.slice(index + 1)) requireFact(root !== other && !inside(root, other) && !inside(other, root), 'ROOT_OVERLAP');
  await guard(api);
  const sourceBefore = await assertTree(bindings.sourceRoot, source, plan.bounds);
  for (const [path, config] of Object.entries(plan.configs)) {
    const raw = await regularBytes(join(bindings.sourceRoot, path), plan.bounds.fileBytes, config.identity);
    equal(JSON.parse(raw.bytes), config.value, 'BASELINE_CONFIG_UNCHANGED');
  }
  const tools = await api.readBoundJson('toolManifest');
  equal(Object.keys(tools).sort(), ['node', 'nodeTypes', 'typescript', 'undiciTypes'], 'TOOL_MANIFEST_KEYS');
  const toolFiles = {};
  for (const name of ['node', 'typescript', 'nodeTypes', 'undiciTypes']) {
    const expected = plan.tools[name], actual = tools[name], path = join(bindings.toolRoot, expected.relativePath);
    requireFact(actual?.path === path && actual.sha256 === expected.pin.sha256, 'COPIED_TOOL_PIN');
    if (expected.pin.version) requireFact(actual.version === expected.pin.version, 'COPIED_TOOL_VERSION');
    if (expected.pin.entries) requireFact(actual.entries === expected.pin.entries, 'COPIED_TOOL_COUNT');
    if (name === 'node') toolFiles[expected.relativePath] = { sha256: expected.pin.sha256, bytes: expected.pin.bytes, mode: expected.pin.mode };
    else for (const [child, descriptor] of Object.entries(expected.tree.files)) toolFiles[`${expected.relativePath}/${child}`] = descriptor;
  }
  requireFact(tools.typescript.path === bindings.typescriptRoot && tools.nodeTypes.path === bindings.nodeTypesRoot && tools.undiciTypes.path === bindings.undiciTypesRoot, 'TOOL_BINDING_PATHS');
  const toolTree = { files: toolFiles, directories: directoriesFor(toolFiles) };
  const toolsBefore = await assertTree(bindings.toolRoot, toolTree, plan.bounds, plan.tools.node.relativePath);
  const sourceBeforeReceipt = await saveJson(api, artifacts, 'source-before.json', { root: bindings.sourceRoot, manifest: sourceBefore, sourceMapSha256: plan.sourceMapSha256 });
  const toolsBeforeReceipt = await saveJson(api, artifacts, 'tools-before.json', { root: bindings.toolRoot, manifest: toolsBefore, pins: Object.fromEntries(Object.entries(plan.tools).map(([name, value]) => [name, value.pin])) });
  return { request, bindings, plan, source, expectedPackage, paths, tools, toolTree, sourceBefore, toolsBefore, sourceBeforeReceipt, toolsBeforeReceipt };
}

async function prepare(api, context, artifacts) {
  const { request, bindings, plan } = context;
  const workRoot = join(request.scratchRoot, plan.layout.work);
  const configRoot = join(workRoot, plan.layout.configDirectory), rawRoot = join(workRoot, plan.layout.rawOutput), packageRoot = join(workRoot, plan.layout.package);
  await freshDirectory(workRoot); await freshDirectory(configRoot); await freshDirectory(rawRoot);
  const configPath = join(configRoot, plan.layout.configName);
  const config = { extends: join(bindings.sourceRoot, 'tsconfig.build.json'), compilerOptions: { outDir: join(rawRoot, 'dist'), typeRoots: [dirname(bindings.nodeTypesRoot)] } };
  const bytes = Buffer.from(JSON.stringify(config, null, 2) + '\n');
  const identity = await writeFresh(configPath, bytes);
  const compilerRequest = { kind: 'compiler', configPath, timeoutMs: 120000 };
  const expectedInvocation = { argv: [join(bindings.typescriptRoot, 'lib/tsc.js'), '--project', configPath, '--pretty', 'false'], cwd: request.scratchRoot, executable: { path: context.tools.node.path, sha256: plan.tools.node.pin.sha256 }, typescript: { path: bindings.typescriptRoot, sha256: plan.tools.typescript.pin.sha256, version: '5.9.3' }, environment: { LANG: 'C', LC_ALL: 'C' } };
  Object.assign(context, { workRoot, configRoot, configPath, configIdentity: identity, rawRoot, packageRoot, compilerRequest, expectedInvocation });
  const configuration = await saveJson(api, artifacts, 'compiler-request.json', { compilerRequest, expectedInvocation, config, configIdentity: { path: configPath, ...identity }, sourceRoot: bindings.sourceRoot, sourceMapSha256: plan.sourceMapSha256, baselineConfigs: plan.configs, deadlines: request.deadline, noPolicyOverrides: true });
  await api.note('generated-build-inputs', { directory: workRoot, files: [{ path: configPath, kind: 'file', ...identity }], compilerRequest, expectedInvocation, sourceRoot: bindings.sourceRoot, rawOutputRoot: rawRoot, packageRoot, configuration });
  await guard(api);
  return configuration;
}

async function captureCompiler(api, context, tool, artifacts) {
  const rawReceipt = await saveJson(api, artifacts, 'compiler-return.json', { compilerRequest: context.compilerRequest, expectedInvocation: context.expectedInvocation, raw: tool });
  await api.phase('capture', { role: 'compiler-raw-before-assertions', rawReceipt });
  context.capturePhase = true;
  requireFact(tool && tool.reaped === true, 'COMPILER_REAP_UNKNOWN');
  requireFact(typeof tool.timedOut === 'boolean' && (tool.code === null || Number.isInteger(tool.code)) && (tool.signal === null || typeof tool.signal === 'string'), 'COMPILER_RESULT_SCHEMA');
  requireFact(tool.stdoutPath !== tool.stderrPath && inside(context.request.evidenceRoot, tool.stdoutPath) && inside(context.request.evidenceRoot, tool.stderrPath), 'COMPILER_CAPTURE_PATHS');
  let total = 0;
  const captures = {};
  for (const stream of ['stdout', 'stderr']) {
    const expectedBytes = tool[`${stream}Bytes`], expectedSha256 = tool[`${stream}Sha256`];
    requireFact(Number.isSafeInteger(expectedBytes) && expectedBytes >= 0 && /^[a-f0-9]{64}$/u.test(expectedSha256), 'COMPILER_CAPTURE_DESCRIPTOR');
    const file = await regularBytes(tool[`${stream}Path`], context.plan.bounds.compilerCombinedBytes);
    requireFact(file.identity.bytes === expectedBytes && file.identity.sha256 === expectedSha256, 'COMPILER_CAPTURE_IDENTITY');
    captures[stream] = { path: tool[`${stream}Path`], ...file.identity };
    total += expectedBytes;
  }
  requireFact(total <= context.plan.bounds.compilerCombinedBytes, 'COMPILER_CAPTURE_OVERFLOW');
  const provenance = tool.provenance;
  requireFact(provenance && typeof provenance === 'object', 'CORE_TOOL_PROVENANCE_REQUIRED');
  for (const key of ['argv', 'cwd', 'environment']) equal(provenance[key], context.expectedInvocation[key], 'COMPILER_PROVENANCE_' + key);
  requireFact(provenance.executable?.path === context.expectedInvocation.executable.path && provenance.executable?.sha256 === context.expectedInvocation.executable.sha256, 'COMPILER_NODE_PROVENANCE');
  requireFact(provenance.typescript?.path === context.expectedInvocation.typescript.path && provenance.typescript?.sha256 === context.expectedInvocation.typescript.sha256 && provenance.typescript?.version === '5.9.3', 'COMPILER_TYPESCRIPT_PROVENANCE');
  for (const key of ['startedNs', 'endedNs', 'reapedNs']) requireFact(/^[1-9][0-9]*$/u.test(provenance[key] ?? ''), 'PARENT_COMPILER_TIME');
  requireFact(BigInt(provenance.startedNs) <= BigInt(provenance.endedNs) && BigInt(provenance.endedNs) <= BigInt(provenance.reapedNs) && BigInt(provenance.reapedNs) <= BigInt(context.request.deadline.workNs), 'PARENT_COMPILER_TIME_ORDER');
  requireFact(typeof provenance.overflow === 'boolean', 'COMPILER_OVERFLOW_FIELD');
  const receipt = await saveJson(api, artifacts, 'compiler-capture.json', { rawReceipt, captures, provenance, code: tool.code, signal: tool.signal, timedOut: tool.timedOut, reaped: tool.reaped });
  context.compilerCapture = receipt;
  context.rawTree = await snapshot(context.rawRoot, context.plan.bounds);
  context.rawOutputMap = await saveJson(api, artifacts, 'raw-output-map.json', { root: context.rawRoot, manifest: context.rawTree });
  requireFact(tool.code === 0 && tool.signal === null && !tool.timedOut && !provenance.overflow && BigInt(provenance.reapedNs) - BigInt(provenance.startedNs) <= 120000000000n, 'COMPILER_UNEXPECTED_COMPLETION', false);
  return receipt;
}

async function reproduce(api, context, artifacts) {
  const { plan, paths, rawRoot, source, expectedPackage, bindings } = context;
  const comparisons = await compareOutputs(paths, context.rawTree, rawRoot, bindings.sourceRoot, source.files, expectedPackage, plan);
  const comparisonRecord = await saveJson(api, artifacts, 'output-comparisons.json', { comparisons, rawOutputMap: context.rawOutputMap, rawEqual: comparisons.filter(entry => entry.rawByteEqual).length, mapChecks: comparisons.filter(entry => entry.relocation).length, nonMapChecks: comparisons.filter(entry => !entry.relocation).length, finalEqual: comparisons.filter(entry => entry.finalByteEqual).length, mismatches: comparisons.filter(entry => !entry.finalByteEqual).map(entry => entry.path) });
  requireFact(comparisons.length === 868 && comparisons.filter(entry => entry.relocation).length === 434 && comparisons.filter(entry => !entry.relocation).length === 434 && comparisons.every(entry => entry.finalByteEqual), 'INDEPENDENT_OUTPUT_MISMATCH', false);
  context.packageStarted = true;
  await makePackage(context.packageRoot, rawRoot, bindings.sourceRoot, source.files, expectedPackage, comparisons, plan);
  context.packageTree = await assertTree(context.packageRoot, expectedPackage, plan.bounds);
  const packageMap = await saveJson(api, artifacts, 'independent-package-map.json', context.packageTree);
  const serialized = await serializePackage(context.packageRoot, context.packageTree, plan);
  const tar = await saveBytes(api, artifacts, 'independent-package.tar', serialized.tar);
  const packed = await saveBytes(api, artifacts, 'virtual-bash-0.0.0.tgz', serialized.packed);
  const packing = await saveJson(api, artifacts, 'packing.json', { tar, package: packed, expectedTarSha256: plan.archive.tarSha256, expectedPackageSha256: plan.archive.packageSha256, tarByteExact: tar.sha256 === plan.archive.tarSha256, packageByteExact: packed.sha256 === plan.archive.packageSha256, recipe: plan.packing, attempts: 1, inputRole: 'ONLY_NEW_COMPILER_OUTPUTS_EXPLICIT_MAP_RELOCATION_AND_TWO_AUTHENTICATED_SOURCE_METADATA_FILES' });
  requireFact(tar.sha256 === plan.archive.tarSha256 && packed.sha256 === plan.archive.packageSha256 && packed.bytes === plan.archive.packageBytes, 'INDEPENDENT_PACKAGE_BYTE_MISMATCH', false);
  context.completedBuild = { comparisonRecord, packageMap, packed, tar, packing, counts: { source: 271, sourceArchive: 273, compiledSource: 217, compilerOutputs: 868, rawNonMaps: 434, mapChecks: 434, rawByteEqual: comparisons.filter(entry => entry.rawByteEqual).length, mapsActuallyChanged: comparisons.filter(entry => entry.relocation && entry.relocation.before !== entry.relocation.after).length, finalByteEqual: 868, package: 870, baseline: 846, additions: 24 } };
  await api.note('generated-build-output', { root: context.packageRoot, manifest: packageMap, entry: join(context.packageRoot, plan.entry), rawRoot, rawOutputMap: context.rawOutputMap, archive: packed, classification: 'PENDING_FINAL_GUARDS_NOT_YET_PROFILE_A' });
}

async function cleanup(api, context, artifacts) {
  await api.phase('cleanup', { role: 'retention-and-integrity-no-extra-time-or-children' });
  await assertTree(context.bindings.sourceRoot, context.sourceBefore, context.plan.bounds);
  await assertTree(context.bindings.toolRoot, context.toolsBefore, context.plan.bounds, context.plan.tools.node.relativePath);
  await regularBytes(context.configPath, context.plan.bounds.fileBytes, context.configIdentity);
  const files = { [`${context.plan.layout.configDirectory}/${context.plan.layout.configName}`]: context.configIdentity };
  const raw = context.rawTree ?? await snapshot(context.rawRoot, context.plan.bounds);
  equal(await snapshot(context.rawRoot, context.plan.bounds), raw, 'RETAINED_RAW_OUTPUTS');
  for (const [path, entry] of Object.entries(raw.files)) files[`${context.plan.layout.rawOutput}/${path}`] = entry;
  let packageTree = context.packageTree;
  if (context.packageStarted) {
    packageTree ??= await snapshot(context.packageRoot, context.plan.bounds);
    equal(await snapshot(context.packageRoot, context.plan.bounds), packageTree, 'RETAINED_PACKAGE_OUTPUTS');
    for (const [path, entry] of Object.entries(packageTree.files)) files[`${context.plan.layout.package}/${path}`] = entry;
  }
  const directories = directoriesFor(files);
  for (const [path, mode] of Object.entries(raw.directories)) directories[path ? `${context.plan.layout.rawOutput}/${path}` : context.plan.layout.rawOutput] = mode;
  if (context.packageStarted) for (const [path, mode] of Object.entries(packageTree.directories)) directories[path ? `${context.plan.layout.package}/${path}` : context.plan.layout.package] = mode;
  const actualWork = await snapshot(context.workRoot, context.plan.bounds);
  equal(actualWork, { files, directories }, 'WHOLE_BUILD_SCRATCH_MEMBERSHIP');
  await guard(api);
  return saveJson(api, artifacts, 'integrity-after.json', { sourceRoot: context.bindings.sourceRoot, sourceMapSha256: context.plan.sourceMapSha256, toolsRoot: context.bindings.toolRoot, sourceUnchanged: true, toolsUnchanged: true, rawOutputsUnchanged: true, packageManifest: packageTree, workRoot: context.workRoot, workManifest: actualWork, addedEntriesChecked: true, transactionOrChangeRestoreGuarantee: false });
}

export async function runWorker(api) {
  validateApi(api);
  await api.phase('setup', { role: 'independent-build', compilerMaximum: 1, outerCapMs: 300000 });
  await api.phase('admission', { candidate: api.request.bindings.candidate });
  const artifacts = [];
  let context, failure = null;
  try {
    context = await admit(api, artifacts);
    context.configuration = await prepare(api, context, artifacts);
    await api.phase('operation', { compilerRequest: context.compilerRequest, role: 'one-supervisor-owned-compiler' });
    context.operationPhase = true;
    const tool = await api.runTool(context.compilerRequest);
    await captureCompiler(api, context, tool, artifacts);
    await reproduce(api, context, artifacts);
  } catch (error) {
    failure = error;
    if (context?.operationPhase && !context.capturePhase) { await api.phase('capture', { role: 'failed-operation-capture' }); context.capturePhase = true; }
    await saveJson(api, artifacts, 'failure.json', { name: error.name, code: error.code ?? null, message: error.message, outputPath: error.outputPath ?? null, partialComparisons: error.partialComparisons ?? null, unsafe: error.unsafe !== false, compilerCapture: context?.compilerCapture ?? null, rawOutputMap: context?.rawOutputMap ?? null, rawRoot: context?.rawRoot ?? null, sourceBugInferred: false, retry: false, toolOrFixtureCorrectionRequiresNewSeal: true });
  }
  if (!context?.capturePhase) {
    await guard(api);
    throw Object.assign(failure ?? new Error('BUILD_ADMISSION_INCOMPLETE'), { unsafe: true });
  }
  let integrity;
  try { integrity = await cleanup(api, context, artifacts); }
  catch (error) {
    await saveJson(api, artifacts, 'cleanup-failure.json', { name: error.name, code: error.code ?? null, message: error.message, priorFailure: failure?.message ?? null, unsafe: true });
    throw Object.assign(error, { unsafe: true });
  }
  if (failure) {
    await guard(api);
    await api.phase('complete', { status: 'FAIL', role: 'independent-build', sourceBugInferred: false });
    if (failure.unsafe !== false) throw Object.assign(failure, { unsafe: true });
    return { status: 'FAIL', proofRole: 'INDEPENDENT_BUILD_REPRODUCTION_FAILED', details: { error: failure.message, code: failure.code ?? null, integrity, compilerAttempts: 1, retry: false, sourceBugInferred: false }, artifacts };
  }
  const { plan, completedBuild } = context;
  requireFact(completedBuild, 'BUILD_RESULT_MISSING');
  const proof = await saveJson(api, artifacts, 'independent-build-proof.json', { schema: 1, classification: 'INDEPENDENT_BUILD_REPRODUCTION', independentlyCompiled: true, rootTrustedBuildReceipt: false, candidate: plan.candidate, authorEvidence: plan.evidence, handoff: plan.handoff, sourceRoot: context.bindings.sourceRoot, sourceMapSha256: plan.sourceMapSha256, packageMapSha256: plan.packageMapSha256, rootGoSha256: api.request.rootGoSha256, recipeSha256: api.request.recipeSha256, compilerRequest: context.configuration, compilerCapture: context.compilerCapture, sourceBefore: context.sourceBeforeReceipt, toolsBefore: context.toolsBeforeReceipt, rawOutputMap: context.rawOutputMap, ...completedBuild, integrityAfter: integrity, semanticPasses: 0, publicIntegration: 'ABSENT_EXPECTED', sourceMapRelocation: 'ONLY_SOURCES_0_WITH_RAW_MAPS_PRESERVED', compilerAttempts: 1, serializationAttempts: 1, retries: 0 });
  await guard(api);
  await api.phase('complete', { status: 'PASS', role: 'independent-build-only', proof });
  return { status: 'PASS', proofRole: 'INDEPENDENT_BUILD_REPRODUCTION', details: { counts: completedBuild.counts, compilerAttempts: 1, serializationAttempts: 1, rootAcceptance: false, semanticPasses: 0 }, artifacts, stageOutput: { schema: 1, kind: 'INDEPENDENT_BUILD_REPRODUCTION', candidate: plan.candidate, source: { root: context.bindings.sourceRoot, manifest: context.sourceBeforeReceipt, manifestPointer: '/manifest', mapSha256: plan.sourceMapSha256 }, tools: { root: context.bindings.toolRoot, manifest: context.toolsBeforeReceipt, manifestPointer: '/manifest' }, sourceBuiltRoot: context.packageRoot, sourceBuiltManifest: completedBuild.packageMap, packageMapSha256: plan.packageMapSha256, entry: { path: join(context.packageRoot, plan.entry), ...context.expectedPackage.files[plan.entry] }, declarationEntries: plan.declarations.map(path => ({ path: join(context.packageRoot, path), ...context.expectedPackage.files[path] })), rawOutputRoot: context.rawRoot, rawOutputMap: context.rawOutputMap, rawOutputManifestPointer: '/manifest', comparisons: completedBuild.comparisonRecord, archive: completedBuild.packed, uncompressedArchive: completedBuild.tar, proof, integrityAfter: integrity, independentlyCompiled: true, coreRevalidationRequired: true } };
}
