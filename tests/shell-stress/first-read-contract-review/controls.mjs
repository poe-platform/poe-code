import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { Shell, MemoryFileSystem, createBytePipe } from './.scratch/candidate/dist/index.js';

const scenario = process.argv[2];
const events = [];
const event = value => events.push({ order: events.length + 1, value });
const encode = value => new TextEncoder().encode(value);
const gate = () => {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
};
const wait = (promise, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});
const controller = new AbortController();
const fs = new MemoryFileSystem();
const shell = new Shell({ fs, limits: { pipeHighWaterMark: 1 } });
const started = gate();
const closed = gate();
const demand = gate();
const pendingStarted = gate();
let observed;
let cleanup = 0;
let reads = 0;
let result;
let execution;
const timer = setTimeout(() => controller.abort(new Error(`${scenario}: control 1200ms deadline`)), 1200);

shell.use(async (context, next) => {
  event(`middleware.enter:${context.command}`);
  if (context.command === 'consume' && ['C1', 'C2', 'C3', 'C7', 'C9'].includes(scenario)) {
    event('middleware.waitForStarted');
    await wait(started.promise, context.signal);
    event('middleware.started:next');
  }
  try { return await next(); }
  finally { event(`middleware.finally:${context.command}`); }
});
shell.commands.register({ name: 'produce', async execute({ stdout, stderr, signal }) {
  observed = signal;
  event('producer.invoked');
  try {
    if (scenario === 'C9') {
      event('producer.waitForDemand:harness-only');
      await wait(demand.promise, signal);
    }
    if (scenario === 'C1') {
      event('stdout.attempt:first');
      await stdout.write(encode('first\n'));
      event('stdout.accepted:first');
      started.resolve();
      pendingStarted.resolve();
      event('source.pending:after-first-write');
      await wait(new Promise(() => {}), signal);
    }
    if (scenario === 'C2') {
      const source = (async function* () {
        event('source.next:started-before-output');
        await fs.writeFile('/effect', encode('prepared'), { signal });
        event('effect:prepared');
        started.resolve();
        yield encode('payload\n');
      })();
      for await (const chunk of source) {
        event('stdout.attempt:payload');
        await stdout.write(chunk);
        event('stdout.accepted:payload');
      }
      return { exitCode: 0 };
    }
    if (scenario === 'C3') {
      await fs.writeFile('/effect', encode('prepared'), { signal });
      event('effect:prepared');
      started.resolve();
    }
    if (scenario === 'C7') {
      await stderr.write(encode('diagnostic\n'));
      event('stderr.accepted');
      started.resolve();
    }
    if (['C3', 'C4', 'C5', 'C6', 'C7'].includes(scenario)) {
      await wait(closed.promise, signal);
      await turn();
      await turn();
      event('producer.after-downstream-close');
      assert.equal(signal.aborted, false);
    }
    if (scenario === 'C4') {
      await fs.writeFile('/effect', encode('kept'), { signal });
      event('effect:kept');
    }
    if (scenario === 'C6') {
      await stderr.write(encode('delayed-error\n'));
      event('stderr.accepted');
      return { exitCode: 7 };
    }
    if (scenario === 'C3' || scenario === 'C7') {
      event('stdout.attempt:after-close');
      await stdout.write(encode('payload\n'));
      event('stdout.unexpectedly-accepted');
    }
    started.resolve();
    return { exitCode: 0 };
  } finally {
    cleanup++;
    event(`producer.finally:${signal.aborted ? signal.reason?.code ?? 'caller' : 'live'}`);
  }
} });
shell.commands.register({ name: 'consume', async execute({ stdin, stdout }) {
  event('consumer.invoked');
  if (scenario === 'C1' || scenario === 'C2' || scenario === 'C9') {
    event('consumer.attaches-reader');
    demand.resolve();
    for await (const chunk of stdin) {
      reads++;
      event('consumer.read:delivered');
      await stdout.write(chunk);
      if (scenario === 'C1') { await pendingStarted.promise; break; }
    }
  }
  event('consumer.return:no-more-reads');
  closed.resolve();
  return { exitCode: 0 };
} });

try {
  if (scenario === 'C8') {
    const pipe = createBytePipe({ highWaterMark: 1, signal: controller.signal });
    await pipe.writable.write(new Uint8Array([65]));
    event('write1.accepted:no-reader-next');
    let secondSettled = false;
    const second = pipe.writable.write(new Uint8Array([66])).finally(() => { secondSettled = true; });
    const close = pipe.close();
    const reason = new Error('owned unread pipe cancellation');
    const rejected = Promise.all([assert.rejects(second, error => error === reason), assert.rejects(close, error => error === reason)]);
    await turn();
    assert.equal(secondSettled, false);
    event('write2.blocked:no-reader-next');
    controller.abort(reason);
    await rejected;
    await assert.rejects(pipe.readable[Symbol.asyncIterator]().next(), error => error === reason);
    event('pending-write-close-read.reject:same-reason');
    result = { firstWriteAccepted: true, secondWriteBlocked: true, readsBeforeAbort: 0 };
  } else {
    execution = shell.exec('set -o pipefail; produce | consume', { signal: controller.signal,
      stdout: { async write() { event('response.stdout.write'); } },
      stderr: { async write() { event('response.stderr.write'); } },
    });
    void execution.catch(() => {});
    if (scenario === 'C9') {
      await turn();
      await turn();
      assert.ok(events.some(entry => entry.value === 'producer.waitForDemand:harness-only'));
      assert.ok(events.some(entry => entry.value === 'middleware.waitForStarted'));
      assert.equal(events.some(entry => entry.value === 'consumer.invoked'), false);
      assert.equal(events.some(entry => entry.value === 'middleware.started:next'), false);
      event('cycle.observed:started<-demand<-next<-started');
      const reason = new Error('bounded synthetic-cycle cancellation');
      controller.abort(reason);
      await assert.rejects(execution, error => error === reason);
      result = { cycleObserved: true, callerReasonPreserved: true };
    } else {
      const actual = await execution;
      event('public.exec.settled');
      result = { stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode };
      assert.equal(actual.stdout, scenario === 'C1' ? 'first\n' : scenario === 'C2' ? 'payload\n' : '');
      assert.equal(actual.stderr, scenario === 'C6' ? 'delayed-error\n' : scenario === 'C7' ? 'diagnostic\n' : '');
      assert.equal(actual.exitCode, ['C1', 'C3', 'C7'].includes(scenario) ? 141 : scenario === 'C6' ? 7 : 0);
      assert.equal(controller.signal.aborted, false);
      assert.equal(cleanup, 1);
      if (['C1', 'C3', 'C7'].includes(scenario)) assert.equal(observed.reason.code, 'EPIPE');
      if (['C2', 'C3', 'C4'].includes(scenario)) {
        const effect = new TextDecoder().decode(await fs.readFile('/effect'));
        assert.equal(effect, scenario === 'C4' ? 'kept' : 'prepared');
        result.effect = effect;
      }
      if (scenario === 'C1') assert.equal(reads, 1);
      if (scenario === 'C2') {
        const position = value => events.findIndex(entry => entry.value === value);
        assert.ok(position('source.next:started-before-output') < position('middleware.started:next'));
        assert.ok(position('effect:prepared') < position('consumer.attaches-reader'));
        assert.ok(position('consumer.attaches-reader') < position('response.stdout.write'));
      }
    }
  }
  console.log(JSON.stringify({ scenario, verdict: 'PASS', result, cleanup, reads, events }));
} catch (error) {
  console.error(JSON.stringify({ scenario, verdict: 'FAIL', error: error.stack, result, cleanup, reads, events }));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  controller.abort(new Error('owned control teardown'));
  await execution?.catch(() => {});
  await shell.dispose();
  await turn();
  console.log(JSON.stringify({ scenario, teardown: 'disposed', cleanup }));
}
