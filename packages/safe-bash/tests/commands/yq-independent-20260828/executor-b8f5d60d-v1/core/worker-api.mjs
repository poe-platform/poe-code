import { dirname, join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { assertTree, atomicBytes, atomicJson, canonical, deepFreeze, describeError, newDirectory, readBoundJson, requireFact, safeRelative, sha256 } from './primitives.mjs';
import { applyVariant, copyTree, moveTree } from './materialization.mjs';
import { withCandidateLoad } from './loader.mjs';
import { createFixtureContext, encodeRejection } from './frozen/context.mjs';
import { assertCapture } from './frozen/assert-capture.mjs';
import { assertCapture as assertLoadedPrimitive } from './frozen/loaded-primitive-assert.mjs';

export function createWorkerApi(request, rpc) {
  let state = -1;
  let writtenBytes = 0;
  let captureCount = 0;
  let materializations = 0;
  let assertions = 0;
  const trustedCaptures = new WeakSet();
  const captureArtifacts = new WeakMap();
  const admittedMaterializations = new WeakSet();
  let pendingPristine = null;
  let peerCaptureAcknowledged = false;
  const states = ['setup', 'admission', 'operation', 'capture', 'cleanup', 'complete'];
  const transition = async (name, detail = {}) => {
    requireFact(states.indexOf(name) === state + 1, 'WORKER_PHASE_ORDER', name);
    const event = await rpc('PHASE', { name, detail });
    state++;
    return event;
  };
  const note = (kind, detail = {}) => rpc('NOTE', { kind, detail });
  const phase = async (name, detail = {}) => {
    if (request.workerRole === 'loaded' && name === 'operation' && state === 1) return note('peer-operation-request', { ...detail, actualCommandClockStartsAfterLoaderAdmission: true });
    if (request.workerRole === 'loaded' && name === 'capture' && state === 3 && !peerCaptureAcknowledged) { peerCaptureAcknowledged = true; return note('peer-capture-acknowledgement', detail); }
    return transition(name, detail);
  };
  const writeBytes = async (relativePath, bytes) => {
    safeRelative(relativePath);
    requireFact(bytes instanceof Uint8Array && (writtenBytes += bytes.length) <= 33554432, 'WORKER_METADATA_TOTAL');
    await rpc('EVIDENCE_RESERVE', { bytes: bytes.length });
    let parent = request.evidenceRoot;
    for (const part of relative(request.evidenceRoot, dirname(join(request.evidenceRoot, relativePath))).split('/').filter(Boolean)) { parent = join(parent, part); if (!existsSync(parent)) newDirectory(parent); }
    const artifact = atomicBytes(join(request.evidenceRoot, relativePath), bytes);
    await note('artifact', artifact);
    return artifact;
  };
  const writeJson = (relativePath, value) => writeBytes(relativePath, Buffer.from(`${JSON.stringify(value)}\n`));
  const materializePackage = async ({ environment, variant = null }) => {
    requireFact(state === 1 && ['source-built-direct', 'installed-moved-direct'].includes(environment), 'MATERIALIZATION_PHASE');
    requireFact(environment === request.job.environment || request.job.phase === 'SETUP' || request.job.id === 'TYPE-PUBLIC-FIVE', 'ENVIRONMENT_BINDING');
    const source = environment === 'source-built-direct' ? request.bindings.sourceBuiltRoot : request.bindings.installedRoot;
    const baseline = environment === 'source-built-direct' ? request.bindings.sourceBuiltManifest : request.bindings.packageManifest;
    requireFact(source && baseline && request.bindings.independentBuild?.candidate === request.bindings.candidate && request.bindings.independentBuild?.independentlyCompiled === true, 'INDEPENDENT_BUILD_REQUIRED');
    assertTree(source, baseline);
    let root = source;
    let manifest = baseline;
    let movement = null;
    if (environment === 'installed-moved-direct' || variant) {
      const ordinal = materializations++;
      await rpc('RESERVE_COPY', {});
      if (variant) {
        const slot = request.bindings.mutantPlan.slots.find(item => item.id === request.job.id);
        requireFact(slot && slot.variantId === variant.id, 'MUTANT_SLOT');
        const prior = await rpc('BASELINE', { runtimeJobId: slot.runtimeJobId, environment });
        const copied = await writeJson('pristine-capture.json', prior.receipt);
        pendingPristine = { ...prior, originalCapturePath: prior.capturePath, capturePath: copied.path };
        trustedCaptures.add(pendingPristine.receipt);
        captureArtifacts.set(pendingPristine.receipt, copied);
      }
      const staging = join(request.materializationRoot, `package-${ordinal}-installed`);
      root = copyTree(source, staging, baseline);
      if (variant) {
        const enrolled = request.controlEnrollments.find(entry => entry.id === variant.id);
        manifest = applyVariant(root, baseline, variant, enrolled);
      }
      if (environment === 'installed-moved-direct') {
        movement = moveTree(staging, join(request.materializationRoot, `package-${ordinal}-moved`), manifest);
        root = movement.root;
      }
    }
    const result = { root, manifest, entry: join(root, request.bindings.compiledEntry), relativeEntry: request.bindings.compiledEntry, environment, variantId: variant?.id ?? null };
    await rpc('REGISTER_TREE', { root, manifest, movement });
    await note('materialized-package', { root, environment, variantId: result.variantId, movement });
    admittedMaterializations.add(result);
    return deepFreeze(result);
  };
  const captureSemantic = async ({ materialization, runtimeJobId }) => {
    requireFact(state === 1 && captureCount === 0, 'SEMANTIC_CAPTURE_STATE');
    requireFact(admittedMaterializations.has(materialization) && ['semantic', 'loaded'].includes(request.workerRole), 'MATERIALIZATION_CAPABILITY');
    const runtimeJob = request.bindings.runtimeJobs.find(job => job.id === runtimeJobId);
    requireFact(runtimeJob, 'RUNTIME_JOB_BINDING');
    if (['SOURCE_RUNTIME', 'MOVED_RUNTIME'].includes(request.job.phase)) requireFact(runtimeJob.id === request.job.obligationGroup, 'RUNTIME_JOB_SUBSTITUTION');
    else requireFact(request.bindings.mutantPlan.slots.find(slot => slot.id === request.job.id)?.runtimeJobId === runtimeJobId, 'LOADED_WITNESS_SUBSTITUTION');
    const fixture = createFixtureContext(runtimeJob);
    let attemptedOutputBytes = 0;
    let harnessOutputOverflow = false;
    for (const name of ['stdout', 'stderr']) {
      const originalWrite = fixture.context[name].write;
      fixture.context[name].write = async bytes => {
        attemptedOutputBytes += bytes.length;
        if (attemptedOutputBytes > 2097152) harnessOutputOverflow = true;
        return originalWrite(bytes);
      };
    }
    let status = null;
    let rejected = false;
    let rejection = null;
    const loadedEvents = [];
    let loaded;
    let cleanupErrors = [];
    await note('candidate-import-start', { root: materialization.root, entry: materialization.entry });
    try {
      const outcome = await withCandidateLoad(materialization, async namespace => {
        requireFact(typeof namespace.createYqCommand === 'function', 'YQ_FACTORY_GAP');
        const definition = namespace.createYqCommand();
        requireFact(definition.name === 'yq' && typeof definition.execute === 'function', 'DIRECT_COMMAND_ENTRY');
        await note('candidate-import-end', { root: materialization.root, entry: materialization.entry });
        await transition('operation', { operation: 'direct-command', entry: materialization.entry, startupImportExcluded: true });
        fixture.event('command-call');
        try {
          const result = await definition.execute(fixture.context);
          status = result?.exitCode ?? null;
          fixture.event('command-return', { status });
        } catch (error) {
          rejected = true;
          rejection = encodeRejection(error);
          fixture.event('command-reject', { rejection });
        }
        await note('command-settled', { status, rejected });
        await note('cooperative-cleanup-start', { withinOperationBudget: true });
        cleanupErrors = await fixture.drain();
        await note('cooperative-cleanup-end', { errors: cleanupErrors.length });
        return null;
      }, event => loadedEvents.push(event));
      loaded = outcome.loaded;
    } catch (error) {
      const partial = fixture.capture();
      await writeBytes('partial-stdout.bin', Buffer.from(partial.stdoutHex, 'hex'));
      await writeBytes('partial-stderr.bin', Buffer.from(partial.stderrHex, 'hex'));
      await writeJson('load-admission-failure.json', { error: describeError(error), loaded: loadedEvents });
      throw Object.assign(error, { unsafe: true });
    }
    const receipt = { schemaVersion: 1, jobId: runtimeJob.id, outcome: 'CAPTURED', proofRole: 'DIRECT_MODULE_PROJECTION_ONLY', binding: { candidateCommit: request.bindings.candidate, rootGoSha256: request.rootGoSha256, recipeSha256: request.recipeSha256, environment: materialization.environment, entry: materialization.entry, entrySha256: materialization.manifest.files[materialization.relativeEntry].sha256 }, capture: { ...fixture.capture(), status, rejected, rejection, cleanupErrors } };
    const stderr = Buffer.from(receipt.capture.stderrHex, 'hex').toString('utf8');
    const diagnostic = /^yq: [a-z-]+: ([A-Z][A-Z0-9_]*)(?: at [^\n]+)?\n$/u.exec(stderr);
    receipt.normalizedFacts = { completion: rejected ? 'rejection' : 'command-result', status, stdoutHex: receipt.capture.stdoutHex, stderrHex: receipt.capture.stderrHex, diagnosticCode: diagnostic?.[1] ?? null };
    loaded = { candidate: request.bindings.candidate, rootGoSha256: request.rootGoSha256, recipeSha256: request.recipeSha256, root: materialization.root, moduleCacheKey: materialization.root, parentBindingsAuthenticated: true, entry: { path: materialization.entry, sha256: materialization.manifest.files[materialization.relativeEntry].sha256 }, resolutions: loaded, factory: 'createYqCommand', supportedCommands: ['yq'], invoked: true, environment: materialization.environment, variantId: materialization.variantId, normalCompletion: !rejected && cleanupErrors.length === 0 };
    if (materialization.variantId) {
      requireFact(pendingPristine?.runtimeJobId === runtimeJobId, 'PRISTINE_PRE_ADMISSION_REQUIRED');
      loaded.pristineWitness = pendingPristine;
      trustedCaptures.add(loaded.pristineWitness.receipt);
    }
    trustedCaptures.add(receipt);
    await transition('capture', { rawBeforeAssertions: true });
    await writeBytes('captured-stdout.bin', Buffer.from(receipt.capture.stdoutHex, 'hex'));
    await writeBytes('captured-stderr.bin', Buffer.from(receipt.capture.stderrHex, 'hex'));
    const artifact = await writeJson(`capture-${captureCount++}.json`, receipt);
    captureArtifacts.set(receipt, artifact);
    await writeJson('loaded-files.json', { loaded, invoked: true, runtimeJobId, environment: materialization.environment });
    const captureOverflow = harnessOutputOverflow || rejected && /Harness (?:command output|event) capture bound/u.test(rejection?.message ?? '');
    if (captureOverflow) await writeJson('capture-overflow.json', { classification: 'HARNESS_CAPTURE_OVERFLOW_NOT_PRODUCT_BUG', attemptedOutputBytes, retainedCombinedLimit: 2097152, candidateDeclaredCombinedCap: 16777216, completeCapture: false });
    requireFact(!captureOverflow, 'HARNESS_CAPTURE_OVERFLOW_NOT_PRODUCT_BUG');
    return { receipt, capturePath: artifact.path, loaded };
  };
  const assertProjection = async ({ receipt, runtimeJobId }) => {
    requireFact(state === 3 && captureCount === 1 && existsSync(join(request.evidenceRoot, 'capture-0.json')), 'RAW_REQUIRED_BEFORE_ASSERT');
    const runtimeJob = request.bindings.runtimeJobs.find(job => job.id === runtimeJobId);
    requireFact(runtimeJob && receipt.jobId === runtimeJob.id && trustedCaptures.has(receipt), 'ASSERT_JOB_BINDING');
    const rawArtifact = captureArtifacts.get(receipt);
    requireFact(rawArtifact && canonical(readBoundJson(rawArtifact.path, rawArtifact.sha256)) === canonical(receipt), 'RAW_CAPTURE_RECEIPT_EQUALITY');
    const target = newDirectory(join(request.evidenceRoot, `projection-${assertions}`));
    await rpc('EVIDENCE_RESERVE', { bytes: 3145728 });
    let result;
    try { assertCapture(receipt, runtimeJob, target, request.bindings.diagnosticCatalogue); result = { status: 'BOUND_PROJECTION_ONLY', error: null }; }
    catch (error) { result = { status: String(error).includes('UNFULFILLED_OBLIGATIONS') || String(error).includes('INCOMPLETE_CMD22') ? 'INCOMPLETE' : 'FAIL', error: describeError(error) }; }
    result.obligationsPath = join(target, 'obligations.json');
    const primitiveBinding = readBoundJson(request.data.loadedPrimitiveBindings.path, request.data.loadedPrimitiveBindings.sha256).witnesses.find(entry => entry.id === runtimeJobId);
    if (primitiveBinding) {
      requireFact(sha256(JSON.stringify(runtimeJob)) === primitiveBinding.sha256, 'LOADED_PRIMITIVE_EXACT_JOB');
      const primitiveDirectory = newDirectory(join(request.evidenceRoot, `loaded-primitive-${assertions}`));
      await rpc('EVIDENCE_RESERVE', { bytes: 3145728 });
      let primitiveStatus;
      try { assertLoadedPrimitive(receipt, runtimeJob, primitiveDirectory, request.bindings.diagnosticCatalogue); primitiveStatus = 'BOUND_PROJECTION_ONLY'; }
      catch { primitiveStatus = 'FAIL'; }
      result.primitiveControlProjection = { status: primitiveStatus, proofRole: 'FOUR_EXISTING_LOADED_CONTROL_PRIMITIVES_ONLY', originalRecordStatus: result.status, originalObligationsPath: result.obligationsPath, fullRecordPass: false };
      if (request.workerRole === 'loaded' && primitiveStatus === 'BOUND_PROJECTION_ONLY' && result.status === 'INCOMPLETE') {
        result.fullRecordStatus = 'INCOMPLETE';
        result.status = 'BOUND_PROJECTION_ONLY';
        result.scope = 'LOADED_CONTROL_PRIMITIVES_ONLY_NOT_RECORD_OR_SEMANTIC_PASS';
      }
    }
    await writeJson(`projection-result-${assertions++}.json`, result);
    return result;
  };
  return {
    version: 'yq-b8-core-worker-v1', request: deepFreeze(request), job: request.job, bindings: request.bindings,
    phase, note, writeJson, writeBytes, materializePackage, captureSemantic, assertProjection,
    runTool: call => rpc('TOOL', call),
    guard: () => rpc('GUARD', {}),
    async readBoundJson(name) { if (name === 'toolManifest') return request.bindings.toolProfile; const descriptor = request.data[name]; requireFact(descriptor, 'UNKNOWN_BOUND_DATA'); const value = readBoundJson(descriptor.path, descriptor.sha256); return name === 'runtimeJobs' ? { jobs: value } : value; },
    async finishPhases() { while (state < 5) await phase(states[state + 1], { noAdditionalCandidateOperation: true }); },
  };
}
