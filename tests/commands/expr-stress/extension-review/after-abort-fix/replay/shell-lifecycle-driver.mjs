import assert from 'node:assert/strict';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function latch() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
export async function run(payload) {
  const base = pathToFileURL(`${realpathSync(payload.installed)}/`).href;
  const NativeWorker = threads.Worker, workers = [], events = [];
  const admitted = latch(), retirementEntered = latch(), retirementRelease = latch(), siblingOutputEntered = latch(), siblingOutputRelease = latch();
  threads.Worker = class extends NativeWorker {
    constructor(url, options) { assert(url.href.startsWith(base)); super(url, options); this.reviewId = workers.length + 1; this.dead = false; workers.push(this); events.push({ type: 'workerStart', worker: this.reviewId, threadId: this.threadId }); this.on('exit', () => { this.dead = true; events.push({ type: 'workerExit', worker: this.reviewId }); }); }
    postMessage(request, transfer) {
      events.push({ type: 'post', worker: this.reviewId, id: request.id });
      if (this.reviewId === 1) { admitted.release(); return; }
      return super.postMessage(request, transfer);
    }
    async terminate() {
      events.push({ type: 'terminate', worker: this.reviewId });
      const code = await super.terminate();
      if (this.reviewId === 1) { retirementEntered.release(); await retirementRelease.promise; }
      events.push({ type: 'terminated', worker: this.reviewId }); return code;
    }
  };
  syncBuiltinESMExports();
  const api = await import(`${base}dist/index.js`);
  const { createExprCommand } = await import(`${base}dist/commands/expr/index.js`);
  const { RegexExecutor } = await import(`${base}dist/commands/regex-execution/client.js`);
  const originalOpen = RegexExecutor.prototype.open;
  RegexExecutor.prototype.open = function (...args) { events.push({ type: 'open' }); return originalOpen.apply(this, args); };
  const definition = createExprCommand({ regex: { maxWorkers: 2, startupTimeoutMs: 500, requestTimeoutMs: 500 } });
  const cleanups = [];
  const observed = { name: 'expr', execute(context) {
    return definition.execute({ ...context, registerCleanup(cleanup) { cleanups.push(cleanup); events.push({ type: 'registerCleanup', invocation: cleanups.length }); context.registerCleanup(cleanup); } });
  } };
  const firstShell = new api.Shell({ fs: new api.MemoryFileSystem(), commands: new api.CommandRegistry([observed]) });
  const secondShell = new api.Shell({ fs: new api.MemoryFileSystem(), commands: new api.CommandRegistry([observed]) });
  const controller = new AbortController();
  const requestedReason = payload.reason === 'zero' ? 0 : payload.reason === 'undefined-native' ? undefined : new Error('Shell abort identity');
  let firstSettled = false, disposeSettled = false, secondSettled = false;
  let result, controlFailure;
  const siblingBytes = [];
  try {
    const first = firstShell.exec('expr a : a', { signal: controller.signal }).then(value => { firstSettled = true; events.push({ type: 'firstFulfilled' }); return { state: 'fulfilled', value }; }, reason => { firstSettled = true; events.push({ type: 'firstRejected' }); return { state: 'rejected', reason }; });
    await admitted.promise;
    const second = secondShell.exec('expr b : b', { stdout: { async write(bytes) { siblingBytes.push(Buffer.from(bytes)); siblingOutputEntered.release(); await siblingOutputRelease.promise; } } }).then(value => { secondSettled = true; return value; });
    await siblingOutputEntered.promise;
    controller.abort(requestedReason);
    await retirementEntered.promise;
    const cleanupFirst = cleanups[0](), cleanupAgain = cleanups[0]();
    const disposal = firstShell.dispose().then(() => { disposeSettled = true; });
    await tick();
    result = { sameCleanupCompletion: cleanupFirst === cleanupAgain, firstSettledBeforeRetirementRelease: firstSettled, disposeSettledBeforeRetirementRelease: disposeSettled, siblingStillPending: !secondSettled, siblingAlive: !workers[1].dead, registrationPrecedesOpen: events.findIndex(event => event.type === 'registerCleanup') < events.findIndex(event => event.type === 'open') };
    assert(result.sameCleanupCompletion); assert(!firstSettled); assert(!disposeSettled); assert(!secondSettled); assert(!workers[1].dead); assert(result.registrationPrecedesOpen);
    retirementRelease.release();
    const outcome = await first; await disposal; await cleanupFirst; await cleanupAgain;
    result.firstState = outcome.state; result.exactReason = Object.is(outcome.reason, controller.signal.reason); result.actualReasonType = typeof controller.signal.reason; result.actualReasonName = controller.signal.reason?.name;
    assert.equal(outcome.state, 'rejected'); assert(result.exactReason); assert(!workers[1].dead);
    siblingOutputRelease.release(); const sibling = await second;
    result.siblingExitCode = sibling.exitCode; result.siblingOutputBase64 = Buffer.concat(siblingBytes).toString('base64');
    assert.equal(sibling.exitCode, 0); assert.equal(Buffer.concat(siblingBytes).toString(), '1\n');
  } catch (error) { controlFailure = { name: error.name, message: error.message, stack: error.stack }; }
  finally {
    retirementRelease.release(); siblingOutputRelease.release();
    await firstShell.dispose(); await secondShell.dispose();
    RegexExecutor.prototype.open = originalOpen;
    for (const worker of workers) if (!worker.dead) await worker.terminate();
    threads.Worker = NativeWorker; syncBuiltinESMExports();
  }
  return { result, controlFailure, events, liveWorkers: workers.filter(worker => !worker.dead).length, seam: 'Actual installed Shell/command/session and native worker acquisition; first request intentionally held at postMessage, cooperative termination held after actual thread exit. Sibling executes real regex. Does not locate interruption inside compiler vs matcher.' };
}
