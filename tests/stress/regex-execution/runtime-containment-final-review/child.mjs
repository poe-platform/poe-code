import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scope, workers, boundaries, lateErrors, admissions, hooks, metrics, retired, install, vector } from './observe.mjs';

const [job, packageRoot] = process.argv.slice(2);
const controls = ['success', 'already-aborted', 'owned-timeout', 'late-rejection'];
const jobs = ['grep-default', 'rg-default', 'grep-abort', 'rg-abort', 'grep-queued-abort', 'rg-queued-abort'];
assert.ok([...controls, ...jobs].includes(job));
const send = message => new Promise((resolveSend, reject) => process.send(message, error => error ? reject(error) : resolveSend()));
const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
const settle = promise => promise.then(value => ({ value }), error => ({ error }));
function deferred() {
  let release;
  const promise = new Promise(resolveGate => { release = resolveGate; });
  return { promise, release };
}
process.on('uncaughtExceptionMonitor', error => process.stderr.write(`uncaught: ${String(error)}\n`));
await send({ kind: 'ready', job });
await new Promise(resolveRun => process.once('message', message => { assert.deepEqual(message, { kind: 'run', job }); resolveRun(); }));
if (controls.includes(job)) {
  if (job === 'late-rejection') { setTimeout(() => { void Promise.reject(new Error('standalone preserved late rejection')); }, 5); await new Promise(() => {}); }
  if (job === 'owned-timeout') { setInterval(() => {}, 1000); await new Promise(() => {}); }
  if (job === 'already-aborted') {
    const controller = new AbortController();
    const reason = new Error('standalone already-aborted identity');
    controller.abort(reason);
    assert.throws(() => controller.signal.throwIfAborted(), error => error === reason);
  }
  assert.equal(workers.length, 0);
  await send({ kind: 'result', job, pass: true, riskConsumed: 0 });
  process.disconnect();
} else {
  const entry = import.meta.resolve('virtual-bash');
  assert.equal(entry, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
  const api = await import('virtual-bash');
  install(api);
  const family = job.startsWith('grep') ? 'grep' : 'rg';
  const command = family === 'grep' ? 'grep -E' : 'rg';
  const queued = job.includes('-queued-');
  const callerAbort = job.endsWith('-abort');
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
  const controller = new AbortController();
  const reason = new Error(`exact independent caller reason: ${job}`);
  const timers = [];
  const details = { phase: queued ? 'trusted real-worker response/control boundary; benign matching only' : 'ready worker plus accepted nonempty request; native-call entry not instrumented' };
  let failure;
  let target;
  const siblings = [];
  const started = performance.now();
  try {
    if (queued) {
      const held = deferred();
      const admitted = deferred();
      hooks.holdResponses = true;
      hooks.held = () => { if (workers.length === 2 && workers.every(record => record.held.length === 1)) held.release(); };
      hooks.admission = record => { if (record.owner === 'queued-target') admitted.release(record); };
      for (const owner of ['sibling-one', 'sibling-two']) siblings.push(scope.run(owner, () => settle(shell.exec(`${command} '^a'`, { stdin: 'ab\n' }))));
      await held.promise;
      details.beforeQueue = metrics();
      assert.equal(workers.length, 2);
      assert.equal(workers.flatMap(record => record.requests).length, 4, 'two empty validations and two benign matching requests');
      assert.ok(workers.every(record => record.readyAtMs !== null && !record.exited && record.terminationCalls === 0));
      target = scope.run('queued-target', () => settle(shell.exec(`${command} '^a'`, { stdin: 'ab\n', signal: controller.signal })));
      details.queueAdmission = await admitted.promise;
      assert.equal(admissions.length, 5, 'two sibling validations, two benign matching requests, queued target validation');
      assert.ok(admissions.every(record => record.callbackSha256 === admissions[0].callbackSha256));
      assert.equal(workers.length, 2);
      assert.equal(workers.flatMap(record => record.requests).length, 4);
      details.abortAtMs = performance.now();
      controller.abort(reason);
      const outcome = await target;
      details.abortLatencyMs = performance.now() - details.abortAtMs;
      assert.equal(outcome.error, reason);
      assert.ok(details.abortLatencyMs < 500);
      const boundary = boundaries.find(record => record.owner === 'queued-target');
      assert.equal(boundary.exactCallerReason, true);
      assert.equal(boundary.callerListeners, 0);
      assert.ok(boundary.signals.every(record => record.listeners === 0));
      assert.equal(boundary.workers.filter(record => record.owner === 'queued-target').length, 0);
      assert.equal(boundary.workers.length, 2);
      assert.ok(boundary.workers.every(record => !record.exited && record.terminationCalls === 0 && record.heldResponses === 1));
      details.queuedOwnedWorkers = 0;
      details.siblingsAliveAtQueuedSettlement = 2;
      hooks.holdResponses = false;
      for (const record of workers) record.worker.releaseResponses();
      const outcomes = await Promise.all(siblings);
      details.siblings = outcomes.map(outcome => vector(outcome.value));
      for (const outcome of outcomes) assert.deepEqual(vector(outcome.value), { exitCode: 0, stdout: Buffer.from('ab\n').toString('base64'), stderr: '' });
      assert.equal(workers.length, 2, 'no replacement worker');
      assert.equal(workers.flatMap(record => record.requests).length, 4, 'no queued validation/payload posted after abort');
    } else {
      const subject = 'a'.repeat(28) + '!';
      const timerRan = deferred();
      let accepted = 0;
      hooks.accepted = (message, record) => {
        if (!message.rows.length) return;
        accepted++;
        assert.equal(accepted, 1, 'one nonempty pathological request');
        assert.deepEqual(message.descriptor.patterns, ['^(a+)+$']);
        assert.equal(message.descriptor.kind, family);
        assert.equal(message.rows.length, 1);
        assert.equal(Buffer.from(message.rows[0].bytes).toString(), subject);
        assert.notEqual(record.readyAtMs, null);
        const scheduledAtMs = performance.now();
        details.acceptance = { id: message.id, atMs: scheduledAtMs, workerReadyAtMs: record.readyAtMs, bytes: Buffer.from(message.rows[0].bytes).toString('base64') };
        details.timer = { scheduledAtMs, dueAtMs: scheduledAtMs + 5 };
        timers.push(setTimeout(() => {
          details.timer.actualAtMs = performance.now();
          details.timer.latenessMs = details.timer.actualAtMs - details.timer.dueAtMs;
          details.timer.workerAliveNoResponse = !record.exited && !record.responses.some(response => response.id === message.id);
          timerRan.release();
        }, 5));
        if (callerAbort) {
          details.abortDueAtMs = scheduledAtMs + 10;
          timers.push(setTimeout(() => {
            details.abortAtMs = performance.now();
            details.abortWorkerAliveNoResponse = !record.exited && !record.responses.some(response => response.id === message.id);
            controller.abort(reason);
          }, 10));
        }
      };
      target = scope.run('target', () => settle(shell.exec(`${command} '^(a+)+$'`, { stdin: subject + '\n', ...(callerAbort ? { signal: controller.signal } : {}) })));
      const outcome = await target;
      details.settledAtMs = performance.now();
      details.acceptedNonemptyRequests = accepted;
      assert.equal(accepted, 1);
      if (callerAbort) {
        assert.equal(outcome.error, reason);
        details.exactCallerReason = true;
        details.abortLatencyMs = details.settledAtMs - details.abortAtMs;
        assert.ok(details.abortLatencyMs >= 0 && details.abortLatencyMs < 500);
        assert.equal(details.abortWorkerAliveNoResponse, true);
      } else {
        details.outcome = vector(outcome.value);
        assert.deepEqual(details.outcome, { exitCode: 2, stdout: '', stderr: Buffer.from(`${family}: regex REQUEST_TIMEOUT: active request exceeded 1000ms\n`).toString('base64') });
        details.timeoutOrigin = 'regex REQUEST_TIMEOUT exact diagnostic, not Shell outer timeout';
      }
      await timerRan.promise;
      assert.ok(details.timer.latenessMs < 500);
      assert.equal(details.timer.workerAliveNoResponse, true);
      assert.equal(workers.length, 1);
    }
    details.beforeDispose = metrics();
    retired(details.beforeDispose);
    for (const record of details.beforeDispose) {
      assert.equal(record.url, pathToFileURL(resolve(packageRoot, 'dist/commands/regex-execution/worker.js')).href);
      assert.deepEqual(record.options, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
    }
    for (const boundary of boundaries) {
      assert.ok(boundary.signals.every(record => record.listeners === 0), `${boundary.owner} abort listeners`);
      if (boundary.callerListeners !== null) assert.equal(boundary.callerListeners, 0);
      if (!queued) retired(boundary.workers);
    }
  } catch (error) { failure = error.stack; }
  finally {
    for (const timer of timers) clearTimeout(timer);
    hooks.accepted = undefined;
    hooks.admission = undefined;
    hooks.held = undefined;
    hooks.holdResponses = false;
    for (const record of workers) record.worker.releaseResponses();
    try { await shell.dispose(); await Promise.all([...siblings, ...(target ? [target] : [])]); }
    catch (error) { failure = [failure, error.stack].filter(Boolean).join('\n'); }
  }
  await sleep(50);
  try { retired(metrics()); assert.deepEqual(lateErrors, []); }
  catch (error) { failure = [failure, error.stack].filter(Boolean).join('\n'); }
  await send({ kind: 'result', job, pass: !failure, failure, entry, elapsedMs: performance.now() - started, details, boundaries, admissions, finalWorkers: metrics(), lateErrors, targetSlotsConsumed: 1, pathologicalRequests: queued ? 0 : 1 });
  process.disconnect();
}
