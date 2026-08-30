import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATE, GLOBAL_MS, assertIdentity, assertTree, atomicJson, canonical, canonicalPath, describeError, fileDigest, identity, inside, keys, milliseconds, minimum, newDirectory, now, readBoundJson, requireFact, snapshot } from './primitives.mjs';
import { guardAdmission } from './admission.mjs';
import { activeChildren, startOwned, stopAll } from './owned-process.mjs';
import { PhaseCapture } from './phase-capture.mjs';
import { cleanEnvironment, ToolBridge } from './tool-bridge.mjs';
import { classifyProcess } from './classification.mjs';
import { authenticateToolProfile } from './tool-profile.mjs';
import { summarizeCoverage } from './coverage.mjs';
import { adoptBuildStage, enrollBuildInputs } from './build-adapter.mjs';
import { JOB_CAPTURE_BYTES, captureAccounting, captureJson, chargeCapture, createJobCaptureBudget, markCaptureOverflow, terminalJson } from './capture-budget-v3.mjs';

const coreDirectory = dirname(fileURLToPath(import.meta.url));
const evidenceLimits = { entries: 8192, treeBytes: JOB_CAPTURE_BYTES, fileBytes: 16777216 };
const workLimits = { entries: 8192, treeBytes: 268435456, fileBytes: 67108864 };
export async function supervise(admission, origin) {
  const globalDeadline = origin + milliseconds(GLOBAL_MS);
  requireFact(now() < origin + milliseconds(120000), 'AUTHENTICATION_BUDGET_EXHAUSTED');
  const root = newDirectory(admission.evidenceRoot);
  const home = newDirectory(join(root, 'home'));
  const temporary = newDirectory(join(root, 'temporary'));
  const jobsRoot = newDirectory(join(root, 'jobs'));
  const worksRoot = newDirectory(join(root, 'work'));
  const closedWorks = [];
  const jobsIdentity = identity(jobsRoot);
  const worksIdentity = identity(worksRoot);
  const homeIdentity = identity(home);
  const temporaryIdentity = identity(temporary);
  const counters = { compilers: 0, git: 0, copies: 0, disk: 0, reservedLogicalBytes: 336 * 33554432 + 180 * 67108864 + 3 * 536870912 };
  requireFact(counters.reservedLogicalBytes <= 25769803776, 'FINITE_DISK_RESERVATION');
  const bridge = new ToolBridge(admission, counters);
  const data = Object.fromEntries(Object.entries(admission.recipe.data).map(([name, descriptor]) => [name, readBoundJson(descriptor.path, descriptor.sha256)]));
  requireFact(canonical(data.jobs) === canonical(admission.recipe.jobs) && canonical(data.phases) === canonical(admission.recipe.phases), 'SCHEDULE_BINDING');
  requireFact(data.jobs.length === 336 && data.phases.reduce((sum, phase) => sum + phase.capMs, 0) === GLOBAL_MS, 'FINITE_COHORT');
  requireFact(canonical(admission.root.controlEnrollments) === canonical(data.mutantPlan.variants.map(variant => variant.coreVariant)), 'EXACT_MUTANT_ENROLLMENTS');
  const toolProfile = authenticateToolProfile(admission.root.toolchain, data.typePlan.tools);
  const bindings = { candidate: CANDIDATE, sourceManifest: data.sourceManifest, packageManifest: data.packageManifest, archiveManifest: data.archiveManifest, toolRequests: data.origins, runtimeJobs: data.runtimeJobs, diagnosticCatalogue: data.diagnosticCatalogue, typePlan: data.typePlan, mutantPlan: data.mutantPlan, sourceProofPlan: data.sourceProofPlan, buildPlan: data.buildPlan, compiledEntry: 'dist/commands/yq/index.js', toolRoot: data.physicalBindings.compilerRoot, toolManifest: data.physicalBindings.compilerManifest, typescriptRoot: join(admission.root.toolchain.root, admission.root.toolchain.typescript), nodeTypesRoot: join(admission.root.toolchain.root, admission.root.toolchain.nodeTypes), undiciTypesRoot: join(admission.root.toolchain.root, admission.root.toolchain.undiciTypes), archives: admission.root.archives };
  const retained = [];
  bindings.toolProfile = toolProfile;
  const closedJobs = [];
  const pristine = new Map();
  const rows = [];
  let unsafeStop = false;
  let index = 0;
  let coordinatorFinal = null;
  let coordinatorReceived = 0;
  let coordinatorSent = 0;
  let processing = false;
  const rootNames = new Set(['home', 'temporary', 'jobs', 'work', 'coordinator-boot.json', 'coordinator.stdout.bin', 'coordinator.stderr.bin']);
  const guard = () => {
    requireFact(now() < globalDeadline, 'GLOBAL_GUARD_BUDGET');
    guardAdmission(admission);
    assertIdentity(home, homeIdentity);
    assertIdentity(temporary, temporaryIdentity);
    assertIdentity(jobsRoot, jobsIdentity);
    assertIdentity(worksRoot, worksIdentity);
    requireFact(readdirSync(home).length === 0 && readdirSync(temporary).length === 0, 'AMBIENT_HOME_TMP_EFFECT');
    for (const item of retained) { assertIdentity(item.root, item.identity); assertTree(item.root, item.manifest); if (item.movement) requireFact(!existsSync(item.movement.staging), 'MOVE_ORIGIN_RECREATED'); }
    for (const item of closedJobs) assertTree(item.root, item.manifest, evidenceLimits);
    for (const item of closedWorks) { assertIdentity(item.root, item.identity); assertTree(item.root, item.manifest, workLimits); }
    requireFact(canonical(readdirSync(worksRoot).sort()) === canonical(closedWorks.map(item => item.name).concat(currentContext ? [currentContext.name] : []).sort()), 'WORK_PARENT_ADDED_MEMBERSHIP');
    requireFact(canonical(readdirSync(jobsRoot).sort()) === canonical(closedJobs.map(item => item.name).concat(currentContext ? [currentContext.name] : []).sort()), 'JOB_PARENT_ADDED_MEMBERSHIP');
    requireFact(canonical(readdirSync(root).sort()) === canonical([...rootNames].sort()), 'EVIDENCE_ROOT_ADDED_MEMBERSHIP');
    requireFact(fileDigest(bootArtifact.path).sha256 === bootArtifact.sha256, 'COORDINATOR_BOOT_CHANGED');
    requireFact(now() < globalDeadline, 'GLOBAL_GUARD_BUDGET');
    return { integrity: true };
  };
  let currentContext = null;
  const boot = { schema: 1, candidate: CANDIDATE, nonce: randomUUID(), originNs: origin.toString(), globalDeadlineNs: globalDeadline.toString(), evidenceRoot: root, jobs: data.jobs, phases: data.phases };
  const bootArtifact = atomicJson(join(root, 'coordinator-boot.json'), boot);
  const coordinator = startOwned({ role: 'coordinator', executable: join(admission.root.toolchain.root, admission.root.toolchain.node), argv: [join(coreDirectory, 'coordinator.mjs'), bootArtifact.path, bootArtifact.sha256], cwd: root, env: cleanEnvironment(home, temporary), directory: root, name: 'coordinator', ipc: true, captureLimit: 16777216, budget: { remaining: 16777216 }, workDeadline: globalDeadline - milliseconds(5000), hardDeadline: globalDeadline });
  const runJob = async (job, requestClock) => {
    const preflightStartedNs = now().toString();
    guard();
    const preflightEndedNs = now().toString();
    const controlSlot = job.phase === 'LOADED_CONTROLS' ? data.mutantPlan.slots.find(slot => slot.id === job.id) : null;
    if (controlSlot?.variantId) {
      const prior = pristine.get(`${job.environment}/${controlSlot.runtimeJobId}`);
      const knownGap = controlSlot.variantId === 'retained-view';
      const unavailable = !prior || prior.projectionStatus !== 'PASS' || prior.loaded?.normalCompletion !== true || prior.receipt?.normalizedFacts?.completion !== 'command-result';
      if (knownGap || unavailable) {
        const contradiction = prior?.projectionStatus === 'FAIL';
        requireFact(activeChildren().every(child => child.role === 'coordinator'), 'CONTROL_GATE_UNKNOWN_REAP');
        guard();
        return { jobId: job.id, status: contradiction ? 'FAIL' : 'UNRUN', reason: contradiction ? 'PRISTINE_CONTRADICTION_RETAINED' : knownGap ? 'UNRUN_CONTROL_PRISTINE_OBSERVATION_BINDING_GAP' : 'UNRUN_CONTROL_PRISTINE_PROOF_UNAVAILABLE', aggregateFailure: true, unsafe: false, integrity: true, reaped: true, materializationRequests: 0, importRequests: 0, witnessInvocations: 0, preflightStartedNs, preflightEndedNs, reservationNs: requestClock.reservationNs };
      }
      requireFact(prior.rootGoSha256 === admission.rootHash && prior.recipeSha256 === admission.recipeHash, 'CONTROL_PRISTINE_AUTHORITY');
    }
    const name = String(index).padStart(3, '0');
    const evidenceRoot = newDirectory(join(jobsRoot, name));
    const workRoot = newDirectory(join(worksRoot, name));
    const scratchRoot = newDirectory(join(workRoot, 'scratch'), 0o755);
    const materializationRoot = newDirectory(join(workRoot, 'materializations'));
    const workDeadline = BigInt(requestClock.jobDeadlineNs) - milliseconds(5000);
    const jobBinding = job.id === 'TYPE-DIRECT-SIX' ? { ...job, environment: 'installed-moved-direct' } : job;
    const dispatch = job.phase === 'BUILD' ? 'build' : job.phase === 'TYPES' ? 'types' : job.phase === 'LOADED_CONTROLS' ? 'loaded' : ['SOURCE_RUNTIME', 'MOVED_RUNTIME'].includes(job.phase) ? 'semantic' : job.phase === 'SOURCE_AUDIT' ? 'sourceAudit' : 'infrastructure';
    const workerModule = admission.recipe.dispatch[dispatch];
    requireFact(workerModule && admission.recipe.activeRoots.some(entry => inside(entry.root, workerModule)), 'WORKER_DISPATCH');
    const request = { schema: 1, job: jobBinding, rootGoSha256: admission.rootHash, recipeSha256: admission.recipeHash, evidenceRoot, scratchRoot, materializationRoot, workerRole: dispatch, bindings: { ...bindings }, deadline: { globalNs: globalDeadline.toString(), phaseNs: requestClock.phaseDeadlineNs, jobNs: requestClock.jobDeadlineNs, workNs: workDeadline.toString(), reservationNs: requestClock.reservationNs }, nonce: randomUUID(), activeRoots: admission.recipe.activeRoots, data: admission.recipe.data, workerModule, controlEnrollments: admission.root.controlEnrollments };
    const rawBudget = createJobCaptureBudget(evidenceRoot);
    const artifact = captureJson(rawBudget, join(evidenceRoot, 'request.json'), request);
    const context = { name, job: jobBinding, request, home, temporary, tools: 0, compilers: 0, git: 0, rawBudget, rawReceipts: [], generated: [], toolFailure: false, toolPromise: null, phase: new PhaseCapture(join(evidenceRoot, 'phases.ndjson'), job, request.deadline, rawBudget), received: 0, sent: 0, result: null, unsafe: false, inflight: false, registrations: [] };
    currentContext = context;
    context.phase.record('outer-admission', { reservationNs: requestClock.reservationNs, preflightStartedNs, preflightEndedNs, workerModule, deadline: request.deadline });
    const owner = startOwned({ role: 'outer', executable: join(admission.root.toolchain.root, admission.root.toolchain.node), argv: [join(coreDirectory, 'worker-host.mjs'), artifact.path, artifact.sha256], cwd: scratchRoot, env: cleanEnvironment(home, temporary), directory: evidenceRoot, name: 'worker', ipc: true, captureLimit: 16777216, budget: context.rawBudget, workDeadline, hardDeadline: BigInt(requestClock.jobDeadlineNs), currentDeadline: () => context.phase.currentDeadline() });
    owner.child.on('message', async message => {
      try {
        requireFact(!context.inflight, 'CONCURRENT_WORKER_REQUEST');
        context.inflight = true;
        keys(message, ['schema', 'nonce', 'jobId', 'seq', 'type', 'payload']);
        requireFact(message.schema === 1 && message.nonce === request.nonce && message.jobId === job.id && message.seq === context.received++ && context.received <= 2048 && Buffer.byteLength(JSON.stringify(message)) <= 262144, 'IPC_ENVELOPE');
        let value;
        if (message.type === 'PHASE') value = context.phase.record(message.payload.name, message.payload.detail, true);
        else if (message.type === 'NOTE') {
          const { kind, detail } = message.payload;
          requireFact(kind !== 'compiler-classified' || detail.classification !== 'FIXTURE_TOOL_OR_BINDING_DEFECT', 'UNSAFE_TYPE_ADMISSION');
          if (kind === 'generated-build-inputs') {
            requireFact(job.phase === 'BUILD', 'BUILD_INPUT_ENROLLMENT_ROLE');
            enrollBuildInputs(detail, context, retained);
          }
          if (kind === 'generated-type-inputs') {
            requireFact(job.phase === 'TYPES' && inside(scratchRoot, detail.directory) && Array.isArray(detail.files) && detail.files.length === 2, 'TYPE_INPUT_ENROLLMENT');
            const slot = data.typePlan.slots.find(entry => entry.id === job.id);
            requireFact(slot && basename(detail.directory) === `type-${context.generated.length}-${slot.fixtures[context.generated.length]}`, 'TYPE_FIXTURE_ORDER');
            requireFact(canonical(detail.files.map(entry => basename(entry.path)).sort()) === canonical(['consumer.mts', 'tsconfig.json']), 'TYPE_INPUT_FILES');
            for (const entry of detail.files) requireFact(dirname(entry.path) === detail.directory && entry.kind === 'file' && canonical(fileDigest(entry.path)) === canonical({ sha256: entry.sha256, bytes: entry.bytes, mode: entry.mode }) && entry.mode === 420, 'TYPE_INPUT_DESCRIPTOR');
            const manifest = snapshot(detail.directory);
            requireFact(Object.keys(manifest.files).length === 2 && Object.keys(manifest.directories).length === 1, 'TYPE_INPUT_ADDED_MEMBERSHIP');
            const registration = { root: detail.directory, manifest, identity: identity(detail.directory) };
            retained.push(registration);
            context.generated.push({ configPath: join(detail.directory, 'tsconfig.json'), ...registration });
          }
          value = context.phase.record(kind, detail);
        }
        else if (message.type === 'GUARD') value = guard();
        else if (message.type === 'TOOL') { context.toolPromise = bridge.run(message.payload, context); value = await context.toolPromise; context.rawReceipts.push(value); context.toolPromise = null; }
        else if (message.type === 'EVIDENCE_RESERVE') { keys(message.payload, ['bytes']); requireFact(Number.isSafeInteger(message.payload.bytes) && message.payload.bytes >= 0, 'EVIDENCE_RESERVATION'); chargeCapture(context.rawBudget, message.payload.bytes); value = { reserved: message.payload.bytes }; }
        else if (message.type === 'RESERVE_COPY') { requireFact(++counters.copies <= 180, 'COPY_COUNT'); value = { reserved: counters.copies }; }
        else if (message.type === 'REGISTER_TREE') {
          const item = message.payload;
          requireFact(inside(materializationRoot, item.root) || item.root === bindings.sourceBuiltRoot, 'REGISTERED_TREE_SCOPE');
          assertTree(item.root, item.manifest);
          if (item.movement) requireFact(item.movement.moved === true && !existsSync(item.movement.staging) && canonical(identity(item.root)) === canonical(item.movement.originIdentity), 'MOVE_PROOF');
          const registration = { ...item, identity: identity(item.root) };
          if (!retained.some(existing => existing.root === item.root)) retained.push(registration);
          context.registrations.push(registration);
          value = { registered: true };
        } else if (message.type === 'BASELINE') {
          keys(message.payload, ['runtimeJobId', 'environment']);
          requireFact(job.phase === 'LOADED_CONTROLS' && message.payload.environment === job.environment, 'BASELINE_ROLE');
          const prior = pristine.get(`${message.payload.environment}/${message.payload.runtimeJobId}`);
          requireFact(prior && prior.rootGoSha256 === admission.rootHash && prior.recipeSha256 === admission.recipeHash, 'PRISTINE_WITNESS_MISSING');
          requireFact(prior.projectionStatus === 'PASS' && prior.loaded.normalCompletion === true && prior.receipt.normalizedFacts.completion === 'command-result', 'PRISTINE_WITNESS_NOT_BOUND_PROJECTION');
          guard();
          value = prior;
        } else if (message.type === 'RESULT') {
          requireFact(context.result === null && context.phase.index === 5, 'DUPLICATE_OR_EARLY_RESULT');
          keys(message.payload, ['schema', 'jobId', 'environment', 'role', 'status', 'details', 'artifacts', 'stageOutput', 'rootGoSha256', 'recipeSha256']);
          requireFact(message.payload.schema === 1 && message.payload.jobId === job.id && message.payload.environment === (jobBinding.environment ?? null) && message.payload.rootGoSha256 === admission.rootHash && message.payload.recipeSha256 === admission.recipeHash && ['PASS', 'FAIL', 'INCOMPLETE', 'UNRUN'].includes(message.payload.status), 'RECEIPT_BINDING');
          const publication = terminalJson(context.rawBudget, 'jobReceipt', join(evidenceRoot, 'job-receipt.json'), message.payload);
          requireFact(publication.complete, 'JOB_RECEIPT_CAPTURE_INCOMPLETE');
          context.result = message.payload;
          value = { recorded: true };
        } else if (message.type === 'FATAL') { context.unsafe = message.payload.unsafe !== false; context.phase.record('worker-fatal', message.payload); value = { recorded: true }; }
        else throw Object.assign(new Error('UNKNOWN_IPC_TYPE'), { unsafe: true });
        if (owner.child.connected) owner.child.send({ schema: 1, nonce: request.nonce, jobId: job.id, seq: context.sent++, type: 'REPLY', payload: { requestSeq: message.seq, value } });
      } catch (error) {
        context.unsafe = true;
        try { owner.child.send({ schema: 1, nonce: request.nonce, jobId: job.id, seq: context.sent++, type: 'REPLY', payload: { requestSeq: message.seq, error: describeError(error) } }); } catch {}
        owner.terminate(context.phase.lateFailure ? 'timeout' : 'unsafe-ipc');
      } finally { context.inflight = false; }
    });
    const processReceipt = await owner.done;
    if (context.toolPromise) { try { await context.toolPromise; } catch { context.unsafe = true; } }
    context.rawReceipts.push(processReceipt);
    let integrity = false;
    try {
      guard();
      for (const raw of context.rawReceipts) {
        for (const stream of ['stdout', 'stderr']) { const current = fileDigest(raw[`${stream}Path`]); requireFact(current.sha256 === raw[`${stream}Sha256`] && current.bytes === raw[`${stream}Bytes`] && current.mode === 384, 'RAW_CAPTURE_CHANGED'); }
        requireFact(raw.metadataArtifact, 'PROCESS_METADATA_MISSING');
        const metadata = fileDigest(raw.metadataArtifact.path);
        requireFact(metadata.sha256 === raw.metadataArtifact.sha256 && metadata.bytes === raw.metadataArtifact.bytes && metadata.mode === 384, 'PROCESS_METADATA_CHANGED');
      }
      integrity = true;
    } catch (error) { context.unsafe = true; terminalJson(context.rawBudget, 'integrityFailure', join(evidenceRoot, 'integrity-failure.json'), describeError(error)); }
    context.phase.close();
    const admissionPhaseFailure = ['AUTHENTICATION', 'BUILD', 'SETUP'].includes(job.phase) && (context.result?.status !== 'PASS' || processReceipt.code !== 0 || processReceipt.timedOut);
    const knownToolsReaped = context.rawReceipts.every(receipt => receipt.reaped === true) && activeChildren().every(child => child.role !== 'tool');
    const unsafe = context.unsafe || admissionPhaseFailure || !integrity || !processReceipt.reaped || !knownToolsReaped || (!context.result && context.phase.index < 2) || context.inflight;
    const failed = classifyProcess(processReceipt, integrity).aggregateFailure || context.toolFailure || !context.result || context.rawBudget.overflow || context.phase.lateFailure !== null;
    const result = { jobId: job.id, status: context.rawBudget.overflow || context.phase.lateFailure ? 'FAIL' : context.result?.status ?? 'UNRUN', reason: context.phase.lateFailure ? 'PHASE_DEADLINE' : context.rawBudget.overflow ? 'JOB_CAPTURE_OVERFLOW' : context.result ? null : 'MISSING_RECEIPT_OR_TIME_LIMIT', aggregateFailure: Boolean(failed || context.result?.status !== 'PASS'), unsafe, integrity, reaped: processReceipt.reaped && knownToolsReaped, process: processReceipt, receiptPath: context.result ? join(evidenceRoot, 'job-receipt.json') : null, phaseDeadlineFailure: context.phase.lateFailure, finalCaptureCheck: 'PENDING' };
    try {
      if (!failed && !unsafe && context.result?.stageOutput) {
        const output = context.result.stageOutput;
        if (job.phase === 'AUTHENTICATION') {
          for (const [key, manifest] of [['sourceRoot', data.sourceManifest], ['archiveRoot', data.archiveManifest], ['installedRoot', data.packageManifest]]) { requireFact(inside(scratchRoot, output[key]), 'AUTH_OUTPUT_ROOT'); assertTree(output[key], manifest); retained.push({ root: output[key], manifest, identity: identity(output[key]) }); bindings[key] = output[key]; }
        } else if (job.phase === 'BUILD') {
          const adopted = adoptBuildStage(output, context, admission, data, processReceipt);
          bindings.sourceBuiltRoot = adopted.root;
          bindings.sourceBuiltManifest = adopted.manifest;
          bindings.independentBuild = adopted.independentBuild;
          retained.push({ root: adopted.root, manifest: adopted.manifest, identity: identity(adopted.root) });
        } else requireFact(false, 'UNEXPECTED_STAGE_OUTPUT');
      }
      if (!failed && !unsafe && ['SOURCE_RUNTIME', 'MOVED_RUNTIME'].includes(job.phase)) {
        const capturePath = join(evidenceRoot, 'capture-0.json');
        const receipt = readBoundJson(capturePath, snapshot(evidenceRoot, evidenceLimits).files['capture-0.json'].sha256);
        const loadedProof = readBoundJson(join(evidenceRoot, 'loaded-files.json'), snapshot(evidenceRoot, evidenceLimits).files['loaded-files.json'].sha256);
        pristine.set(`${job.environment}/${job.obligationGroup}`, { runtimeJobId: job.obligationGroup, environment: job.environment, rootGoSha256: admission.rootHash, recipeSha256: admission.recipeHash, capturePath, receipt, loaded: loadedProof.loaded, projectionStatus: context.result.status, projection: context.result.details.projection ?? null });
      }
    } catch (error) {
      context.unsafe = true;
      result.status = 'FAIL'; result.aggregateFailure = true; result.unsafe = true; result.integrity = false;
      result.reason = 'POSTPROCESSING_OR_ADOPTION_FAILURE';
      result.postprocessingError = describeError(error);
      if (error.code === 'BUILD_ADOPTION_CAPTURE_BOUND') markCaptureOverflow(context.rawBudget, 'BUILD_ADOPTION_CAPTURE_BOUND', null, context.rawBudget.remaining);
      terminalJson(context.rawBudget, 'integrityFailure', join(evidenceRoot, 'integrity-failure.json'), result.postprocessingError);
    }
    const priorAccounting = captureAccounting(context.rawBudget, snapshot(evidenceRoot, evidenceLimits));
    const accounting = terminalJson(context.rawBudget, 'accounting', join(evidenceRoot, 'capture-accounting.json'), { schema: 1, beforeTerminalOutcome: priorAccounting, finalActualCheck: 'REQUIRED_AFTER_THIS_FILE_AND_OUTER_OUTCOME' });
    if (!accounting.complete) { result.status = 'FAIL'; result.aggregateFailure = true; result.unsafe = true; }
    const outcome = terminalJson(context.rawBudget, 'outerOutcome', join(evidenceRoot, 'outer-outcome.json'), result);
    if (!outcome.complete) { result.status = 'FAIL'; result.aggregateFailure = true; result.unsafe = true; }
    const manifest = snapshot(evidenceRoot, evidenceLimits);
    result.finalCaptureCheck = { ...captureAccounting(context.rawBudget, manifest), accountingArtifact: accounting.artifact, outcomeArtifact: outcome.artifact, outcomeComplete: outcome.complete };
    const workManifest = snapshot(workRoot, workLimits);
    closedWorks.push({ name, root: workRoot, manifest: workManifest, identity: identity(workRoot) });
    counters.disk += Object.values(manifest.files).concat(Object.values(workManifest.files)).reduce((sum, descriptor) => sum + descriptor.bytes, 0);
    requireFact(counters.disk <= 25769803776, 'COHORT_DISK');
    closedJobs.push({ name, root: evidenceRoot, manifest });
    currentContext = null;
    return result;
  };
  coordinator.child.on('message', async message => {
    try {
      requireFact(!processing, 'CONCURRENT_COORDINATOR_REQUEST');
      processing = true;
      keys(message, ['schema', 'nonce', 'seq', 'type', 'payload']);
      requireFact(message.schema === 1 && message.nonce === boot.nonce && message.seq === coordinatorReceived++ && Buffer.byteLength(JSON.stringify(message)) <= 262144, 'COORDINATOR_IPC');
      let value;
      if (['RUN', 'UNRUN'].includes(message.type)) {
        const job = data.jobs[index++];
        requireFact(job && message.payload.id === job.id, 'JOB_ORDER_OR_DUPLICATE');
        if (message.type === 'UNRUN') value = { jobId: job.id, status: 'UNRUN', reason: message.payload.reason, aggregateFailure: true, unsafe: unsafeStop, integrity: !unsafeStop, reaped: activeChildren().every(child => child.role === 'coordinator') };
        else {
          requireFact(!unsafeStop, 'ADMISSION_AFTER_STOP');
          const phase = data.phases.find(entry => entry.id === job.phase);
          const ceiling = minimum(globalDeadline, origin + milliseconds(phase.absoluteCutoffOffsetMs));
          requireFact(BigInt(message.payload.reservationNs) <= now() && BigInt(message.payload.jobDeadlineNs) <= BigInt(message.payload.reservationNs) + milliseconds(job.slotCapMs) && BigInt(message.payload.jobDeadlineNs) <= BigInt(message.payload.phaseDeadlineNs) && BigInt(message.payload.phaseDeadlineNs) <= ceiling, 'ABSOLUTE_CLOCK_BINDING');
          value = await runJob(job, message.payload);
          if (value.unsafe || !value.integrity || !value.reaped) unsafeStop = true;
        }
        rows.push(value);
      } else if (message.type === 'FINAL') { requireFact(index === 336 && coordinatorFinal === null, 'FINAL_COHORT'); coordinatorFinal = message.payload; rootNames.add('coordinator-summary.json'); value = { recorded: true }; }
      else if (message.type === 'COORDINATOR_FATAL') { unsafeStop = true; value = { recorded: true }; }
      else requireFact(false, 'UNKNOWN_COORDINATOR_MESSAGE');
      coordinator.child.send({ schema: 1, nonce: boot.nonce, seq: coordinatorSent++, type: 'REPLY', payload: { value } });
    } catch (error) {
      unsafeStop = true;
      try { coordinator.child.send({ schema: 1, nonce: boot.nonce, seq: coordinatorSent++, type: 'REPLY', payload: { error: describeError(error) } }); } catch {}
      coordinator.terminate('supervisor-failure');
    } finally { processing = false; }
  });
  const parent = await coordinator.done;
  rootNames.add('coordinator.process.json');
  const finalReap = await stopAll(globalDeadline);
  let finalIntegrity = false;
  try { guard(); finalIntegrity = true; } catch {}
  const recordedRowsBeforeTerminalFill = rows.length;
  const knownIds = new Set(rows.map(row => row.jobId));
  for (const job of data.jobs) if (!knownIds.has(job.id)) rows.push({ jobId: job.id, status: 'UNRUN', reason: 'PARENT_OR_ADMISSION_ABORT_NO_COMPLETE_RECEIPT', aggregateFailure: true, unsafe: true, integrity: false, reaped: finalReap });
  const final = { schema: 1, candidate: CANDIDATE, rootGoSha256: admission.rootHash, recipeSha256: admission.recipeHash, status: now() >= globalDeadline || parent.code !== 0 || parent.signal || parent.timedOut || parent.overflow || parent.spawnError !== null || parent.metadataComplete !== true || parent.metadataError !== undefined || !finalReap || !finalIntegrity || unsafeStop || !coordinatorFinal || rows.length !== 336 || rows.some(row => row.aggregateFailure) ? 'FAIL' : 'PASS_ROLE_PROJECTIONS_ONLY', parent, counters, finalReap, finalIntegrity, unsafeStop, recordedRowsBeforeTerminalFill, admittedOrUnrunRows: rows.length, activeChildren: activeChildren(), originNs: origin.toString(), absoluteGlobalDeadlineNs: globalDeadline.toString(), endedNs: now().toString(), noFull194Acceptance: true };
  if (now() < globalDeadline) atomicJson(join(root, 'coverage-194.json'), summarizeCoverage(data.ledger, data.jobs, rows));
  atomicJson(join(root, 'supervisor-final.json'), final);
  return final;
}
