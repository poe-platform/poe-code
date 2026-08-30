import assert from 'node:assert/strict';
import { ClientRequest } from 'node:http';
import { writeFileSync } from 'node:fs';
import { setImmediate as turn } from 'node:timers/promises';
import { agentCommands, createOutputOperation, MemoryFileSystem, networkCommands, pipeBytes, Shell } from 'virtual-bash';
import { createNodeHttpTransport } from 'virtual-bash/commands/network';
import { gate, httpFixture, s3Fixture, Trace } from './helpers.mjs';

const scenario = process.argv[2], started = gate(), closed = gate(), hostRelease = gate(), requiredRelease = gate();
const events = [], signals = new Map(), removals = [], snapshots = [], unhandled = [], cleanupErrors = [];
const counters = { activeSource: 0, sourceReads: 0, sourceReturns: 0, cleanupRegistrations: 0, acquiredResources: 0, resourceReleases: 0, cleanupCalls: 0, cleanupCompleted: 0, fetchCalls: 0, fetchPending: 0, bodyReaders: 0, readsPending: 0, readerReleases: 0, readerCancelCalls: 0, readerCancelCompleted: 0, bodyCancelCalls: 0, bodyCancelCompleted: 0, clientRequests: 0, clientCloses: 0, responseAcquired: 0, responseReadsPending: 0, responseReadCalls: 0, responseIteratorReturns: 0, responseIteratorReturnsDone: 0, responseDisposals: 0, responseDisposalsDone: 0 };
let phase = 'setup', settled, shell, callerForced = false, serverForcing = false, observationDeadline = false, hostReleased = false, fixture;
const describe = reason => reason instanceof Error ? { name: reason.name, code: reason.code, message: reason.message } : { type: typeof reason, value: reason };
function mark(event, detail = {}) { assert(events.length < 700); events.push({ sequence: events.length, phase, at: performance.now(), event, ...detail }); }
function watch(name, signal) {
  if (!signal || signals.has(name)) return;
  signals.set(name, signal); const listener = () => mark('signal-abort', { name, reason: describe(signal.reason) });
  signal.addEventListener('abort', listener, { once: true }); removals.push(() => signal.removeEventListener('abort', listener));
  mark('signal-observed', { name, aborted: signal.aborted });
}
const trace = new Trace(); watch('caller', trace.controller.signal);
const originalEvent = trace.event.bind(trace), originalOperation = trace.operation.bind(trace);
trace.event = value => { originalEvent(value); mark('fixture', { value }); };
trace.operation = (name, signal) => { watch('operation:' + name, signal); originalOperation(name, signal); };
function snapshot(label) {
  const result = { label, phase, counters: { ...counters }, signals: Object.fromEntries([...signals].map(([name, signal]) => [name, { aborted: signal.aborted, ...(signal.aborted ? { reason: describe(signal.reason) } : {}) }])), settled, callerForced, serverForcing, observationDeadline, hostReleased, eventCount: events.length };
  snapshots.push(result); return result;
}
async function observeWithin(pending, milliseconds) {
  let timer; try { return await Promise.race([pending.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function pendingSource(signal, controlled = false) {
  watch('source', signal);
  return (async function* () {
    counters.sourceReads++; counters.activeSource++; mark('source-next'); started.resolve();
    let listener;
    try {
      const aborted = new Promise((_, reject) => { signal.throwIfAborted(); listener = () => reject(signal.reason); signal.addEventListener('abort', listener, { once: true }); });
      await (controlled ? Promise.race([aborted, hostRelease.promise]) : aborted);
    } finally {
      if (listener) signal.removeEventListener('abort', listener);
      counters.activeSource--; counters.sourceReturns++; mark('source-finally'); closed.resolve();
    }
  })();
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  counters.fetchCalls++; counters.fetchPending++; const request = { fetchId: counters.fetchCalls, method: args[1]?.method ?? 'GET', url: String(args[0]) }; mark('fetch-start', request);
  const pending = Reflect.apply(originalFetch, globalThis, args);
  return pending.then(response => {
    counters.fetchPending--; mark('fetch-response', request);
    if (response.body) {
      const body = response.body, getReader = body.getReader.bind(body), cancel = body.cancel.bind(body);
      body.cancel = (...args) => {
        counters.bodyCancelCalls++; const result = cancel(...args);
        void result.then(() => { counters.bodyCancelCompleted++; mark('body-cancel-finish', request); }, error => mark('body-cancel-error', { ...request, error: describe(error) })); return result;
      };
      body.getReader = (...args) => {
        const reader = getReader(...args), read = reader.read.bind(reader), readerCancel = reader.cancel.bind(reader), releaseLock = reader.releaseLock.bind(reader);
        counters.bodyReaders++; mark('reader-acquire', request);
        reader.read = (...args) => {
          counters.readsPending++; mark('reader-read', request); const result = read(...args);
          if (scenario === 'new-webdav-body-acquired' && request.method === 'GET') { mark('body-read-admitted-before-downstream-close', request); started.resolve(); }
          void result.then(value => { counters.readsPending--; mark('reader-read-finish', { ...request, done: value.done }); }, error => { counters.readsPending--; mark('reader-read-error', { ...request, error: describe(error) }); }); return result;
        };
        reader.cancel = (...args) => {
          counters.readerCancelCalls++; mark('reader-cancel-start', request); const result = readerCancel(...args);
          void result.then(() => { counters.readerCancelCompleted++; mark('reader-cancel-finish', request); }, error => mark('reader-cancel-error', { ...request, error: describe(error) })); return result;
        };
        reader.releaseLock = () => { const result = releaseLock(); counters.readerReleases++; mark('reader-release-lock', request); return result; };
        return reader;
      };
    }
    return response;
  }, error => { counters.fetchPending--; mark('fetch-error', { ...request, error: describe(error) }); throw error; });
};
const clientRequests = new WeakSet(), originalEmit = ClientRequest.prototype.emit;
ClientRequest.prototype.emit = function (event, ...args) {
  if (!clientRequests.has(this)) { clientRequests.add(this); counters.clientRequests++; mark('client-request-observed'); }
  if (event === 'close') { counters.clientCloses++; mark('client-close'); }
  return Reflect.apply(originalEmit, this, [event, ...args]);
};
const onUnhandled = reason => { unhandled.push(describe(reason)); mark('unhandled', { reason: describe(reason) }); };
process.on('unhandledRejection', onUnhandled);
const keepAlive = setInterval(() => {}, 1000);
const report = { scenario, kind: scenario.startsWith('new-') ? 'NEW_BINDING_NOT_ORIGINAL' : 'ORIGINAL_RECIPE_OBSERVATION_NOT_RESCORE', events, snapshots, cleanupErrors, observerFailures: [] };
try {
  let fs = new MemoryFileSystem(), url;
  if (scenario === 'first-read-s3') {
    ({ fs } = await s3Fixture(trace, { async getObjectStream(_input, options) { assert(options?.abortSignal); return { Body: pendingSource(options.abortSignal), ContentLength: 13 }; } }));
  } else if (scenario === 'first-read-webdav' || scenario.startsWith('first-read-curl-') || ['new-required-destinations', 'new-webdav-body-acquired', 'new-curl-body-acquired'].includes(scenario)) {
    fixture = await httpFixture(trace, (request, response) => {
      if (request.method !== 'GET') return false;
      counters.activeSource++; counters.sourceReads++;
      response.once('close', () => { counters.activeSource--; counters.sourceReturns++; mark('server-response-close'); closed.resolve(); });
      if (scenario !== 'first-read-curl-headers') { response.writeHead(200, { 'Content-Length': '13' }); response.flushHeaders(); }
      mark('server-get-pending'); if (!scenario.endsWith('-body-acquired')) setImmediate(() => started.resolve());
      if (scenario === 'new-required-destinations') void requiredRelease.promise.then(() => { mark('server-provides-required-body'); response.end('first\nsecond\n'); });
      return true;
    });
    fs = scenario === 'new-required-destinations' ? fs : fixture.fs;
    const address = fixture.server.address(); url = `http://127.0.0.1:${address.port}/dav/input`;
  }
  shell = new Shell({ fs }).use(agentCommands());
  if (scenario.startsWith('first-read-curl-') || ['new-required-destinations', 'new-curl-body-acquired'].includes(scenario)) {
    const transport = createNodeHttpTransport();
    shell.use(networkCommands({ authorize: request => request.url === url && request.method === 'GET', transport(input) {
      watch('curl-transport', input.signal);
      const pending = transport({ ...input, ...(input.registerCleanup ? { registerCleanup(callback) {
        counters.cleanupRegistrations++; mark('transport-cleanup-registered');
        input.registerCleanup(() => {
          counters.cleanupCalls++; mark('transport-cleanup-start'); const result = callback();
          void Promise.resolve(result).then(() => { counters.cleanupCompleted++; mark('transport-cleanup-finish'); }, error => mark('transport-cleanup-error', { error: describe(error) })); return result;
        });
      } } : {}) });
      return pending.then(response => {
        counters.responseAcquired++; mark('curl-response-acquired');
        const dispose = response.dispose.bind(response);
        const body = { [Symbol.asyncIterator]() {
          const iterator = response.body[Symbol.asyncIterator]();
          return {
            next(...args) {
              counters.responseReadCalls++; counters.responseReadsPending++; mark('curl-body-read'); const result = iterator.next(...args);
              if (scenario === 'new-curl-body-acquired') { mark('body-read-admitted-before-downstream-close'); started.resolve(); }
              void result.then(value => { counters.responseReadsPending--; mark('curl-body-read-finish', { done: value.done }); }, error => { counters.responseReadsPending--; mark('curl-body-read-error', { error: describe(error) }); }); return result;
            },
            return(...args) {
              counters.responseIteratorReturns++; mark('curl-body-return'); const result = iterator.return ? iterator.return(...args) : Promise.resolve({ done: true, value: undefined });
              void result.then(() => { counters.responseIteratorReturnsDone++; mark('curl-body-return-finish'); }, error => mark('curl-body-return-error', { error: describe(error) })); return result;
            },
          };
        } };
        return { ...response, body, dispose() { counters.responseDisposals++; mark('response-dispose-start'); const result = dispose(); void Promise.resolve(result).then(() => { counters.responseDisposalsDone++; mark('response-dispose-finish'); }, error => mark('response-dispose-error', { error: describe(error) })); return result; } };
      });
    } }));
  }
  shell.commands.register({ name: 'pending-stream', async execute(context) {
    mark('local-hooks', { cleanupAvailable: typeof context.registerCleanup === 'function', ownedOutputAvailable: !!context.stdout.ownedOutput });
    const registered = { ...context, registerCleanup(callback) { counters.cleanupRegistrations++; mark('local-cleanup-registered'); context.registerCleanup(callback); } };
    if (scenario === 'new-local-enrolled') {
      const operation = createOutputOperation(registered, context.stdout); watch('local-operation', operation.signal); mark('scope-created');
      try {
        const source = await operation.acquire(signal => { counters.acquiredResources++; mark('source-acquire'); return pendingSource(signal); }, async source => { mark('resource-release-start'); await source.return(); counters.resourceReleases++; mark('resource-release-finish'); });
        await pipeBytes(source, operation.output, operation.signal); return { exitCode: 0 };
      } catch (error) {
        context.signal.throwIfAborted(); if (operation.signal.aborted && operation.signal.reason?.code === 'EPIPE') return { exitCode: 141 }; throw error;
      } finally { await operation.close(); }
    }
    const source = pendingSource(context.signal, scenario === 'new-legacy-controlled');
    if (scenario === 'new-local-cleanup-only') registered.registerCleanup(async () => { counters.cleanupCalls++; await source.return(); counters.cleanupCompleted++; });
    await pipeBytes(source, context.stdout, context.signal); return { exitCode: 0 };
  } });
  shell.use(async (context, next) => {
    watch('command:' + context.command, context.signal);
    if (context.stdout.ownedOutput && context.command !== 'head' && context.command !== 'true') {
      watch('destination:' + context.command, context.stdout.ownedOutput.consumerClosed);
      if (scenario === 'new-required-destinations') context.stdout.ownedOutput.consumerClosed.addEventListener('abort', () => { mark('downstream-close-allows-required-response'); requiredRelease.resolve(); }, { once: true });
    }
    if (context.command === 'head' && scenario !== 'first-read-head-zero') await started.promise;
    const result = await next(); mark('command-settled', { command: context.command, exitCode: result.exitCode }); return result;
  });
  const stdin = scenario === 'first-read-head-zero' ? { [Symbol.asyncIterator]() { return {
    async next() { counters.sourceReads++; throw new Error('head zero must not read'); },
    async return() { counters.sourceReturns++; return { done: true, value: undefined }; },
  }; } } : undefined;
  const producer = scenario === 'first-read-local' || scenario.startsWith('new-local-') || scenario === 'new-legacy-controlled' ? 'pending-stream' : scenario === 'new-required-destinations' ? `curl -v -o /body -D /headers ${url}` : scenario.startsWith('first-read-curl-') || scenario === 'new-curl-body-acquired' ? `curl ${url}` : 'cat /input';
  report.command = scenario === 'first-read-head-zero' ? 'head -n 0' : `${producer} | head -n 0; true`;
  phase = 'execution'; mark('exec-start');
  const pending = shell.exec(report.command, { signal: trace.controller.signal, ...(stdin ? { stdin } : {}) }).then(result => {
    settled = { kind: 'result', exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex') }; mark('public-settled'); snapshot('at-public-settlement');
  }, error => { settled = { kind: 'rejection', error: describe(error), callerReasonIdentity: error === trace.controller.signal.reason }; mark('public-rejected'); snapshot('at-public-settlement'); });
  if (scenario === 'new-legacy-controlled') {
    await started.promise; assert.equal(await observeWithin(pending, 50), false); snapshot('before-controlled-host-release');
    hostReleased = true; mark('controlled-host-release'); hostRelease.resolve();
  }
  const completed = await observeWithin(pending, 1200);
  if (!completed) { observationDeadline = true; mark('observation-deadline-no-release-action'); snapshot('at-observation-deadline'); }
  else {
    if (fixture) { report.remoteClosedBeforeCleanup = await observeWithin(closed.promise, 1200); mark('passive-remote-close-observation', { completed: report.remoteClosedBeforeCleanup }); }
    await turn(); snapshot('before-public-dispose'); await shell.dispose(); mark('public-dispose-settled'); snapshot('after-public-dispose');
    if (scenario === 'new-required-destinations') {
      report.effects = { bodyHex: Buffer.from(await fs.readFile('/body')).toString('hex'), headers: Buffer.from(await fs.readFile('/headers')).toString() };
      assert.equal(report.effects.bodyHex, Buffer.from('first\nsecond\n').toString('hex'));
      assert.match(report.effects.headers, /^HTTP\/1\.1 200 /u); assert.match(report.effects.headers, /content-length: 13/iu); assert.match(Buffer.from(settled.stderrHex, 'hex').toString(), /< HTTP 200/u);
    }
  }
  snapshot('before-harness-cleanup');
  report.observation = { completedWithin1200ms: completed, callerAbortedBeforeCleanup: trace.controller.signal.aborted, public: settled };
  if (scenario === 'new-local-enrolled') { assert(completed); assert.equal(counters.resourceReleases, 1); assert.equal(counters.activeSource, 0); assert.equal(signals.get('local-operation').aborted, true); assert.equal(signals.get('command:pending-stream').aborted, false); }
  if (scenario === 'new-legacy-controlled') { assert(completed); assert.equal(counters.sourceReturns, 1); assert.equal(signals.get('source').aborted, false); }
  if (scenario === 'new-local-cleanup-only') assert.equal(completed, false);
  phase = 'harness-cleanup'; mark('harness-cleanup-start');
  if (!completed) { callerForced = true; mark('caller-abort-for-teardown'); trace.controller.abort(new Error('observer teardown, not acceptance')); assert(await observeWithin(pending, 1500)); }
} catch (error) { report.observerFailures.push(describe(error)); }
finally {
  phase = 'harness-cleanup';
  if (!settled && !trace.controller.signal.aborted) { callerForced = true; mark('caller-abort-for-failed-observer'); trace.controller.abort(new Error('failed-observer cleanup')); }
  try { await shell?.dispose(); } catch (error) { cleanupErrors.push(describe(error)); }
  serverForcing = !!fixture;
  mark('fixture-cleanup-start', { mayCloseServerConnections: serverForcing });
  for (const cleanup of trace.cleanups.reverse()) { try { await cleanup(); } catch (error) { cleanupErrors.push(describe(error)); } }
  for (const remove of removals) remove();
  await turn(); globalThis.fetch = originalFetch; ClientRequest.prototype.emit = originalEmit;
  process.removeListener('unhandledRejection', onUnhandled); clearInterval(keepAlive);
  snapshot('after-harness-cleanup'); report.unhandled = unhandled; report.fixtureEvents = trace.events;
  report.containment = { callerForced, serverForcing, observationDeadline }; report.naturalCompletion = true;
  writeFileSync(process.env.OBSERVER_RESULT, JSON.stringify(report, null, 2));
  if (report.observerFailures.length || cleanupErrors.length || unhandled.length) process.exitCode = 1;
}
