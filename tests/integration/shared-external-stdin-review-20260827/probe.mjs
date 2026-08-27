import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [candidate, output] = process.argv.slice(2);
const moduleAt = path => import(pathToFileURL(join(candidate, 'dist', path)).href);
const { Shell, createMemoryFileSystem, createStandardCommands, readBytes } = await moduleAt('index.js');
const { createGrepAliasCommands } = await moduleAt('commands/grep-aliases/index.js');
const { columnCommands, createColumnCommands } = await moduleAt('commands/column/index.js');
const { ShellInput } = await moduleAt('shell/input.js');
const { Budget, defaultLimits } = await moduleAt('shell/runtime.js');
const report = { candidate, execPath: process.execPath, version: process.version, cases: [], unhandled: [] };
process.on('unhandledRejection', reason => { report.unhandled.push(String(reason)); });
const encoded = value => new TextEncoder().encode(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function turns() { for (let index = 0; index < 8; index++) await tick(); }
function deferred() { let resolve, reject; const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; }
function track(promise) {
  const state = { settled: false };
  state.promise = Promise.resolve(promise).then(value => { state.settled = true; state.value = value; return state; }, error => { state.settled = true; state.rejected = true; state.error = error; return state; });
  return state;
}
function outcome(state) {
  return state.rejected ? { rejected: true, error: String(state.error) } : { exitCode: state.value.exitCode, stdout: state.value.stdout, stderr: state.value.stderr };
}
async function record(name, classification, action) {
  const entry = { name, classification };
  try { Object.assign(entry, await action()); entry.observationVerified = true; }
  catch (error) { entry.observationVerified = false; entry.error = String(error); entry.stack = error.stack; }
  report.cases.push(entry);
  console.log(JSON.stringify(entry));
}
function input({ chunks = ['keep:01\n'], repeat = false, onNext, onReturn = () => {} } = {}) {
  const state = { reads: 0, returns: 0, returned: false, eof: false };
  state.source = { [Symbol.asyncIterator]() { return {
    async next() {
      const index = state.reads++;
      if (onNext) return onNext(index);
      if (!repeat && index >= chunks.length) { state.eof = true; return { done: true }; }
      return { value: encoded(chunks[index % chunks.length]), done: false };
    },
    return() {
      state.returns++;
      const result = onReturn();
      return Promise.resolve(result).then(() => { state.returned = true; return { done: true }; });
    },
  }; } };
  return state;
}
function host(fs = createMemoryFileSystem()) {
  const shell = new Shell({ fs, env: { LC_ALL: 'C' } });
  for (const definition of createStandardCommands()) shell.commands.register(definition);
  for (const definition of createGrepAliasCommands()) shell.commands.register(definition);
  shell.commands.register({ name: 'one', async execute(context) { for await (const chunk of readBytes(context.stdin, context.signal)) { await context.stdout.write(chunk); break; } return { exitCode: 0 }; } });
  shell.commands.register({ name: 'drain', async execute(context) { for await (const chunk of readBytes(context.stdin, context.signal)) await context.stdout.write(chunk); return { exitCode: 0 }; } });
  return shell;
}
async function direct(definition, args, source, signal = new AbortController().signal) {
  const stdout = [], stderr = [];
  const state = await track(Promise.resolve().then(() => definition.execute({
    command: definition.name, args, cwd: '/', env: { LC_ALL: 'C' }, fs: createMemoryFileSystem(), signal, stdin: source,
    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } }, stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
  }))).promise;
  if (!state.rejected) state.value = { ...state.value, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  return state;
}

await record('normal EOF: direct helper and Shell do not call return', 'existing-behavior', async () => {
  const first = input({ chunks: ['α\n', 'β\n'] }); for await (const chunk of readBytes(first.source)) assert.ok(chunk.length);
  const second = input({ chunks: ['α\n', 'β\n'] }), shell = host();
  try { const result = await shell.exec('drain', { stdin: second.source }); assert.equal(result.stdout, 'α\nβ\n'); assert.equal(first.returns, 0); assert.equal(second.returns, 0); return { reads: second.reads, returns: second.returns, result }; }
  finally { await shell.dispose(); }
});
await record('early stop: direct helper and owning Shell return exactly once', 'existing-behavior', async () => {
  const first = input({ repeat: true }); for await (const chunk of readBytes(first.source)) { assert.ok(chunk.length); break; }
  const second = input({ repeat: true }), shell = host();
  try { const result = await shell.exec('one', { stdin: second.source }); assert.equal(result.stdout, 'keep:01\n'); assert.equal(first.returns, 1); assert.equal(second.returns, 1); return { result, directReturns: first.returns, shellReturns: second.returns }; }
  finally { await shell.dispose(); }
});

for (const style of ['sync', 'async']) {
  for (const definition of [createStandardCommands().find(command => command.name === 'grep'), ...createGrepAliasCommands()]) {
    for (const boundary of ['direct', 'Shell']) await record(`${boundary} ${definition.name}: ${style} external return rejection`, boundary === 'Shell' ? 'existing-error-propagation-defect' : 'failure-preserved-control', async () => {
      const sentinel = new Error(`${style}-${definition.name}-return-sentinel`);
      const source = input({ repeat: true, onReturn: () => { if (style === 'sync') throw sentinel; return Promise.reject(sentinel); } });
      const shell = boundary === 'Shell' ? host() : undefined;
      try {
        const state = boundary === 'direct' ? await direct(definition, ['-q', 'keep'], source.source) : await track(shell.exec(`${definition.name} -q keep`, { stdin: source.source })).promise;
        const actual = outcome(state), failureVisible = !!state.rejected || state.value.exitCode !== 0;
        assert.equal(source.returns, 1);
        assert.equal(failureVisible, boundary === 'direct');
        if (boundary === 'Shell') { assert.equal(state.value.stderr, ''); assert.equal(state.value.stdout, ''); }
        return { desiredFailureVisible: true, failureVisible, behaviorAccepted: failureVisible, sameSentinel: state.error === sentinel, returns: source.returns, outcome: actual };
      } finally { await shell?.dispose(); }
    });
  }
}

for (const failure of [undefined, null, new Error('return-error')]) await record(`unread external return rejection ${String(failure)}`, 'existing-error-propagation-defect', async () => {
  const source = input({ onReturn: () => Promise.reject(failure) }), shell = host();
  try { const state = await track(shell.exec('true', { stdin: source.source })).promise; assert.equal(source.reads, 0); assert.equal(source.returns, 1); assert.equal(state.rejected, undefined); assert.equal(state.value.exitCode, 0); return { behaviorAccepted: false, desiredFailureVisible: true, failureVisible: false, reads: source.reads, returns: source.returns, outcome: outcome(state) }; }
  finally { await shell.dispose(); }
});

for (const failure of [undefined, null, new Error('return-error')]) await record(`direct readBytes preserves return rejection ${String(failure)}`, 'failure-preserved-control', async () => {
  const source = input({ repeat: true, onReturn: () => Promise.reject(failure) });
  const state = await track((async () => { for await (const chunk of readBytes(source.source)) { assert.ok(chunk.length); break; } })()).promise;
  assert.equal(state.rejected, true); assert.equal(state.error, failure); assert.equal(source.returns, 1);
  return { sameReason: true, returns: source.returns };
});

await record('direct and Shell primary read failure precedes secondary return failure', 'existing-precedence-control', async () => {
  const primary = new Error('primary-read'), secondary = new Error('secondary-return');
  const make = () => input({ onNext: () => { throw primary; }, onReturn: () => { throw secondary; } });
  const first = make(), directState = await track((async () => { for await (const chunk of readBytes(first.source)) assert.ok(chunk); })()).promise;
  assert.equal(directState.error, primary);
  const second = make(), shell = host();
  try { const result = await shell.exec('drain', { stdin: second.source }); assert.equal(result.exitCode, 1); assert.match(result.stderr, /primary-read/u); assert.doesNotMatch(result.stderr, /secondary-return/u); assert.equal(second.returns, 1); return { directPrimaryIdentity: true, result }; }
  finally { await shell.dispose(); }
});

await record('selected output-budget rejection survives external return rejection', 'existing-precedence-control', async () => {
  const source = input({ repeat: true, onReturn: () => { throw new Error('secondary-return'); } }), shell = host();
  try { const state = await track(shell.exec('one', { stdin: source.source, limits: { maxOutputBytes: 0 } })).promise; assert.equal(state.rejected, true); assert.match(String(state.error), /maxOutputBytes/u); assert.equal(source.returns, 1); return { outcome: outcome(state), returns: source.returns }; }
  finally { await shell.dispose(); }
});

await record('explicit registered failure is not hidden by successful/nonzero result', 'registered-owned-guarantee', async () => {
  const results = [];
  for (const status of [0, 7]) {
    const shell = host(), sentinel = new Error('owned-cleanup');
    shell.commands.register({ name: 'ownedfail', execute(context) { context.registerCleanup(() => { throw sentinel; }); return { exitCode: status }; } });
    try { const state = await track(shell.exec('ownedfail')).promise; assert.equal(state.rejected, true); assert.equal(state.error, sentinel); results.push({ commandStatus: status, sameFailure: true }); }
    finally { await shell.dispose(); }
  }
  return { results };
});

for (const mode of ['normal-release', 'dispose', 'caller-abort']) await record(`external column deferred return: ${mode}`, mode === 'normal-release' ? 'existing-nonabort-wait' : 'stronger-external-barrier-not-promised', async () => {
  const entered = deferred(), gate = deferred(), controller = new AbortController(), reason = { caller: 'exact-reason' };
  const source = input({ chunks: ['a b\n'], repeat: true, onReturn() { entered.resolve(); return gate.promise; } }), shell = host();
  shell.use(columnCommands({ limits: { maxInputBytes: 1 } }));
  const operation = track(shell.exec('column -t', { stdin: source.source, signal: controller.signal })); let disposal;
  try {
    await entered.promise; await turns();
    const beforeInterruption = { execSettled: operation.settled, returns: source.returns, returned: source.returned }; assert.equal(operation.settled, false);
    if (mode === 'dispose') disposal = track(shell.dispose());
    if (mode === 'caller-abort') { controller.abort(reason); await operation.promise; disposal = track(shell.dispose()); }
    await turns();
    const beforeGateRelease = { execSettled: operation.settled, disposeSettled: disposal?.settled ?? false, returned: source.returned };
    assert.equal(operation.settled, mode !== 'normal-release');
    if (disposal) assert.equal(disposal.settled, true);
    if (mode === 'caller-abort') assert.equal(operation.error, reason);
    gate.resolve(); await operation.promise; await disposal?.promise; assert.equal(source.returns, 1);
    if (mode === 'normal-release') assert.equal(operation.value.exitCode, 1);
    return { beforeInterruption, beforeGateRelease, callerIdentity: mode === 'caller-abort' ? operation.error === reason : undefined, outcome: outcome(operation) };
  } finally { gate.resolve(); await operation.promise; await shell.dispose(); }
});

await record('column owned VFS return keeps exec and concurrent dispose pending', 'registered-owned-guarantee', async () => {
  const entered = deferred(), gate = deferred(), fs = createMemoryFileSystem(); await fs.writeFile('/input', encoded('a b\n'));
  const source = input({ chunks: ['a b\n'], repeat: true, onReturn() { entered.resolve(); return gate.promise; } });
  fs.readStream = () => source.source;
  const shell = host(fs); shell.use(columnCommands({ limits: { maxInputBytes: 1 } }));
  const operation = track(shell.exec('column -t /input')); let disposal;
  try { await entered.promise; await turns(); disposal = track(shell.dispose()); await turns();
    const beforeGateRelease = { execSettled: operation.settled, disposeSettled: disposal.settled, returns: source.returns };
    assert.equal(operation.settled, false); assert.equal(disposal.settled, false);
    gate.resolve(); await operation.promise; await disposal.promise; assert.equal(source.returned, true); assert.equal(source.returns, 1);
    return { beforeGateRelease, returned: source.returned, outcome: outcome(operation) };
  } finally { gate.resolve(); await operation.promise; await shell.dispose(); }
});

await record('direct column deferred return waits without an optional registration hook', 'direct-finally-not-public-abort-barrier', async () => {
  const entered = deferred(), gate = deferred(), source = input({ chunks: ['a b\n'], repeat: true, onReturn() { entered.resolve(); return gate.promise; } });
  const operation = track(direct(createColumnCommands({ limits: { maxInputBytes: 1 } })[0], ['-t'], source.source));
  try { await entered.promise; await turns(); assert.equal(operation.settled, false); gate.resolve(); await operation.promise; assert.equal(source.returns, 1); return { waited: true, outcome: outcome(operation.value) }; }
  finally { gate.resolve(); await operation.promise; }
});

await record('caller abort drains registered work but not structural pending next/return', 'registered-owned-versus-opaque-input', async () => {
  const entered = deferred(), read = deferred(), returned = deferred(), cleanupEntered = deferred(), owned = deferred(), controller = new AbortController();
  const source = input({ onNext() { entered.resolve(); return read.promise; }, onReturn() { returned.resolve(); return new Promise((resolve, reject) => { source.rejectReturn = reject; }); } });
  const shell = host(); shell.commands.register({ name: 'ownedreader', async execute(context) { context.registerCleanup(async () => { cleanupEntered.resolve(); await owned.promise; }); for await (const chunk of context.stdin) await context.stdout.write(chunk); return { exitCode: 0 }; } });
  const operation = track(shell.exec('ownedreader', { stdin: source.source, signal: controller.signal })); let disposal;
  try {
    await entered.promise; controller.abort(0); await cleanupEntered.promise; await returned.promise;
    disposal = track(shell.dispose()); await turns(); assert.equal(operation.settled, false); assert.equal(disposal.settled, false);
    owned.resolve(); await operation.promise; await disposal.promise; assert.equal(operation.error, 0); assert.equal(source.returned, false);
    read.reject(new Error('late-next')); source.rejectReturn(new Error('late-return')); await turns();
    return { registeredBarrier: true, callerReasonIdentity: operation.error === 0, settledBeforeRawInputs: true, returns: source.returns };
  } finally { owned.resolve(); read.resolve({ done: true }); source.rejectReturn?.(new Error('finally-return')); await operation.promise; await shell.dispose(); }
});

await record('opaque async generator return queues behind pending next', 'stronger-external-barrier-not-promised', async () => {
  const started = deferred(), inputGate = deferred(), finallyEntered = deferred(), returnGate = deferred(), controller = new AbortController(), reason = new Error('caller-generator');
  let returns = 0, finalized = false;
  const generator = (async function* () { try { started.resolve(); await inputGate.promise; yield encoded('late'); } finally { finallyEntered.resolve(); await returnGate.promise; finalized = true; } })();
  const source = { [Symbol.asyncIterator]() { return { next: () => generator.next(), return() { returns++; return generator.return(); } }; } };
  const shell = host(), operation = track(shell.exec('drain', { stdin: source, signal: controller.signal }));
  try {
    await started.promise; controller.abort(reason); await operation.promise; await shell.dispose(); assert.equal(operation.error, reason); assert.equal(returns, 1); assert.equal(finalized, false);
    const atPublicSettlement = { returns, finalized };
    inputGate.resolve(); await finallyEntered.promise; assert.equal(finalized, false); returnGate.resolve(); await generator.return(); assert.equal(finalized, true);
    return { atPublicSettlement, finalizedAfterHarnessRelease: finalized, callerIdentity: true };
  } finally { inputGate.resolve(); returnGate.resolve(); await operation.promise; await shell.dispose(); await generator.return(); }
});

await record('caller abort during external deferred rejection preserves exact primitive', 'existing-precedence-control', async () => {
  const entered = deferred(), gate = deferred(), controller = new AbortController(), shell = host();
  const source = input({ repeat: true, onReturn() { entered.resolve(); return gate.promise; } });
  const operation = track(shell.exec('one', { stdin: source.source, signal: controller.signal }));
  try { await entered.promise; controller.abort('caller-primitive'); await operation.promise; assert.equal(operation.error, 'caller-primitive'); gate.reject(new Error('later-return')); await turns(); return { callerIdentity: true, returns: source.returns }; }
  finally { gate.resolve(); await operation.promise; await shell.dispose(); }
});

await record('sequential commands borrow one cursor without intermediate return', 'shared-stdin-lease-control', async () => {
  const source = input({ chunks: ['A', 'B', 'C'] }), shell = host(), between = [];
  shell.commands.register({ name: 'checkpoint', execute() { between.push(source.returns); return { exitCode: 0 }; } });
  try { const result = await shell.exec('one; checkpoint; one; checkpoint; drain', { stdin: source.source }); assert.equal(result.stdout, 'ABC'); assert.deepEqual(between, [0, 0]); assert.equal(source.returns, 0); assert.equal(source.reads, 4); return { result, between, reads: source.reads, returns: source.returns }; }
  finally { await shell.dispose(); }
});

await record('read builtins retain multibyte same-chunk remainder until owning close', 'shared-stdin-lease-control', async () => {
  const source = input({ chunks: ['α\nβ\nγ\n'] }), shell = host(), between = [];
  shell.commands.register({ name: 'checkpoint', execute() { between.push(source.returns); return { exitCode: 0 }; } });
  try { const result = await shell.exec('read -r first; checkpoint; read -r second; checkpoint; printf "%s|%s" "$first" "$second"', { stdin: source.source }); assert.equal(result.stdout, 'α|β'); assert.deepEqual(between, [0, 0]); assert.equal(source.reads, 1); assert.equal(source.returns, 1); return { result, between, reads: source.reads, returns: source.returns }; }
  finally { await shell.dispose(); }
});

await record('borrowed ShellInput close does not own return; queued cancellation preserves serialization', 'shared-stdin-lease-control', async () => {
  const gate = deferred(); let active = 0, maximum = 0;
  const source = input({ async onNext(index) { active++; maximum = Math.max(maximum, active); try { if (index === 0) await gate.promise; return { done: false, value: encoded(String(index)) }; } finally { active--; } } });
  const budget = new Budget(defaultLimits), owner = new ShellInput(source.source, budget), controller = new AbortController();
  const first = new ShellInput(owner, budget), cancelled = new ShellInput(owner, budget, controller.signal), third = new ShellInput(owner, budget);
  const firstRead = first.next(), abandoned = track(cancelled.next()), thirdRead = third.next();
  try {
    controller.abort('queued'); await abandoned.promise; await cancelled.close(); assert.equal(source.returns, 0);
    gate.resolve(); assert.equal(Buffer.from((await firstRead).value).toString(), '0'); assert.equal(Buffer.from((await thirdRead).value).toString(), '1');
    await first.close(); await third.close(); assert.equal(source.returns, 0); await owner.close(); assert.equal(source.returns, 1); assert.equal(maximum, 1);
    return { borrowedIteratorHasReturn: typeof first[Symbol.asyncIterator]().return === 'function', returns: source.returns, maximumConcurrentNext: maximum, cancelledReason: abandoned.error };
  } finally { gate.resolve(); await owner.close(); }
});

await turns();
report.counts = { observations: report.cases.length, verified: report.cases.filter(entry => entry.observationVerified).length, unexpected: report.cases.filter(entry => !entry.observationVerified).length, retainedDefectRows: report.cases.filter(entry => entry.behaviorAccepted === false).length };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
if (report.counts.unexpected || report.unhandled.length) process.exitCode = 1;
console.log(JSON.stringify({ counts: report.counts, unhandled: report.unhandled }));
