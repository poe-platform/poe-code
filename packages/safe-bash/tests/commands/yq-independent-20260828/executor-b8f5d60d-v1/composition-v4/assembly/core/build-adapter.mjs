import { dirname, join } from 'node:path';
import { CANDIDATE, assertTree, atomicJson, canonical, fileDigest, identity, inside, keys, now, readBoundJson, readRegular, requireFact, sha256, snapshot } from './primitives.mjs';

const same = (actual, expected, code) => requireFact(canonical(actual) === canonical(expected), code);
function artifact(reference, context) {
  keys(reference, ['path', 'sha256', 'bytes']);
  requireFact(inside(context.request.evidenceRoot, reference.path), 'BUILD_ARTIFACT_SCOPE');
  same(fileDigest(reference.path), { sha256: reference.sha256, bytes: reference.bytes, mode: 384 }, 'BUILD_ARTIFACT_IDENTITY');
  return readBoundJson(reference.path, reference.sha256);
}
function expectedInput(context) {
  const { bindings, scratchRoot } = context.request;
  const plan = bindings.buildPlan;
  const workRoot = join(scratchRoot, plan.layout.work);
  const configRoot = join(workRoot, plan.layout.configDirectory);
  const rawRoot = join(workRoot, plan.layout.rawOutput);
  const configPath = join(configRoot, plan.layout.configName);
  const config = { extends: join(bindings.sourceRoot, 'tsconfig.build.json'), compilerOptions: { outDir: join(rawRoot, 'dist'), typeRoots: [dirname(bindings.nodeTypesRoot)] } };
  const bytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
  const compilerRequest = { kind: 'compiler', configPath, timeoutMs: 120000 };
  const expectedInvocation = { argv: [join(bindings.typescriptRoot, 'lib/tsc.js'), '--project', configPath, '--pretty', 'false'], cwd: scratchRoot, executable: { path: bindings.toolProfile.node.path, sha256: bindings.toolProfile.node.sha256 }, typescript: { path: bindings.typescriptRoot, sha256: bindings.toolProfile.typescript.sha256, version: '5.9.3' }, environment: { LANG: 'C', LC_ALL: 'C' } };
  return { workRoot, configRoot, rawRoot, configPath, config, bytes, compilerRequest, expectedInvocation, packageRoot: join(workRoot, plan.layout.package) };
}
export function enrollBuildInputs(detail, context, retained) {
  requireFact(context.job.phase === 'BUILD' && !context.enrolledBuild, 'BUILD_INPUT_SINGLE_ENROLLMENT');
  keys(detail, ['directory', 'files', 'compilerRequest', 'expectedInvocation', 'sourceRoot', 'rawOutputRoot', 'packageRoot', 'configuration']);
  const expected = expectedInput(context);
  requireFact(detail.directory === expected.workRoot && detail.rawOutputRoot === expected.rawRoot && detail.packageRoot === expected.packageRoot && detail.sourceRoot === context.request.bindings.sourceRoot, 'BUILD_GENERATED_PATHS');
  same(detail.compilerRequest, expected.compilerRequest, 'BUILD_LITERAL_COMPILER_REQUEST');
  same(detail.expectedInvocation, expected.expectedInvocation, 'BUILD_PARENT_DERIVED_INVOCATION');
  same(detail.files, [{ path: expected.configPath, kind: 'file', sha256: sha256(expected.bytes), bytes: expected.bytes.length, mode: 420 }], 'BUILD_EXACT_CONFIG_DESCRIPTOR');
  requireFact(readRegular(expected.configPath).equals(expected.bytes), 'BUILD_EXACT_CONFIG_BYTES');
  same(fileDigest(expected.configPath), { sha256: sha256(expected.bytes), bytes: expected.bytes.length, mode: 420 }, 'BUILD_CONFIG_MODE_HASH_SIZE');
  const configuration = artifact(detail.configuration, context);
  same(configuration.config, expected.config, 'BUILD_CONFIG_EVIDENCE');
  const manifest = snapshot(expected.configRoot);
  requireFact(Object.keys(manifest.files).length === 1 && Object.keys(manifest.directories).length === 1 && manifest.directories[''] === 493, 'BUILD_CONFIG_ADDED_MEMBERSHIP');
  assertTree(expected.rawRoot, { files: {}, directories: { '': 493 } });
  const registration = { root: expected.configRoot, manifest, identity: identity(expected.configRoot) };
  retained.push(registration);
  context.enrolledBuild = { ...expected, registration };
  validateBuildConfig(expected.compilerRequest, context);
}
export function validateBuildConfig(call, context) {
  const enrolled = context.enrolledBuild;
  requireFact(enrolled && context.job.phase === 'BUILD', 'BUILD_CONFIG_NOT_ENROLLED');
  const expected = expectedInput(context);
  same(call, expected.compilerRequest, 'BUILD_FIXED_COMPILER_CALL');
  assertTree(enrolled.registration.root, enrolled.registration.manifest);
  requireFact(readRegular(expected.configPath).equals(expected.bytes), 'BUILD_CONFIG_CHANGED');
  const bindings = context.request.bindings;
  assertTree(bindings.sourceRoot, bindings.sourceManifest);
  for (const [relative, config] of Object.entries(bindings.buildPlan.configs)) {
    const filename = join(bindings.sourceRoot, relative);
    same(fileDigest(filename), config.identity, 'BUILD_BASELINE_CONFIG_IDENTITY');
    same(readBoundJson(filename, config.identity.sha256), config.value, 'BUILD_BASELINE_CONFIG_BODY');
  }
}
export function adoptBuildStage(output, context, admission, data, processReceipt) {
  const adoptionStartedNs = now();
  requireFact(adoptionStartedNs <= BigInt(context.request.deadline.jobNs), 'BUILD_ADOPTION_NO_REMAINING_TIME');
  requireFact(context.result.status === 'PASS' && processReceipt.code === 0 && processReceipt.signal === null && !processReceipt.timedOut && !processReceipt.overflow && processReceipt.reaped === true && context.compilers === 1, 'BUILD_STAGE_PARENT_COMPLETION');
  requireFact(output.schema === 1 && output.kind === 'INDEPENDENT_BUILD_REPRODUCTION' && output.candidate === CANDIDATE && output.independentlyCompiled === true && output.coreRevalidationRequired === true, 'BUILD_STAGE_SCHEMA');
  const expected = expectedInput(context);
  requireFact(output.sourceBuiltRoot === expected.packageRoot && output.rawOutputRoot === expected.rawRoot && output.source.root === context.request.bindings.sourceRoot && output.tools.root === context.request.bindings.toolRoot, 'BUILD_STAGE_ROOTS');
  requireFact(output.source.manifestPointer === '/manifest' && output.tools.manifestPointer === '/manifest' && output.rawOutputManifestPointer === '/manifest', 'BUILD_STAGE_POINTERS');
  const packageMap = artifact(output.sourceBuiltManifest, context);
  same(packageMap, data.packageManifest, 'BUILD_FULL870_MANIFEST');
  requireFact(Object.keys(packageMap.files).length === 870 && Object.hasOwn(packageMap.files, 'README.md'), 'BUILD_FULL_README');
  requireFact(output.packageMapSha256 === data.buildPlan.packageMapSha256 && sha256(canonical(packageMap)) === output.packageMapSha256, 'BUILD_PACKAGE_MAP_HASH');
  const source = artifact(output.source.manifest, context);
  const tools = artifact(output.tools.manifest, context);
  const raw = artifact(output.rawOutputMap, context);
  same(source.manifest, data.sourceManifest, 'BUILD_SOURCE_MANIFEST');
  requireFact(output.source.mapSha256 === data.buildPlan.sourceMapSha256 && source.sourceMapSha256 === data.buildPlan.sourceMapSha256 && sha256(canonical(source.manifest.files)) === data.buildPlan.sourceMapSha256, 'BUILD_SELECTED_SOURCE_MAP');
  same(tools.manifest, context.request.bindings.toolManifest, 'BUILD_TOOL_MANIFEST');
  requireFact(source.root === output.source.root && tools.root === output.tools.root && raw.root === output.rawOutputRoot, 'BUILD_WRAPPED_ROOTS');
  assertTree(output.source.root, source.manifest);
  assertTree(output.tools.root, tools.manifest, { fileBytes: 134217728, treeBytes: 536870912, entries: 4096 });
  assertTree(output.rawOutputRoot, raw.manifest);
  assertTree(output.sourceBuiltRoot, packageMap);
  same(output.entry, { path: join(output.sourceBuiltRoot, data.buildPlan.entry), ...packageMap.files[data.buildPlan.entry] }, 'BUILD_LOADER_ENTRY');
  same(output.declarationEntries, data.buildPlan.declarations.map(relative => ({ path: join(output.sourceBuiltRoot, relative), ...packageMap.files[relative] })), 'BUILD_DECLARATION_ENTRIES');
  for (const [reference, expectedHash] of [[output.archive, data.buildPlan.archive.packageSha256], [output.uncompressedArchive, data.buildPlan.archive.tarSha256]]) {
    requireFact(inside(context.request.evidenceRoot, reference.path) && reference.sha256 === expectedHash, 'BUILD_ARCHIVE_AUTHORITY');
    same(fileDigest(reference.path), { sha256: reference.sha256, bytes: reference.bytes, mode: 384 }, 'BUILD_ARCHIVE_POSTIMAGE');
  }
  const proof = artifact(output.proof, context);
  requireFact(proof.candidate === CANDIDATE && proof.rootGoSha256 === admission.rootHash && proof.recipeSha256 === admission.recipeHash && proof.classification === 'INDEPENDENT_BUILD_REPRODUCTION' && proof.independentlyCompiled === true && proof.compilerAttempts === 1 && proof.serializationAttempts === 1 && proof.retries === 0, 'BUILD_PROOF_BINDING');
  same(proof.packageMap, output.sourceBuiltManifest, 'BUILD_PROOF_PACKAGE_REFERENCE');
  same(proof.rawOutputMap, output.rawOutputMap, 'BUILD_PROOF_RAW_REFERENCE');
  same(proof.packed, output.archive, 'BUILD_PROOF_ARCHIVE_REFERENCE');
  same(proof.tar, output.uncompressedArchive, 'BUILD_PROOF_TAR_REFERENCE');
  same(proof.comparisonRecord, output.comparisons, 'BUILD_PROOF_COMPARISON_REFERENCE');
  const compilerCapture = artifact(proof.compilerCapture, context);
  const compilerReturn = artifact(compilerCapture.rawReceipt, context);
  const actualTools = context.rawReceipts.filter(receipt => receipt.role === 'tool');
  requireFact(actualTools.length === 1 && actualTools[0].code === 0 && actualTools[0].signal === null && !actualTools[0].timedOut && !actualTools[0].overflow && actualTools[0].reaped === true, 'BUILD_ACTUAL_SINGLE_COMPILER');
  same(compilerReturn.raw, actualTools[0], 'BUILD_RAW_COMPILER_PROVENANCE');
  same(compilerReturn.expectedInvocation, expected.expectedInvocation, 'BUILD_EXPECTED_INVOCATION_EVIDENCE');
  const comparisonRecord = artifact(output.comparisons, context);
  const comparisons = comparisonRecord.comparisons;
  requireFact(Array.isArray(comparisons) && comparisons.length === 868 && new Set(comparisons.map(item => item.path)).size === 868, 'BUILD_COMPARISON_MEMBERSHIP');
  same(comparisons.map(item => item.path).sort(), Object.keys(packageMap.files).filter(relative => !['README.md', 'package.json'].includes(relative)).sort(), 'BUILD_COMPLETE_OUTPUT_PATHS');
  requireFact(comparisonRecord.mapChecks === 434 && comparisonRecord.nonMapChecks === 434 && comparisonRecord.finalEqual === 868 && comparisonRecord.mismatches.length === 0, 'BUILD_COMPARISON_COUNTS');
  same(comparisonRecord.rawOutputMap, output.rawOutputMap, 'BUILD_COMPARISON_RAW_REFERENCE');
  for (const comparison of comparisons) {
    same(comparison.raw, raw.manifest.files[comparison.path], 'BUILD_RAW_COMPARISON_IDENTITY');
    same(comparison.expected, packageMap.files[comparison.path], 'BUILD_EXPECTED_COMPARISON_IDENTITY');
    same(comparison.final, packageMap.files[comparison.path], 'BUILD_FINAL_COMPARISON_IDENTITY');
    requireFact(comparison.finalByteEqual === true && Boolean(comparison.relocation) === comparison.path.endsWith('.map'), 'BUILD_MAP_ONLY_RELOCATION_ROLE');
    if (!comparison.relocation) requireFact(comparison.rawByteEqual === true && canonical(comparison.raw) === canonical(comparison.expected), 'BUILD_NONMAP_RAW_BYTE_EQUALITY');
  }
  const integrity = artifact(output.integrityAfter, context);
  requireFact(integrity.sourceUnchanged && integrity.toolsUnchanged && integrity.rawOutputsUnchanged && integrity.addedEntriesChecked && integrity.workRoot === expected.workRoot, 'BUILD_FINAL_INTEGRITY');
  assertTree(integrity.workRoot, integrity.workManifest);
  const adoption = { jobId: context.job.id, event: 'parent-build-stage-adoption', startedNs: adoptionStartedNs.toString(), endedNs: now().toString(), jobDeadlineNs: context.request.deadline.jobNs, outerEndedNs: processReceipt.endedNs, outerReaped: processReceipt.reaped, compilerAttempts: 1, sourceBuiltRoot: output.sourceBuiltRoot, packageMapSha256: output.packageMapSha256, rootGoSha256: admission.rootHash, recipeSha256: admission.recipeHash };
  const bytes = Buffer.byteLength(`${JSON.stringify(adoption)}\n`);
  requireFact(bytes <= context.rawBudget.remaining, 'BUILD_ADOPTION_CAPTURE_BOUND');
  context.rawBudget.remaining -= bytes;
  const parentAdoption = atomicJson(join(context.request.evidenceRoot, 'parent-build-adoption.json'), adoption);
  requireFact(now() <= BigInt(context.request.deadline.jobNs), 'BUILD_ADOPTION_DEADLINE');
  return { root: output.sourceBuiltRoot, manifest: packageMap, independentBuild: { candidate: CANDIDATE, independentlyCompiled: true, compilerCode: 0, compilerAttempts: 1, proof: output.proof, archive: output.archive, parentAdoption, rootGoSha256: admission.rootHash, recipeSha256: admission.recipeHash } };
}
