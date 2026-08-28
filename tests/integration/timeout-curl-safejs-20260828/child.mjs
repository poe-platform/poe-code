import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { controlledClock } from './clock.mjs';
import { exact, delayedClosed, deniedClosed } from './predicates.mjs';

const rootPath = process.env.WORKFLOW_ROOT, output = process.env.WORKFLOW_RESULT;
const cases = JSON.parse(fs.readFileSync(join(rootPath, 'harness/CASES.json'))), row = cases.rows.find(value => value.id === process.env.WORKFLOW_ID);
const serialize = error => ({ name: error?.name, code: error?.code, message: String(error?.message ?? error), limit: error?.limit, stack: error?.stack });
const events = [], pendingEngine = new Set(), pendingBridge = new Set(), unhandled = [], timers = new Set();
const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
const startedAt = new Date().toISOString();
const report = { id: process.env.WORKFLOW_ID, layout: process.env.WORKFLOW_LAYOUT, pid: process.pid, startedAt, classification: 'UNPROVED', events, assertions: [], observations: [], rawTimeout: [], setupExecutions: 0, measuredExecutions: 0, engineRuns: 0, engineSettled: 0, bridgeEntered: 0, bridgeSettled: 0, unhandled };
const persist = () => { const bytes = JSON.stringify(report, null, 2) + '\n'; assert.ok(Buffer.byteLength(bytes) <= cases.receiptMaxBytes); fs.writeFileSync(output, bytes); };
const mark = (event, detail = {}) => { assert.ok(events.length < cases.eventMaxCount, 'EVENT_BOUND'); events.push({ ordinal: events.length + 1, event, ...detail }); };
const watchdog = nativeSet(() => { report.classification = 'CONTAINMENT'; report.containment = 'CHILD_DEADLINE'; persist(); process.exit(124); }, cases.childDeadlineMs);
globalThis.setTimeout = (callback, milliseconds, ...args) => {
  const handle = nativeSet(() => { timers.delete(handle); callback(...args); }, milliseconds); timers.add(handle); return handle;
};
globalThis.clearTimeout = handle => { timers.delete(handle); return nativeClear(handle); };
process.on('unhandledRejection', error => unhandled.push(serialize(error)));
const tick = () => new Promise(done => setImmediate(done));
const gate = () => { let release; const promise = new Promise(done => { release = done; }); return { promise, release }; };
const check = (name, action) => { try { action(); report.assertions.push({ name, pass: true }); } catch (error) { report.assertions.push({ name, pass: false, error: serialize(error) }); } };
const observe = (promise, settled) => {
  const state = { settled: false };
  state.promise = Promise.resolve(promise).then(value => { state.settled = true; state.kind = 'fulfilled'; state.value = value; settled?.(state); return state; }, error => { state.settled = true; state.kind = 'rejected'; state.error = error; settled?.(state); return state; });
  return state;
};
let shell, activeContext, clock, caller, callerReason, phase = 'setup', bodyGate, disposeGate, releaseGate, nestedGate, nestedRelease;
let traffic, nestedCleanup = 0, nestedCleanupDone = 0;
const dispatch = [];
try {
  if (process.env.WORKFLOW_CONTROL) {
    const control = cases.controls.find(value => value.id === process.env.WORKFLOW_CONTROL);
    const target = control.target === 'private-source' ? '/Users/kjopek/Workspace/poe-code/packages/safejs/src/run.ts' : join(rootPath, 'harness', control.target);
    let caught; try { await import(pathToFileURL(target)); } catch (error) { caught = error; }
    report.control = { ...control, error: serialize(caught) };
    assert.equal(caught?.message, control.expected, 'DESIGNATED_LOAD_GUARD');
    report.classification = 'PASS';
  } else {
    assert.ok(row);
    const product = await import('virtual-bash');
    const { Shell, MemoryFileSystem, agentCommands, curlCommands, safeJsCommands, makeSafeJsShellModule } = product;
    const loadEngine = name => import(pathToFileURL(join(rootPath, 'node_modules/engine/src', name)));
    const { run } = await loadEngine('run.ts');
    const { Budget } = await loadEngine('interp/budget.ts');
    const { makeFsModule } = await loadEngine('modules/fs.ts');
    const { declareHostOperation } = await loadEngine('interp/host-bridge.ts');
    const filesystem = new MemoryFileSystem();
    clock = controlledClock(); caller = new AbortController(); callerReason = Object.freeze({ tag: 'WORKFLOW_HOST_CALLER' });
    bodyGate = gate(); disposeGate = gate(); releaseGate = gate(); nestedGate = gate(); nestedRelease = gate();
    const delayed = ['W04', 'W06', 'W07', 'W08'].includes(row.id);
    traffic = { authorization: [], requests: [], acquired: 0, next: 0, returned: 0, pendingNext: 0, dispose: 0, disposeDone: 0, cleanup: 0, cleanupDone: 0 };
    const runtime = {
      createBudget: options => new Budget(options), makeFsModule, declareHostOperation,
      run(source, options) {
        assert.equal(source, cases.inputs[row.input], 'EXACT_GUEST_SOURCE');
        report.engineRuns++; mark('engine-enter');
        const context = activeContext; assert.ok(context, 'ACTUAL_SAFEJS_CONTEXT');
        const modules = { ...options.modules, shell: makeSafeJsShellModule(async (command, request) => {
          assert.ok(['curl', 'nested-leaf'].includes(command), 'FROZEN_BRIDGE_COMMAND');
          assert.equal(request.fs, filesystem); assert.equal(request.signal, options.signal);
          report.bridgeEntered++; mark('bridge-enter', { command });
          const invocation = context.invoke(command, command === 'curl' ? [cases.url] : [], { signal: request.signal });
          pendingBridge.add(invocation);
          try { const result = await invocation; return { stdout: '', stderr: '', exitCode: result.exitCode }; }
          catch (error) { mark('bridge-rejected-host-boundary', { error: serialize(error), callerIdentity: error === callerReason }); throw error; }
          finally { pendingBridge.delete(invocation); report.bridgeSettled++; mark('bridge-settled'); }
        }, { fs: filesystem, signal: options.signal, replayPolicy: 'read-side-effect', declareHostOperation }) };
        const pending = Promise.resolve().then(() => run(source, { ...options, modules }));
        pendingEngine.add(pending);
        return pending.then(result => { mark('engine-return', { ok: result.ok }); return result; }, error => { mark('engine-rejected-guest-boundary', { error: serialize(error), identityNotAsserted: true }); throw error; }).finally(() => { pendingEngine.delete(pending); report.engineSettled++; mark('engine-settled'); });
      },
    };
    const transport = async request => {
      assert.equal(phase, 'measured');
      traffic.requests.push({ url: request.url, method: request.method, headers: request.headers, hasRegisterCleanup: typeof request.registerCleanup === 'function' }); mark('transport-enter');
      assert.equal(typeof request.registerCleanup, 'function', 'CLEANUP_BEFORE_ACQUISITION');
      request.registerCleanup(async () => { traffic.cleanup++; mark('transport-cleanup-enter'); if (delayed) await releaseGate.promise; traffic.cleanupDone++; mark('transport-cleanup-done'); });
      request.signal.addEventListener('abort', () => {
        mark('request-aborted', { reason: serialize(request.signal.reason) });
        if (row.id === 'W08' && !caller.signal.aborted) { callerReason = request.signal.reason; caller.abort(callerReason); mark('caller-collision-observed', { sameObservedHostReason: true }); }
      }, { once: true });
      const body = { [Symbol.asyncIterator]() {
        traffic.acquired++; let offered = false;
        return {
          async next() {
            traffic.next++; mark('body-next');
            if (!delayed) { if (offered) return { done: true }; offered = true; return { done: false, value: Buffer.from('cd') }; }
            traffic.pendingNext++; bodyGate.release();
            try {
              await new Promise((resolve, reject) => {
                const abort = () => { request.signal.removeEventListener('abort', abort); reject(request.signal.reason); };
                if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true });
              });
              assert.fail('DELAYED_BODY_MUST_ABORT');
            } finally { traffic.pendingNext--; mark('body-next-settled'); }
          },
          async return() { traffic.returned++; mark('body-return'); return { done: true }; },
        };
      } };
      return { status: row.id === 'W05' ? 302 : 200, statusText: row.id === 'W05' ? 'Found' : 'OK', headers: row.id === 'W05' ? [['location', cases.deniedUrl]] : [], httpVersion: '1.1', body,
        async dispose() { traffic.dispose++; mark('response-dispose-enter'); disposeGate.release(); if (delayed) await releaseGate.promise; traffic.disposeDone++; mark('response-dispose-done'); } };
    };
    shell = new Shell({ fs: filesystem, limits: cases.shellLimits });
    shell.use(async (context, next) => { dispatch.push({ phase, command: context.command }); if (context.command === 'safejs') activeContext = context; return next(); });
    shell.use(agentCommands(row.defaultClock ? {} : { timeout: { scheduler: clock.scheduler } }));
    shell.use(curlCommands({ authorize(request) { traffic.authorization.push({ url: request.url, attempt: request.attempt, redirectFrom: request.redirectFrom }); mark('authorize', { url: request.url }); return request.url === cases.url; }, transport, limits: cases.networkLimits }));
    shell.use(safeJsCommands({ runtime, limits: cases.safeJsLimits }));
    let marker = 0;
    shell.use({ name: 'workflow-admission-barrier', setup(host) { assert.equal(host.commands, shell.commands); marker++; } });
    report.setupExecutions++; const setup = await shell.exec('');
    exact(setup, { exitCode: 0, stdout: '', stderr: '' });
    assert.equal(marker, 1); assert.equal(dispatch.length, 0); assert.equal(clock.rows.length, 0); assert.equal(report.engineRuns, 0); assert.equal(traffic.requests.length, 0);
    mark('admission-barrier-complete', { marker, setupExecutions: report.setupExecutions }); phase = 'measured';
    const timeout = shell.commands.get('timeout'); assert.equal(typeof timeout.execute, 'function');
    shell.register({ ...timeout, execute(context) {
      const promise = Promise.resolve().then(() => timeout.execute(context));
      return promise.then(result => { report.rawTimeout.push({ kind: 'fulfilled', exitCode: result.exitCode }); return result; }, error => { report.rawTimeout.push({ kind: 'rejected', error: serialize(error), callerIdentity: error === callerReason }); throw error; });
    } }, { replace: true });
    shell.register({ name: 'nested-leaf', async execute(context) {
      context.registerCleanup(async () => { nestedCleanup++; mark('nested-cleanup-enter'); nestedGate.release(); await nestedRelease.promise; nestedCleanupDone++; mark('nested-cleanup-done'); });
      await context.stdout.write(Buffer.from('nested\n')); return { exitCode: 7 };
    } });
    const quoted = text => "'" + text.replaceAll("'", "'\\''") + "'";
    const source = row.route ? `timeout ${row.duration} curl ${row.route === 'redirect' ? '-L ' : ''}${cases.url}` : `${row.prefix ?? ''}timeout ${row.duration} safejs -e ${quoted(cases.inputs[row.input])}`;
    report.source = source; report.sourceHex = Buffer.from(source).toString('hex');
    async function execute(limits) {
      report.measuredExecutions++; const observation = observe(shell.exec(source, { signal: caller.signal, ...(limits ? { limits } : {}) }), state => {
        state.closedAtSettlement = traffic.pendingNext === 0 && traffic.cleanupDone === traffic.cleanup && traffic.disposeDone === traffic.dispose;
        mark('outer-settled', { kind: state.kind, enginePending: pendingEngine.size, bridgePending: pendingBridge.size, cleanupDone: traffic.cleanupDone, disposeDone: traffic.disposeDone, closedAtSettlement: state.closedAtSettlement });
      });
      return observation;
    }
    const publicReceipt = observation => ({ kind: observation.kind, ...(observation.kind === 'fulfilled' ? { value: { exitCode: observation.value.exitCode, stdout: observation.value.stdout, stderr: observation.value.stderr, stdoutHex: Buffer.from(observation.value.stdoutBytes).toString('hex'), stderrHex: Buffer.from(observation.value.stderrBytes).toString('hex') } } : { error: serialize(observation.error), hostCallerIdentity: observation.error === callerReason }) });
    if (row.limit) {
      const baseline = await execute({ [row.limit]: row.baselineLimit }); await baseline.promise;
      report.observations.push({ phase: 'baseline', ...publicReceipt(baseline) }); persist();
      check('UNTIGHTENED_POSITIVE', () => { assert.equal(baseline.kind, 'fulfilled'); exact(baseline.value, row.baseline); });
      const requestsBefore = traffic.requests.length, runsBefore = report.engineRuns;
      const tight = await execute({ [row.limit]: row.tightLimit }); await tight.promise;
      report.observations.push({ phase: 'tight', ...publicReceipt(tight), requestsBefore, requestsAfter: traffic.requests.length, engineRunsBefore: runsBefore, engineRunsAfter: report.engineRuns }); persist();
      check('SHARED_BUDGET_NOT_RESET', () => { assert.equal(tight.kind, 'rejected'); assert.equal(tight.error.name, 'ShellLimitError'); assert.equal(tight.error.limit, row.limit); assert.equal(tight.error.message, `Shell limit exceeded: ${row.limit}`); });
      check('REAL_NESTED_ENGINE_AND_ADMISSION', () => { assert.equal(report.engineRuns, 2); assert.equal(traffic.requests.length - requestsBefore, row.limit === 'maxCommands' ? 0 : 1); assert.equal(report.bridgeEntered, 2); });
    } else {
      const observation = await execute();
      if (row.id === 'W03') {
        await nestedGate.promise; await tick(); report.nestedPendingBeforeRelease = !observation.settled;
        persist(); nestedRelease.release();
      }
      if (delayed) {
        await bodyGate.promise; assert.equal(clock.rows.length, 1); assert.equal(clock.rows[0].milliseconds, 10);
        if (row.id === 'W07') caller.abort(callerReason); else await clock.wake(0, 10);
        await disposeGate.promise; await tick(); traffic.pendingBeforeRelease = !observation.settled;
        report.pendingAtCleanup = { public: !observation.settled, rawTimeoutSettled: report.rawTimeout.length, clockLive: clock.live, pendingEngine: pendingEngine.size, pendingBridge: pendingBridge.size }; persist();
        releaseGate.release();
      }
      await observation.promise;
      traffic.closedAtSettlement = observation.closedAtSettlement;
      report.observations.push(publicReceipt(observation)); persist();
      check('PUBLIC_BOUNDARY', () => {
        if (row.reject) { assert.equal(observation.kind, 'rejected'); assert.equal(observation.error, callerReason); assert.equal(report.rawTimeout.at(-1).kind, 'rejected'); assert.equal(report.rawTimeout.at(-1).callerIdentity, true); }
        else { assert.equal(observation.kind, 'fulfilled'); exact(observation.value, row.expected); }
      });
      if (delayed) check('OWNED_HTTP_CLEANUP', () => delayedClosed(traffic));
      if (row.id === 'W05') check('DENIED_REDIRECT_NO_EXTRA_WORK', () => deniedClosed(traffic));
      if (row.id === 'W03') check('ZERO_TIMER_NESTED_CLEANUP', () => { assert.equal(report.nestedPendingBeforeRelease, true); assert.equal(nestedCleanup, 1); assert.equal(nestedCleanupDone, 1); assert.equal(clock.rows.length, 0); assert.equal(report.bridgeEntered, 1); });
      if (row.id === 'W08') check('ACTIVATED_SAME_SENTINEL_CALLER_COLLISION', () => { assert.equal(caller.signal.aborted, true); assert.equal(events.filter(event => event.event === 'caller-collision-observed').length, 1); assert.equal(report.rawTimeout.length, 1); assert.equal(report.rawTimeout[0].kind, 'rejected'); });
    }
    await Promise.allSettled([...pendingEngine, ...pendingBridge]); await tick();
    report.traffic = traffic; report.dispatch = dispatch; report.clock = { records: clock.records, rows: clock.rows.map(({ ordinal, milliseconds, offered, cleared }) => ({ ordinal, milliseconds, offered, cleared })), live: clock.live, peak: clock.peak };
    check('ACTUAL_ENGINE_RUN_COUNT', () => assert.equal(report.engineRuns, row.route ? 0 : row.limit ? 2 : 1));
    check('CONTROLLED_TIMER_RETIREMENT', () => { assert.equal(clock.live, 0); if (!row.defaultClock) assert.equal(clock.rows.length, row.timers); });
    check('ALL_ADMITTED_NETWORK_CLOSED', () => { assert.equal(traffic.dispose, traffic.disposeDone); assert.equal(traffic.cleanup, traffic.cleanupDone); assert.equal(traffic.pendingNext, 0); });
    report.classification = report.assertions.every(result => result.pass) ? 'PASS' : 'FAIL';
  }
} catch (error) { report.fatal = serialize(error); report.classification = 'FAIL'; }
finally {
  releaseGate?.release(); nestedRelease?.release();
  try { await shell?.dispose(); await Promise.allSettled([...pendingEngine, ...pendingBridge]); await tick(); report.disposed = true; }
  catch (error) { report.disposeError = serialize(error); report.classification = 'FAIL'; }
  report.finalResources = { enginePending: pendingEngine.size, bridgePending: pendingBridge.size, activeTrackedTimers: timers.size, activeTimeoutResources: process.getActiveResourcesInfo().filter(name => name === 'Timeout').length - 1, unhandled: unhandled.length, clockLive: clock?.live ?? 0, pendingBodyNext: traffic?.pendingNext ?? 0, disposeOutstanding: (traffic?.dispose ?? 0) - (traffic?.disposeDone ?? 0), cleanupOutstanding: (traffic?.cleanup ?? 0) - (traffic?.cleanupDone ?? 0) };
  report.clean = report.disposed && Object.values(report.finalResources).every(value => value === 0);
  if (!report.clean) report.classification = 'FAIL';
  report.finishedAt = new Date().toISOString(); persist(); nativeClear(watchdog);
  globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear;
}
console.log(JSON.stringify({ id: report.id, control: report.control?.id, classification: report.classification, clean: report.clean, engineRuns: report.engineRuns, failures: report.assertions.filter(row => !row.pass).map(row => row.name), fatal: report.fatal?.message }));
process.exitCode = report.classification === 'PASS' ? 0 : 1;
