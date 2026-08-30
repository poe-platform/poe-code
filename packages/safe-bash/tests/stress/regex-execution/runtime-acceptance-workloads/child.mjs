import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acceptWith, workers, metrics, retired, vector, lateErrors } from './observe.mjs';

const [job, packageRoot] = process.argv.slice(2);
const send = message => new Promise((resolveSend, reject) => process.send(message, error => error ? reject(error) : resolveSend()));
const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
const riskJobs = ['grep-default', 'rg-default', 'grep-abort', 'rg-abort'];
const controlJobs = ['already-aborted', 'owned-timeout', 'success', 'late-rejection'];
assert.ok([...riskJobs, ...controlJobs].includes(job));
process.on('uncaughtExceptionMonitor', error => { process.stderr.write(`uncaught: ${String(error)}\n`); });
await send({ kind: 'ready', job });
await new Promise(resolveRun => process.once('message', message => { assert.deepEqual(message, { kind: 'run' }); resolveRun(); }));

if (controlJobs.includes(job)) {
  if (job === 'late-rejection') {
    setTimeout(() => { void Promise.reject(new Error('standalone preserved late rejection')); }, 5);
    await new Promise(() => {});
  }
  if (job === 'owned-timeout') {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (job === 'already-aborted') {
    const controller = new AbortController();
    const reason = new Error('standalone already-aborted identity');
    controller.abort(reason);
    await assert.rejects(Promise.resolve().then(() => controller.signal.throwIfAborted()), error => error === reason);
  }
  assert.equal(workers.length, 0);
  await send({ kind: 'result', pass: true, job, workers: metrics(), riskConsumed: 0, boundary: 'standalone supervisor control; no product imported' });
  process.disconnect();
} else {
  const entry = import.meta.resolve('virtual-bash');
  assert.equal(entry, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href, 'moved package import export, not repository source');
  const api = await import(entry);
  const command = job.startsWith('grep') ? 'grep -E' : 'rg';
  const subject = 'a'.repeat(28) + '!';
  const controller = new AbortController();
  const reason = new Error(`accepted caller abort: ${job}`);
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
  let acceptance;
  let acceptanceCount = 0;
  let responseTimer;
  let abortTimer;
  let timerDelayMs;
  let observeTimer;
  let publicSettlement;
  let outcome;
  let failure;
  let elapsedMs;
  const responsiveness = new Promise(resolveTimer => { observeTimer = resolveTimer; });
  acceptWith(message => {
    if (!message?.rows?.some(row => Buffer.from(row.bytes).toString() === subject)) return;
    assert.deepEqual(message.descriptor.patterns, ['^(a+)+$']);
    assert.equal(message.descriptor.kind, command === 'rg' ? 'rg' : 'grep');
    assert.equal(message.rows.length, 1);
    acceptanceCount++;
    assert.equal(acceptanceCount, 1, 'one historical matching request only');
    acceptance = { id: message.id, descriptor: message.descriptor, subjectBytes: Buffer.byteLength(subject), atMs: performance.now() };
    responseTimer = setTimeout(() => { timerDelayMs = performance.now() - acceptance.atMs; observeTimer(); }, 5);
    if (job.endsWith('-abort')) abortTimer = setTimeout(() => controller.abort(reason), 10);
  });
  const started = performance.now();
  try {
    outcome = await shell.exec(`${command} '^(a+)+$'`, { stdin: subject + '\n', ...(job.endsWith('-abort') ? { signal: controller.signal } : {}) }).then(value => ({ value }), error => ({ error }));
    elapsedMs = performance.now() - started;
    publicSettlement = metrics();
    assert.equal(acceptanceCount, 1);
    retired(publicSettlement);
    assert.ok(publicSettlement.length > 0 && publicSettlement.length <= 2);
    if (job.endsWith('-abort')) assert.equal(outcome.error, reason);
    else {
      assert.equal(outcome.value?.exitCode, 2);
      assert.equal(outcome.value.stdout, '');
      assert.equal(outcome.value.stderr, `${command === 'rg' ? 'rg' : 'grep'}: regex REQUEST_TIMEOUT: active request exceeded 1000ms\n`);
    }
    await responsiveness;
    assert.ok(timerDelayMs < 500, 'diagnostic responsiveness threshold, not a product SLA');
  } catch (error) { failure = error.stack; }
  finally {
    clearTimeout(responseTimer);
    clearTimeout(abortTimer);
    acceptWith(undefined);
    try { await shell.dispose(); } catch (error) { failure = [failure, `dispose: ${error.stack}`].filter(Boolean).join('\n'); }
  }
  const afterDispose = metrics();
  await sleep(50);
  const afterLateWindow = metrics();
  try { retired(afterDispose); retired(afterLateWindow); assert.deepEqual(lateErrors, []); }
  catch (error) { failure = [failure, error.stack].filter(Boolean).join('\n'); }
  await send({ kind: 'result', pass: !failure, job, entry, acceptance, acceptanceCount, timerDelayMs, elapsedMs, outcome: outcome?.value ? vector(outcome.value) : { error: String(outcome?.error), code: outcome?.error?.code, exactAbortReason: outcome?.error === reason }, publicSettlement, afterDispose, afterLateWindow, lateErrors, failure, policy: { activeMs: 1000, startupMs: 3000, leases: 2, overrides: false }, riskConsumed: 1 });
  process.disconnect();
}
