import assert from 'node:assert/strict';
import { assertAdmission } from './boundaries.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertBorrowedCollision } from '../repaired-f22-v1/recipe/borrowed-boundary.mjs';
import * as timeout from 'virtual-bash/commands/timeout';
import * as root from 'virtual-bash';
import { controlledClock } from '../clock.mjs';
import { controlledLatch, observeSettlement, probeFactorySurface, probeFactoryContainers, assertCallerCollision, assertDirectRetirementCollision } from '../review-preparation-v1/recipe/support.mjs';

const config = JSON.parse(fs.readFileSync(process.env.TIMEOUT_CONFIG));
const hash = value => createHash('sha256').update(value).digest('hex');
const decoder = new TextDecoder(), encoder = new TextEncoder();
const receipt = { profile: config.profile, candidate: config.candidate, cases: [], numeric: [], diagnostics: [], activations: [], status: 'RUNNING', sourceFallback: false };
const clocks = [], shells = [], tracked = [], latches = [];
const approvedRetirementDisposals = new Map();
const tick = () => new Promise(resolve => setImmediate(resolve));
const latch = () => { const value = controlledLatch(); latches.push(value); return value; };
const watch = promise => { const value = observeSettlement(promise); tracked.push(value); return value; };
const clock = options => { const value = controlledClock(options); clocks.push(value); return value; };
const encodeReason = value => ({ type: typeof value, text: String(value), name: value?.name, code: value?.code, message:value?.message, stack:value?.stack });
const waitFor = (promise, outcome, label) => {let admitted=false;return Promise.race([promise.then(value=>{admitted=true;return value;}),outcome.settled.then(value=>{if(!admitted)preserveDiagnostic('required-admission-settled',{label,outcome:diagnosticOutcome(value)});assert.fail(`${label}: handler settled before required admission (${value.status})`);})]);};

function diagnosticOutcome(outcome, sentinel) {
  if (outcome.status === 'pending') return { status: 'pending' };
  if (outcome.status === 'rejected') return { status: 'rejected', sameSentinel: Object.is(outcome.reason, sentinel), reason: encodeReason(outcome.reason) };
  const value = outcome.value;
  return { status: 'fulfilled', exitCode: value?.exitCode, stdout: value?.stdout, stderr: value?.stderr,
    stdoutBase64: value?.stdoutBytes === undefined ? null : Buffer.from(value.stdoutBytes).toString('base64'),
    stderrBase64: value?.stderrBytes === undefined ? null : Buffer.from(value.stderrBytes).toString('base64') };
}
function preserveDiagnostic(kind, observation) {
  (receipt.diagnosticObservations ??= []).push({ kind, ...observation });
  fs.appendFileSync(config.output + '/PRE-ASSERTION-OBSERVATIONS.jsonl', JSON.stringify({ kind, ...observation }) + '\n');
}

const admissionRecords=[];
async function admitPublicPlugin(instance){
  const record={ordinal:admissionRecords.length,script:'',markerEntered:0,sameRegistry:false,timeoutCallable:false,dispatch:[],clockBefore:clocks.map(value=>({records:value.records.length,live:value.live}))};
  admissionRecords.push(record);let phase='setup';
  instance.use(async(context,next)=>{record.dispatch.push({phase,command:context.command});return next();});
  instance.use({name:'timeout-independent-public-admission-marker',setup(host){record.markerEntered++;record.sameRegistry=host.commands===instance.commands;record.timeoutCallable=typeof host.commands.get('timeout')?.execute==='function';}});
  const outcome=await watch(instance.exec('')).settled;
  record.outcome=diagnosticOutcome(outcome);record.clockAfter=clocks.map(value=>({records:value.records.length,live:value.live}));
  preserveDiagnostic('plugin-admission-before-assertion',structuredClone(record));assertAdmission(record);phase='measured';return instance;
}

function integrity() {
  for (const group of config.guardRoots) {
    const actual = [];
    const visit = prefix => { for (const name of fs.readdirSync(join(group.root, prefix)).sort()) {
      assert.notEqual(name, 'AGENTS.md'); const path = prefix ? `${prefix}/${name}` : name;
      const target = join(group.root, path), stat = fs.lstatSync(target); assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) visit(path); else { assert.equal(stat.isFile(), true); actual.push({ path, mode: stat.mode & 511, bytes: stat.size, sha256: hash(fs.readFileSync(target)) }); }
    } };
    visit(''); assert.deepEqual(actual, group.entries, 'FRESH_INPUT_INTEGRITY');
  }
  for (const [path, expected] of Object.entries(config.loads)) assert.equal(hash(fs.readFileSync(path)), expected, `LOAD_INPUT_INTEGRITY:${path}`);
}
function capture(args, additions = {}) {
  const stdout = [], stderr = [], cleanups = [];
  const sink = rows => ({ async write(bytes) { rows.push(Buffer.from(bytes)); } });
  const context = { command: 'timeout', args, stdin: { async *[Symbol.asyncIterator]() {} }, stdinIsDefault: true, stdout: sink(stdout), stderr: sink(stderr), cwd: '/', env: {}, fs: root.createMemoryFileSystem(), signal: new AbortController().signal, registerCleanup(callback) { cleanups.push(callback); }, ...additions };
  return { context, cleanups, stdout: () => Buffer.concat(stdout), stderr: () => Buffer.concat(stderr) };
}
async function execute(args, options = {}, additions = {}) {
  const captured = capture(args, additions); const outcome = await watch(timeout.createTimeoutCommand(options).execute(captured.context)).settled;
  const cleanup = await Promise.allSettled(captured.cleanups.map(callback => callback()));
  return { ...captured, outcome, cleanup };
}
function returned(run, status) { preserveDiagnostic('handler-return-before-assertion',{expectedStatus:status,outcome:diagnosticOutcome(run.outcome)});assert.equal(run.outcome.status, 'fulfilled'); assert.equal(run.outcome.value.exitCode, status); }
function rejected(run, reason) { preserveDiagnostic('handler-rejection-before-assertion',{outcome:diagnosticOutcome(run.outcome,reason)});assert.equal(run.outcome.status, 'rejected'); assert.ok(Object.is(run.outcome.reason, reason)); }
function diagnostic(run, label) {
  const expected = config.diagnostics.find(row => row.label === label); assert.ok(expected, label); returned(run, expected.status);
  const bytes = expected.stream === 'stdout' ? run.stdout() : run.stderr(); const other = expected.stream === 'stdout' ? run.stderr() : run.stdout();
  assert.equal(bytes.length, expected.bytes); assert.equal(hash(bytes), expected.sha256); assert.equal(other.length, 0);
  receipt.diagnostics.push({ label, bytes: bytes.length, sha256: hash(bytes) });
}
async function blocked({ duration = '.001', maximum, scheduler, caller, result, failure, failureSet = false, noHook = false } = {}) {
  const timing = scheduler ?? clock(), gate = latch(), admitted = latch(); let signal, childClosed = false;
  const captured = capture([duration, 'fixture-block'], { ...(caller ? { signal: caller.signal } : {}), async invoke(command, args, options) {
    assert.equal(command, 'fixture-block'); signal = options.signal; admitted.resolve();
    try { await gate.promise; if (failureSet) throw failure; if (result !== undefined) return { exitCode: result }; signal.throwIfAborted(); return { exitCode: 0 }; }
    finally { childClosed = true; }
  } });
  if (noHook) delete captured.context.registerCleanup;
  const outcome = watch(timeout.createTimeoutCommand({ scheduler: timing.scheduler, ...(maximum === undefined ? {} : { maxTimerMilliseconds: maximum }) }).execute(captured.context));
  await waitFor(admitted.promise, outcome, 'blocked child');
  return { timing, captured, outcome, gate, get signal() { return signal; }, get childClosed() { return childClosed; }, async finish() { gate.resolve(); const value = await outcome.settled; const cleanup = await Promise.allSettled(captured.cleanups.map(callback => callback())); return { ...captured, outcome: value, cleanup }; } };
}
function shell(options = {}, scheduler) {
  const instance = new root.Shell({ fs: root.createMemoryFileSystem(), ...options }); shells.push(instance);
  instance.use(root.agentCommands(scheduler ? { timeout: { scheduler: scheduler.scheduler } } : {})); return instance;
}
async function retirementCollision() {
    const timing = clock(); const original = timing.scheduler.clearTimeout; let observed, entered = false, thrown = false;
    timing.scheduler.clearTimeout = function(handle) { entered = true; original.call(this, handle); thrown = true; throw observed; };
    const pending = await blocked({ scheduler: timing }); await timing.wake(0, 1); observed = pending.signal.reason; const before = pending.outcome.snapshot(); const run = await pending.finish();
    preserveDiagnostic('PC02-direct-retirement', { entered, threw: thrown, sameSentinel: Object.is(observed, pending.signal.reason), before: diagnosticOutcome(before, observed), handler: diagnosticOutcome(run.outcome, observed), childClosed: pending.childClosed, resources: timing.live, registeredCleanupRejections: run.cleanup.filter(row => row.status === 'rejected').length });
    assertDirectRetirementCollision({ localSignal: pending.signal, observedOwnReason: observed, beforeRelease: { handler: before }, handler: run.outcome, retirement: { origin: 'product-owned-scheduler-retirement', entered, threw: thrown, reason: observed }, selectedChildClosed: pending.childClosed, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
    receipt.activations.push({ id: 'PC02', actualProductRetirementEntered: entered, actualRetirementThrew: thrown, sameSentinel: true, handler: run.outcome.status, registeredCleanupRejections: run.cleanup.filter(row => row.status === 'rejected').length, resources: timing.live });
    await shellRetirementCollision(true);
}

async function shellRetirementCollision(sameSentinel) {
  const timing = clock(), clear = timing.scheduler.clearTimeout, gate = latch(), admitted = latch();
  let thrown = {}, observed, childSignal, handlerObservation, childClosed = false, retirementEntered = 0;
  timing.scheduler.clearTimeout = function(handle) { retirementEntered++; clear.call(this, handle); throw thrown; };
  const instance = await admitPublicPlugin(shell({}, timing)), actual = instance.commands.get('timeout');
  instance.register({ name: 'timeout', execute(context) { const pending = actual.execute(context); handlerObservation = watch(pending); return pending; } }, { replace: true });
  instance.register({ name: 'child', execute(context) { childSignal = context.signal; context.registerCleanup(async () => { await gate.promise; childClosed = true; }); admitted.resolve(); return { exitCode: 0 }; } });
  const outer = watch(instance.exec('timeout .001 child')); await waitFor(admitted.promise, outer, 'retirement child'); await timing.wake(0, 1); observed = childSignal.reason;
  if (sameSentinel) thrown = observed;
  const before = handlerObservation.snapshot(); assert.equal(before.status, 'pending'); gate.resolve();
  const handler = await handlerObservation.settled, outcome = await outer.settled;
  preserveDiagnostic('PC02-shell-before-assertion',{handler:diagnosticOutcome(handler,thrown),outer:diagnosticOutcome(outcome,thrown),retirementEntered,sameSentinel:Object.is(thrown,observed),childClosed,resources:timing.live});
  rejected({ outcome: handler }, thrown); assert.equal(outcome.status, 'rejected');
  assert.ok(Object.is(outcome.reason, thrown) || (outcome.reason instanceof AggregateError && outcome.reason.errors.length > 0 && outcome.reason.errors.every(error => Object.is(error, thrown))), 'UNEXPECTED_ROOT_CLEANUP_AGGREGATION');
  assert.equal(retirementEntered, 1); assert.equal(childClosed, true); assert.equal(timing.live, 0);
  if (sameSentinel) assertDirectRetirementCollision({ localSignal: childSignal, observedOwnReason: observed, beforeRelease: { handler: before }, handler, retirement: { origin: 'product-owned-scheduler-retirement', entered: true, threw: true, reason: thrown }, selectedChildClosed: childClosed, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
  const disposal = await watch(instance.dispose()).settled;
  if (disposal.status === 'rejected') assert.ok(Object.is(disposal.reason, thrown) || (disposal.reason instanceof AggregateError && disposal.reason.errors.every(error => Object.is(error, thrown))));
  approvedRetirementDisposals.set(instance, thrown);
  receipt.activations.push({ id: sameSentinel ? 'PC02' : 'F26', route: 'actual-Shell-cleanup-barrier', retirementEntered, actualRetirementThrew: true, sameSentinel: Object.is(thrown, observed), rawHandler: handler.status, outer: outcome.status, rootAggregation: outcome.reason instanceof AggregateError, childClosed, resources: timing.live, disposal: disposal.status });
}

async function callerCase(reason, collision, disposal = false, outerContext = false) {
  const timing = clock(), controller = new AbortController(), childGate = latch(), childEntered = latch(); let childSignal, handlerObservation, childClosed = false;
  const dispatch = { timeout: 0, child: 0, outer: 0 }; let invokeObservation, handlerSignal;
  const instance = await admitPublicPlugin(shell({}, timing)); const actual = instance.commands.get('timeout');
  instance.register({ name: 'timeout', execute(context) { dispatch.timeout++; handlerSignal = context.signal; handlerObservation = watch(actual.execute(context)); return handlerObservation.settled.then(row => { if (row.status === 'rejected') throw row.reason; return row.value; }); } }, { replace: true });
  instance.register({ name: 'child', execute(context) { dispatch.child++; childSignal = context.signal; context.registerCleanup(async () => { await childGate.promise; childClosed = true; }); childEntered.resolve(); return { exitCode: 0 }; } });
  if (outerContext) instance.register({ name: 'outer', execute(context) { dispatch.outer++; const pending = context.invoke('timeout', ['.001', 'child'], { signal: controller.signal }); invokeObservation = watch(pending); return pending; } });
  const outer = watch(instance.exec(outerContext ? 'outer' : 'timeout .001 child', outerContext ? {} : { signal: controller.signal })); await waitFor(childEntered.promise, outer, 'caller child'); await timing.wake(0, 1); const observed = childSignal.reason;
  controller.abort(collision ? observed : reason); await tick(); const beforeRelease = { handler: handlerObservation.snapshot(), outer: outer.snapshot() }; assert.equal(beforeRelease.handler.status, 'pending'); assert.equal(beforeRelease.outer.status, 'pending');
  const disposing = disposal ? watch(instance.dispose()) : null; if (disposing) { await tick(); assert.equal(disposing.snapshot().status, 'pending'); }
  childGate.resolve(); const handler = await handlerObservation.settled, outerResult = await outer.settled; assert.equal(childClosed, true);
  preserveDiagnostic('PC01-boundaries', { route: outerContext ? 'borrowed-outer-invoke' : 'root-caller', dispatch: { ...dispatch }, observedOwnReason: encodeReason(observed), callerAborted: controller.signal.aborted, sameCallerSentinel: Object.is(controller.signal.reason, observed), handlerSignalAborted: handlerSignal.aborted, sameHandlerSignalReason: Object.is(handlerSignal.reason, observed), beforeRelease: { handler: diagnosticOutcome(beforeRelease.handler, observed), outer: diagnosticOutcome(beforeRelease.outer, observed) }, handler: diagnosticOutcome(handler, observed), rawInvoke: invokeObservation ? diagnosticOutcome(await invokeObservation.settled, observed) : null, outer: diagnosticOutcome(outerResult, observed), childClosed, resources: timing.live });
  if (collision && outerContext) assertBorrowedCollision({ localSignal: childSignal, callerSignal: controller.signal, observedOwnReason: observed, beforeRelease, handler, rawInvoke: await invokeObservation.settled, dispatch, outer: outerResult, selectedChildClosed: true, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
  else if (collision) assertCallerCollision({ localSignal: childSignal, callerSignal: controller.signal, observedOwnReason: observed, beforeRelease, handler, outer: outerResult, selectedChildClosed: true, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
  rejected({ outcome: handler }, controller.signal.reason); if (!outerContext) rejected({ outcome: outerResult }, controller.signal.reason);
  if (disposing) assert.equal((await disposing.settled).status, 'fulfilled'); else await instance.dispose();
  receipt.activations.push({ id: collision ? 'PC01' : disposal ? 'F28' : 'F27', route: outerContext ? 'outer-context' : 'root-caller', sameSentinel: Object.is(observed, controller.signal.reason), rawHandler: handler.status, outer: outerResult.status, childClosed, resources: timing.live });
}


export { admitPublicPlugin, admissionRecords, config, receipt, clocks, shells, tracked, latches, approvedRetirementDisposals, tick, latch, watch, clock, waitFor, capture, execute, returned, rejected, blocked, shell, integrity, encodeReason, diagnosticOutcome, preserveDiagnostic, callerCase, retirementCollision };
