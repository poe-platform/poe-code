import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { Shell, MemoryFileSystem, agentCommands, createOutputOperation, toByteSource, readBytes } from 'virtual-bash';

export const deferred = () => { let resolve, reject; const promise = new Promise((done, failed) => { resolve = done; reject = failed; }); return { promise, resolve, reject }; };
export const outcome = promise => Promise.resolve(promise).then(value => ({ fulfilled: true, value }), reason => ({ fulfilled: false, reason }));
export const capture = () => { const parts = []; return { parts, sink: { async write(bytes) { parts.push(new Uint8Array(bytes)); } }, hex: () => Buffer.concat(parts).toString('hex') }; };
export const makeShell = () => new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
export function fixture(events) {
  const controller = new AbortController(), hooks = [], target = capture();
  const context = { signal: controller.signal, registerCleanup(callback) { events.push('scope-register'); hooks.push(callback); } };
  return { controller, hooks, target, context, operation: () => createOutputOperation(context, target.sink) };
}
export const cases = {};
cases.A01 = async (events, values) => {
  const host = fixture(events), operation = host.operation(); let starts = 0, releases = 0;
  await operation.acquire(() => { starts++; events.push('start'); return {}; }, () => { releases++; events.push('release-finish'); });
  await operation.close(); events.push('close-settle'); Object.assign(values, { starts, releases });
};
cases.A02 = async (events, values) => {
  const host = fixture(events), operation = host.operation(), reason = {}; let starts = 0, releases = 0, owned = 0;
  const result = await outcome(operation.acquire(() => { starts++; throw reason; }, () => { releases++; owned--; })); await operation.close();
  Object.assign(values, { startReasonIdentity: !result.fulfilled && result.reason === reason, starts, releases, ownedResourcesAfter: owned });
};
cases.A03 = async (events, values) => {
  const host = fixture(events), operation = host.operation(), resource = deferred(), release = deferred(), releasing = deferred(); let owned = 0, releases = 0, lateStarts = 0, settled = false;
  const acquisition = outcome(operation.acquire(() => { events.push('start'); return resource.promise; }, async () => { releases++; events.push('release-start'); releasing.resolve(); await release.promise; owned--; events.push('release-finish'); }));
  events.push('close-enter'); const closing = operation.close().then(() => { settled = true; events.push('close-settle'); });
  await turn(); values.pendingBeforeResource = !settled;
  assert.equal(values.pendingBeforeResource, true, 'A03 close must await admitted acquisition');
  await outcome(operation.acquire(() => { lateStarts++; }, () => {}));
  events.push('resource-resolve'); owned++; resource.resolve({}); await releasing.promise;
  values.pendingDuringRelease = !settled; release.resolve(); await closing; await acquisition;
  Object.assign(values, { lateStarts, releases, ownedResourcesAfter: owned });
};
cases.A04 = async (events, values) => {
  const host = fixture(events), operation = host.operation(), start = deferred(), reason = new Error('acquisition'); let releases = 0;
  const acquisition = outcome(operation.acquire(() => start.promise, () => { releases++; }));
  events.push('close-enter'); const closing = operation.close().then(() => events.push('close-settle'));
  await turn(); events.push('acquire-reject'); start.reject(reason); const result = await acquisition; await closing;
  Object.assign(values, { acquireReasonIdentity: !result.fulfilled && result.reason === reason, releases, ownedResourcesAfter: 0 });
};
cases.A05 = async (events, values) => {
  const host = fixture(events), operation = host.operation(), release = deferred(), entered = deferred(); let releaseCalls = 0, settled = 0, owned = 0;
  await operation.acquire(() => { owned++; return {}; }, async () => { releaseCalls++; entered.resolve(); await release.promise; owned--; });
  const closing = [operation.close(), host.hooks[0](), operation.close()].map(promise => promise.then(() => { settled++; }));
  await entered.promise; await turn(); values.pendingCloseCallers = closing.length - settled; values.settledBeforeRelease = settled;
  release.resolve(); await Promise.all(closing); Object.assign(values, { releaseCalls, settledAfterRelease: settled, ownedResourcesAfter: owned });
};
cases.A06 = async (events, values) => {
  const host = fixture(events), operation = host.operation(); let lateStarts = 0, lateChildrenCreated = 0, lateCallbacksRun = 0, lateWrites = 0, refusals = 0;
  const refuse = async callback => { const result = await outcome(Promise.resolve().then(callback)); if (!result.fulfilled) refusals++; };
  operation.registerCleanup(async () => {
    await refuse(() => operation.acquire(() => { lateStarts++; }, () => {}));
    await refuse(() => { operation.child(host.target.sink); lateChildrenCreated++; });
    await refuse(() => operation.registerCleanup(() => { lateCallbacksRun++; }));
  });
  await operation.close(); await refuse(async () => { await operation.output.write(Buffer.from('late')); lateWrites++; });
  Object.assign(values, { lateStarts, lateChildrenCreated, lateCallbacksRun, lateWrites, refusals, ownedResourcesAfter: 0 });
};
cases.A07 = async (events, values) => {
  const host = fixture(events), operation = host.operation(), gate = deferred(), entered = deferred(), reason = new Error('first cleanup'); let firstCalls = 0, secondCalls = 0, thirdCalls = 0, owned = 3;
  operation.registerCleanup(() => { firstCalls++; owned--; throw reason; });
  operation.registerCleanup(async () => { secondCalls++; entered.resolve(); await gate.promise; owned--; events.push('second-release-finish'); });
  operation.registerCleanup(() => { thirdCalls++; owned--; events.push('third-release-finish'); });
  const closing = outcome(operation.close()); await entered.promise; gate.resolve(); const result = await closing; events.push('close-settle');
  Object.assign(values, { firstCalls, secondCalls, thirdCalls, cleanupReasonIdentity: !result.fulfilled && result.reason === reason, ownedResourcesAfter: owned });
};
cases.A08 = async (events, values) => {
  const shell = makeShell(), controller = new AbortController(), reason = {}; let starts = 0, writes = 0;
  shell.register({ name: 'enrolled', async execute(context) { const operation = createOutputOperation(context, context.stdout); await operation.acquire(() => { starts++; }, () => {}); await operation.output.write(Buffer.from('bad')); writes++; return { exitCode: 0 }; } });
  controller.abort(reason); const result = await outcome(shell.exec('enrolled', { signal: controller.signal })); await shell.dispose();
  const direct = createOutputOperation({ signal: controller.signal }, { async write() { writes++; } });
  const admitted = await outcome(direct.acquire(() => { starts++; }, () => {})); await direct.close();
  Object.assign(values, { starts, writes, callerReasonIdentity: !result.fulfilled && result.reason === reason && !admitted.fulfilled && admitted.reason === reason, ownedResourcesAfter: 0 });
};
cases.G01 = async (events, values) => {
  const host = fixture(events), parent = host.operation(), left = parent.child(host.target.sink), right = parent.child(host.target.sink), gate = deferred(), entered = deferred(); let childReleases = 0, owned = 0, settled = false, lateStarts = 0;
  await left.acquire(() => { owned++; }, () => { childReleases++; owned--; events.push('left-release-finish'); });
  await right.acquire(() => { owned++; }, async () => { entered.resolve(); await gate.promise; childReleases++; owned--; events.push('right-release-finish'); });
  const closing = parent.close().then(() => { settled = true; events.push('parent-close-settle'); }); await entered.promise;
  for (const operation of [parent, left, right]) await outcome(operation.acquire(() => { lateStarts++; }, () => {}));
  values.pendingOnRight = !settled; gate.resolve(); await closing;
  Object.assign(values, { lateStarts, childReleases, ownedResourcesAfter: owned });
};
cases.G02 = async (events, values) => {
  const host = fixture(events), parent = host.operation(), left = parent.child(host.target.sink), right = parent.child(host.target.sink); let leftReleases = 0, rightReleases = 0;
  await left.acquire(() => ({}), () => { leftReleases++; }); await right.acquire(() => ({}), () => { rightReleases++; }); await left.close();
  values.rightSignalAbortedAtWrite = right.signal.aborted; values.parentSignalAbortedAtWrite = parent.signal.aborted; await right.output.write(Buffer.from('right\n')); await parent.close();
  Object.assign(values, { stdoutHex: host.target.hex(), leftReleases, rightReleases });
};
cases.G03 = async (events, values) => {
  const first = makeShell(), second = makeShell(), controller = new AbortController(), firstReady = deferred(), secondReady = deferred(), continueSecond = deferred(); let leases = 0, firstLeaseReleases = 0, secondSignal;
  first.register({ name: 'lease', async execute(context) { const operation = createOutputOperation(context, context.stdout); await operation.acquire(() => { leases++; }, () => { leases--; firstLeaseReleases++; }); firstReady.resolve(); await new Promise(() => {}); } });
  second.register({ name: 'lease', async execute(context) { const operation = createOutputOperation(context, context.stdout); await operation.acquire(() => { leases++; }, () => { leases--; }); secondSignal = operation.signal; secondReady.resolve(); await continueSecond.promise; await operation.output.write(Buffer.from('sibling\n')); return { exitCode: 0 }; } });
  const one = outcome(first.exec('lease', { signal: controller.signal })), two = second.exec('lease'); await Promise.all([firstReady.promise, secondReady.promise]); controller.abort({ first: true }); await one;
  values.secondLeaseAbortedByFirst = secondSignal.aborted; continueSecond.resolve(); const result = await two; await first.dispose(); await second.dispose();
  Object.assign(values, { firstLeaseReleases, secondStdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), secondExitCode: result.exitCode, providerLeasesAfter: leases });
};
cases.G04 = async (events, values) => {
  const host = fixture(events), parent = host.operation(), child = parent.child(host.target.sink), independent = createOutputOperation({ signal: host.controller.signal }, parent.output); let childReleased = false, independentReleased = false, owned = 0;
  await child.acquire(() => { owned++; }, () => { owned--; childReleased = true; }); await independent.acquire(() => { owned++; }, () => { owned--; independentReleased = true; });
  values.forwardedOwnedOutputPresent = parent.output.ownedOutput !== undefined; await parent.close(); values.explicitChildDrained = childReleased; values.independentClosedByGraph = independentReleased || independent.signal.aborted;
  await independent.close(); values.ownedResourcesAfterExplicitCleanup = owned;
};
cases.E01 = async (events, values) => {
  const shell = makeShell(), controller = new AbortController(), caller = {}, execution = new Error('execute'), cleanup = new Error('cleanup'), ready = deferred(), gate = deferred();
  shell.register({ name: 'reject', async execute(context) { createOutputOperation(context, context.stdout).registerCleanup(async () => { await gate.promise; events.push('release-finish'); throw cleanup; }); ready.resolve(); controller.abort(caller); throw execution; } });
  const pending = outcome(shell.exec('reject', { signal: controller.signal })); await ready.promise; await turn(); gate.resolve(); const result = await pending; events.push('public-settle'); await outcome(shell.dispose());
  Object.assign(values, { callerReasonIdentity: !result.fulfilled && result.reason === caller, executionChosen: result.reason === execution, cleanupChosen: result.reason === cleanup });
};
cases.E02 = async (events, values) => {
  const exactExecutionReasons = [], cleanupReleases = [];
  for (const reason of [new Error('execution'), false, 0, undefined]) {
    const shell = makeShell(); let releases = 0;
    shell.register({ name: 'reject', async execute(context) { createOutputOperation(context, context.stdout).registerCleanup(() => { releases++; throw new Error('cleanup'); }); await context.stdin[Symbol.asyncIterator]().next(); return { exitCode: 0 }; } });
    const stdin = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Buffer.from('x') }; }, async return() { throw reason; } }; } };
    const result = await outcome(shell.exec('reject', { stdin })); await outcome(shell.dispose()); exactExecutionReasons.push(!result.fulfilled && Object.is(result.reason, reason)); cleanupReleases.push(releases);
  }
  Object.assign(values, { exactExecutionReasons, cleanupReleases });
};
cases.E03 = async (events, values) => {
  const shell = makeShell(), reason = new Error('cleanup'); let owned = 0, fulfilled;
  shell.register({ name: 'seven', async execute(context) { const operation = createOutputOperation(context, context.stdout); await operation.acquire(() => { owned++; }, () => { owned--; throw reason; }); fulfilled = 7; return { exitCode: fulfilled }; } });
  const result = await outcome(shell.exec('seven')); await outcome(shell.dispose());
  Object.assign(values, { commandFulfilledExitCode: fulfilled, publicRejected: !result.fulfilled, cleanupReasonIdentity: result.reason === reason, ownedResourcesAfter: owned });
};
cases.E04 = async (events, values) => {
  const shell = makeShell(), controller = new AbortController(); let releaseCalls = 0;
  shell.register({ name: 'seven', async execute(context) { createOutputOperation(context, context.stdout).registerCleanup(() => { releaseCalls++; }); return { exitCode: 7 }; } });
  const result = await outcome(shell.exec('seven', { signal: controller.signal })); await shell.dispose();
  Object.assign(values, { publicFulfilled: result.fulfilled, exitCode: result.value?.exitCode, stderrHex: result.fulfilled ? Buffer.from(result.value.stderrBytes).toString('hex') : undefined, callerSignalAborted: controller.signal.aborted, releaseCalls });
};
cases.E05 = async (events, values) => {
  const shell = makeShell(), controller = new AbortController(), ready = deferred(), opaque = deferred(), reason = {};
  shell.register({ name: 'opaque', execute() { ready.resolve(); return opaque.promise; } });
  const pending = outcome(shell.exec('opaque', { signal: controller.signal })); await ready.promise; controller.abort(reason); const result = await pending; events.push('public-settle');
  events.push('opaque-reject'); opaque.reject(new Error('late opaque')); await turn(); await shell.dispose();
  Object.assign(values, { callerReasonIdentity: !result.fulfilled && result.reason === reason, ownedResourcesAfter: 0 });
};
cases.B01 = async (events, values) => {
  const host = fixture(events), target = capture(); let legacyWrites = 0, accountedWrites = 0, chargedBytes = 0;
  const operation = createOutputOperation(host.context, { async write() { legacyWrites++; }, ownedOutput: { consumerClosed: new AbortController().signal, async write(bytes) { accountedWrites++; chargedBytes += bytes.length; await target.sink.write(bytes); } } });
  await operation.output.write(Buffer.from('00ff', 'hex')); await operation.output.write(Buffer.from('41620a', 'hex')); await operation.close();
  Object.assign(values, { legacyWrites, accountedWrites, stdoutHex: target.hex(), chargedBytes });
};
cases.B02 = async (events, values) => {
  for (const maximum of [5, 4]) {
    const shell = makeShell(), target = capture(); let secondWrites = 0;
    shell.register({ name: 'bytes', async execute(context) { const operation = createOutputOperation(context, context.stdout); await operation.output.write(Buffer.from('00ff', 'hex')); await operation.output.write(Buffer.from('41620a', 'hex')); return { exitCode: 0 }; } });
    const result = await outcome(shell.exec('bytes', { limits: { maxOutputBytes: maximum }, stdout: { async write(bytes) { if (bytes[0] === 65) secondWrites++; await target.sink.write(bytes); } } })); await shell.dispose();
    if (maximum === 5) { values.exactLimitExitCode = result.value?.exitCode; values.exactLimitOutputHex = result.value ? Buffer.from(result.value.stdoutBytes).toString('hex') : undefined; assert.equal(target.hex(), values.exactLimitOutputHex); }
    else Object.assign(values, { belowLimitRejected: !result.fulfilled, belowLimitPublishedHex: target.hex(), belowLimitSecondWriteCalls: secondWrites });
  }
};
cases.B03 = async (events, values) => {
  const shell = makeShell(), target = capture(), backing = Buffer.alloc(20); let next = 0, finalized = 0;
  const stdin = { [Symbol.asyncIterator]() { return { async next() { next++; if (next <= 2) { Buffer.from(next === 1 ? '00ff410a' : '4200fe0a', 'hex').copy(backing, 7); return { done: false, value: backing.subarray(7, 11) }; } backing.fill(0xcc); finalized++; return { done: true }; } }; } };
  const result = await shell.exec('cat', { stdin, stdout: target.sink }); await shell.dispose(); backing.fill(0xdd);
  Object.assign(values, { stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), externalHex: target.hex(), payloadWrites: target.parts.length, producerNextCalls: next, producerFinalizations: finalized });
};
cases.B04 = async (events, values) => {
  const host = fixture(events), gate = deferred(), entered = deferred(), target = capture(); let next = 0, writes = 0;
  const operation = createOutputOperation(host.context, { async write(bytes) { writes++; if (writes === 1) { entered.resolve(); await gate.promise; events.push('first-write-finish'); } await target.sink.write(bytes); } });
  const source = { [Symbol.asyncIterator]() { return { async next() { next++; if (next === 2) events.push('second-next'); return next <= 2 ? { done: false, value: Buffer.from(next === 1 ? 'A\n' : 'B\n') } : { done: true }; } }; } };
  const copy = (async () => { for await (const bytes of source) await operation.output.write(bytes); await operation.close(); })();
  await entered.promise; await turn(); values.nextCallsBeforeFirstWriteRelease = next; gate.resolve(); await copy;
  Object.assign(values, { stdoutHex: target.hex(), payloadWrites: writes, probeReads: next - 3 });
};
cases.B05 = async (events, values) => {
  const host = fixture(events); let writes = 0;
  const operation = createOutputOperation(host.context, { async write() { writes++; } }); await operation.close();
  Object.assign(values, { producerNextCalls: 0, writes, acquisitions: 0, ownedResourcesAfter: 0 });
};
cases.B06 = async (events, values) => {
  const shell = makeShell(), target = capture(); let secondSinkWrites = 0;
  shell.register({ name: 'inner', async execute(context) { await createOutputOperation(context, context.stdout).output.write(Buffer.from('AB')); return { exitCode: 0 }; } });
  shell.register({ name: 'outer', async execute(context) { await context.invoke('inner', []); await createOutputOperation(context, context.stdout).output.write(Buffer.from('CD')); return { exitCode: 0 }; } });
  const result = await outcome(shell.exec('outer', { limits: { maxOutputBytes: 3 }, stdout: { async write(bytes) { if (bytes[0] === 67) secondSinkWrites++; await target.sink.write(bytes); } } })); await shell.dispose();
  Object.assign(values, { publicRejected: !result.fulfilled, publishedHex: target.hex(), secondSinkWrites, firstChargedBytes: target.parts.reduce((total, bytes) => total + bytes.length, 0), ownedResourcesAfter: 0 });
};
cases.D03 = async (events, values) => {
  const host = fixture(events), closed = new AbortController(), stderr = capture(), file = capture();
  const stdout = createOutputOperation(host.context, { ...host.target.sink, ownedOutput: { ...host.target.sink, consumerClosed: closed.signal } });
  const errorOperation = createOutputOperation(host.context, stderr.sink), fileOperation = createOutputOperation(host.context, file.sink);
  closed.abort(new Error('consumer')); await stdout.close(); await errorOperation.output.write(Buffer.from('diag\n')); await fileOperation.output.write(Buffer.from('file\n'));
  Object.assign(values, { stderrHex: stderr.hex(), fileHex: file.hex(), contextAbortedByStdout: host.controller.signal.aborted, stderrAbortedByStdout: errorOperation.signal.aborted, fileAbortedByStdout: fileOperation.signal.aborted });
  await errorOperation.close(); await fileOperation.close();
};
cases.L01 = async (events, values) => {
  const target = capture(), input = target.sink, operation = createOutputOperation({ signal: new AbortController().signal }, input);
  await operation.output.write(Buffer.from('legacy\n')); await operation.close();
  const shell = makeShell(); shell.register({ name: 'legacy', async execute(context) { await context.stdout.write(Buffer.from('legacy\n')); return { exitCode: 0 }; } }); const result = await shell.exec('legacy'); await shell.dispose();
  Object.assign(values, { stdoutHex: target.hex(), writes: target.parts.length, exitCode: result.exitCode, inputOwnedOutputPresent: input.ownedOutput !== undefined });
};
cases.L02 = async (events, values) => {
  const gate = deferred(), entered = deferred(); let finalizations = 0, settled = false;
  const source = (async function* () { try { entered.resolve(); await gate.promise; events.push('opaque-next-release'); yield Buffer.from('x'); } finally { finalizations++; events.push('opaque-finalizer-finish'); } })();
  const next = source.next(); await entered.promise; const closing = source.return().then(() => { settled = true; }); await turn(); values.pendingBeforeHostRelease = !settled;
  gate.resolve(); await next; await closing; Object.assign(values, { opaqueFinalizerCalls: finalizations, universalPreemptionClaim: false });
};
