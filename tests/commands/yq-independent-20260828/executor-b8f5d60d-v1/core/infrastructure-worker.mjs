import { chmodSync, existsSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertTree, atomicJson, canonical, fileDigest, newDirectory, readRegular, requireFact, sha256, snapshot } from './primitives.mjs';
import { unpackArchive, projectTree } from './materialization.mjs';
import { validateResolution } from './loader.mjs';
import { assertDiagnostic, classifyProcess, exactCompilerDiagnostic, exactReceiptIds } from './classification.mjs';
import { assertCapture } from './frozen/assert-capture.mjs';
import { assertCapture as originalAssertCapture } from './frozen/original-assert-capture.mjs';
import { prepareDeferredCase, runDeferredCase } from './frozen/deferred-fixtures.mjs';
import * as cmd22Predicate from './frozen/cmd22-read-paths.mjs';

async function authenticate(api) {
  const origins = await api.readBoundJson('origins');
  for (const origin of origins) {
    const metadata = await api.runTool({ kind: 'git-tree', revision: origin.revision, path: origin.path });
    requireFact(metadata.code === 0 && metadata.reaped && !metadata.timedOut && metadata.signal === null, 'SOURCE_GIT_TREE');
    const row = readRegular(metadata.stdoutPath).toString('utf8');
    requireFact(row === `100644 blob ${origin.blob}\t${origin.path}\0`, 'SOURCE_ORIGIN_METADATA');
    const content = await api.runTool({ kind: 'git-show', revision: origin.revision, path: origin.path });
    requireFact(content.code === 0 && content.reaped && !content.timedOut && content.signal === null && content.stdoutSha256 === origin.sha256 && content.stdoutBytes === origin.bytes, 'SOURCE_ORIGIN_BYTES');
  }
  const sourceArchive = api.bindings.archives.find(entry => entry.name === 'source');
  const packageArchive = api.bindings.archives.find(entry => entry.name === 'package');
  const archiveRoot = unpackArchive(sourceArchive.path, join(api.request.scratchRoot, 'source-archive-273'), api.bindings.archiveManifest, false, '');
  const sourceRoot = projectTree(archiveRoot, join(api.request.scratchRoot, 'consumer-source-271'), api.bindings.sourceManifest);
  const installedRoot = unpackArchive(packageArchive.path, join(api.request.scratchRoot, 'installed-unmoved-package-870'), api.bindings.packageManifest, true, 'package/');
  return { sourceRoot, archiveRoot, installedRoot };
}
async function cmd22Controls(api) {
  const definitions = await api.readBoundJson('cmd22Controls');
  const bases = await api.readBoundJson('cmd22Bases');
  const binding = await api.readBoundJson('cmd22Binding');
  requireFact(definitions.cases.length === 31, 'CMD22_DEFINITION_COUNT');
  const results = [];
  for (const definition of definitions.cases) {
    const fixture = prepareDeferredCase(definition, bases, binding);
    const evidence = newDirectory(join(api.request.scratchRoot, definition.id));
    atomicJson(join(evidence, 'raw-fixture.json'), fixture);
    results.push(await runDeferredCase({ fixture, originalAssertCapture, successorAssertCapture: assertCapture, predicate: cmd22Predicate, catalogue: api.bindings.diagnosticCatalogue, evidence }));
  }
  return { definitions: 31, results, candidateInvocations: 0, semanticPasses: 0 };
}
async function guardControl(api) {
  const declared = (await api.readBoundJson('controls')).controls.find(entry => entry.id === api.job.id);
  requireFact(declared, 'UNKNOWN_CONTROL');
  const controlRoot = newDirectory(join(api.request.scratchRoot, 'control-tree'), 0o755);
  const target = join(controlRoot, 'README.md');
  writeFileSync(target, 'owned control\n', { flag: 'wx', mode: 0o644 });
  const manifest = snapshot(controlRoot);
  const success = { code: 0, signal: null, timedOut: false, overflow: false, spawnError: null, reaped: true };
  let action;
  let expectedCode;
  let restore = () => {};
  switch (declared.name) {
    case 'frozen-input-byte': case 'wrong-source':
      writeFileSync(target, 'changed\n'); action = () => assertTree(controlRoot, manifest); expectedCode = 'TREE_INTEGRITY'; break;
    case 'added-frozen-entry': case 'postcheck-added-file':
      writeFileSync(join(controlRoot, 'added'), 'added', { flag: 'wx' }); action = () => assertTree(controlRoot, manifest); expectedCode = 'TREE_INTEGRITY'; break;
    case 'mode-mismatch':
      chmodSync(target, 0o600); action = () => assertTree(controlRoot, manifest); expectedCode = 'TREE_INTEGRITY'; break;
    case 'readme-missing':
      unlinkSync(target); action = () => assertTree(controlRoot, manifest); expectedCode = 'TREE_INTEGRITY'; break;
    case 'symlink':
      symlinkSync('README.md', join(controlRoot, 'link')); action = () => snapshot(controlRoot); expectedCode = 'SYMLINK'; restore = () => unlinkSync(join(controlRoot, 'link')); break;
    case 'reserved-diagnostic': action = () => assertDiagnostic('UNDECLARED_RESERVED_DIAGNOSTIC', api.bindings.diagnosticCatalogue); expectedCode = 'UNDECLARED_DIAGNOSTIC'; break;
    case 'classifier-nonzero': {
      const result = classifyProcess({ ...success, code: 7, stdout: 'PASS' }, true);
      requireFact(result.aggregateFailure && result.mayContinue, 'NONZERO_CLASSIFIER');
      return { control: declared, result, actualChildNonzeroWaived: false };
    }
    case 'classifier-timeout-continuation': {
      const result = classifyProcess({ ...success, timedOut: true }, true);
      const failedGuard = classifyProcess({ ...success, timedOut: true }, false);
      requireFact(result.aggregateFailure && result.mayContinue && !failedGuard.mayContinue, 'TIMEOUT_CLASSIFIER');
      return { control: declared, result, failedGuard, actualTimeoutExecuted: false };
    }
    case 'classifier-reap-stop': {
      const result = classifyProcess({ ...success, reaped: false }, true);
      requireFact(result.unsafe && !result.mayContinue, 'REAP_CLASSIFIER');
      return { control: declared, result, actualReapFailureExecuted: false };
    }
    case 'duplicate-receipts': action = () => exactReceiptIds([{ jobId: 'first' }, { jobId: 'first' }], ['first', 'second']); expectedCode = 'RECEIPT_IDS'; break;
    case 'unrelated-type-diagnostic': action = () => exactCompilerDiagnostic('fixture.mts(2,1): error TS2307: missing module', { line: 2, code: 2554 }); expectedCode = 'COMPILER_DIAGNOSTIC_MISMATCH'; break;
    case 'runtime-admission-stop': action = () => requireFact('35da18547ca82a67be9ca22b4adc21e3b8060780' === api.bindings.candidate, 'CANDIDATE_PIN'); expectedCode = 'CANDIDATE_PIN'; break;
    case 'not-moved': action = () => requireFact(!existsSync(controlRoot), 'MOVE_ORIGIN_RECREATED'); expectedCode = 'MOVE_ORIGIN_RECREATED'; break;
    case 'workspace-fallback': case 'ambient-node-modules': action = () => validateResolution(controlRoot, manifest, 'README.md', 'virtual-bash', pathToFileURL(target).href); expectedCode = 'LOADER_PACKAGE_OR_HOST_FALLBACK'; break;
    case 'outside-import-parent': action = () => validateResolution(controlRoot, manifest, 'README.md', './README.md', pathToFileURL(join(api.request.scratchRoot, 'outside.js')).href); expectedCode = 'LOADER_PARENT'; break;
    default: requireFact(false, 'UNIMPLEMENTED_CONTROL_BINDING');
  }
  await api.writeJson('control-before-assertion.json', { declaration: declared, expectedCode, controlledRoot: controlRoot, initialManifest: manifest, targetExists: existsSync(target), noProductOperation: true });
  let error = null;
  try { action(); } catch (caught) { error = { code: caught.code, message: String(caught) }; } finally { restore(); }
  requireFact(error?.code === expectedCode, 'CONTROL_EXPECTED_REFUSAL');
  return { control: declared, refusal: error, proof: 'DECLARED_COMPONENT_REFUSAL_NOT_PRODUCT_OR_ACTUAL_HOST_FAILURE' };
}
export async function runWorker(api) {
  await api.phase('admission', { role: api.job.role });
  await api.guard();
  await api.phase('operation', { infrastructureOnly: true });
  let stageOutput;
  let details;
  if (api.job.id === 'AUTH-SUCCESSOR') { stageOutput = await authenticate(api); details = { selectedOrigins: 273, archiveFiles: 273, sourceFiles: 271, packageFiles: 870, historicalModePolicy: 'DATA_ONLY_LEGACY_EXCLUDED_FROM_ACTIVE_AUTHORITY', authorArtifactBindingOnly: true }; }
  else if (api.job.id === 'SETUP-RUNTIME' || api.job.id === 'ADMIT-RUNTIME') {
    requireFact(api.bindings.independentBuild?.independentlyCompiled === true, 'BUILD_REQUIRED_BEFORE_RUNTIME');
    assertTree(api.bindings.sourceBuiltRoot, api.bindings.packageManifest);
    assertTree(api.bindings.installedRoot, api.bindings.packageManifest);
    const entry = api.bindings.compiledEntry;
    requireFact(entry === 'dist/commands/yq/index.js' && api.bindings.packageManifest.files[entry], 'DIRECT_ENTRY_REQUIRED');
    details = { sourceBuilt: api.bindings.sourceBuiltRoot, installedMovementOrigin: api.bindings.installedRoot, profiles: 2, installedUnmovedSemanticJobs: 0, publicExportClaim: false, candidateImports: 0 };
  } else if (api.job.id === 'CONTROL-CMD22-31') details = await cmd22Controls(api);
  else if (api.job.phase === 'CONTROLS') details = await guardControl(api);
  else if (api.job.id === 'FINAL-GUARDS-REAP-SEAL') { await api.guard(); details = { finalWorkerGuard: true, finalSupervisorKnownReapFollows: true, noCandidateImport: true }; }
  else requireFact(false, 'UNBOUND_INFRASTRUCTURE_JOB');
  await api.phase('capture');
  const artifact = await api.writeJson('infrastructure-result.json', details);
  await api.phase('cleanup');
  await api.guard();
  await api.phase('complete');
  return { status: 'PASS', proofRole: api.job.role, details, artifacts: [artifact], ...(stageOutput ? { stageOutput } : {}) };
}
