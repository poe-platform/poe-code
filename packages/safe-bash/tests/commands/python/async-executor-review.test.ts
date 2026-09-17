import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Shell } from '../../../src/shell/index.js';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import type { CommandContext } from '../../../src/contracts/command.js';
import {
  createPythonCommands, createPythonPackageEnvironment, inspectPythonCapabilities, pythonCommands, PythonFailure,
  type PythonAsyncExecutor, type PythonCommandsOptions, type PythonDiagnostic, type PythonExecutorStart,
} from '../../../src/commands/python/index.js';

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function invocation(signal = new AbortController().signal) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const fs = new MemoryFileSystem();
  const context: CommandContext = {
    command: 'python', args: ['-c', 'pass'], cwd: '/', env: {}, fs, signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  return { context, fs, stdout, stderr, cleanups };
}

test('cancellation drains both executor run and termination before releasing shared alias capacity', async () => {
  const abort = new AbortController();
  const host = invocation(abort.signal);
  const entered = deferred<PythonExecutorStart>();
  const runRelease = deferred();
  const terminateEntered = deferred();
  const terminateRelease = deferred();
  let factories = 0;
  let terminations = 0;
  const commands = createPythonCommands({ maxConcurrentWorkers: 1, createExecutor() {
    assert.ok(host.cleanups.length > 0, 'cleanup registration must precede factory acquisition');
    factories++;
    if (factories > 1) return { async run() { return 0; }, async terminate() { terminations++; } };
    return {
      async run(start) { entered.resolve(start); await runRelease.promise; return 0; },
      async terminate() { terminations++; terminateEntered.resolve(); await terminateRelease.promise; },
    };
  } });
  const execution = Promise.resolve(commands[0]!.execute(host.context));
  const result = Promise.allSettled([execution]);
  let settled = false;
  void result.then(() => { settled = true; });
  try {
    const start = await entered.promise;
    abort.abort(false);
    await terminateEntered.promise;
    assert.equal(start.signal.aborted, true);
    const busy = invocation();
    assert.equal((await commands[1]!.execute(busy.context)).exitCode, 1);
    assert.match(Buffer.concat(busy.stderr).toString(), /capacity exhausted/);
    assert.equal(factories, 1);
    terminateRelease.resolve();
    await nextTurn();
    assert.equal(settled, false, 'successful termination alone must not hide an unsettled run');
  } finally { terminateRelease.resolve(); runRelease.resolve(); await result; }
  assert.deepEqual(await result, [{ status: 'rejected', reason: false }]);
  assert.equal((await commands[1]!.execute(invocation().context)).exitCode, 0);
  assert.equal(terminations, 2);
});

test('executor exit with an outstanding open drains its late descriptor and rejects the request', async context => {
  const host = invocation();
  await host.context.fs.writeFile('/input', new Uint8Array([1]));
  const acquired = deferred();
  const deliver = deferred();
  const closeEntered = deferred();
  const closeRelease = deferred();
  const terminated = deferred();
  const open = host.fs.open.bind(host.fs);
  let closes = 0;
  context.mock.method(host.fs, 'open', async (...args: Parameters<typeof open>) => {
    const descriptor = await open(...args);
    const close = descriptor.close.bind(descriptor);
    context.mock.method(descriptor, 'close', async () => {
      closes++;
      closeEntered.resolve();
      await closeRelease.promise;
      await close();
    });
    acquired.resolve();
    await deliver.promise;
    return descriptor;
  });
  let request: PromiseSettledResult<unknown>[] | undefined;
  const diagnostics: PythonDiagnostic[] = [];
  const [command] = createPythonCommands({
    createExecutor: () => ({
      async run(start) {
        void Promise.allSettled([start.dispatch({ op: 'open', args: ['/input', { access: 'read' }] })])
          .then(result => { request = result; });
        await acquired.promise;
        return 0;
      },
      async terminate() { terminated.resolve(); },
    }),
    onDiagnostic(event) { diagnostics.push(event); },
  });
  const execution = Promise.resolve(command!.execute(host.context));
  let settled = false;
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await acquired.promise;
    await terminated.promise;
    deliver.resolve();
    await closeEntered.promise;
    await nextTurn();
    assert.equal(settled, false, 'command exit must await admitted descriptor retirement');
  } finally { deliver.resolve(); closeRelease.resolve(); await execution; }
  assert.equal((await execution).exitCode, 1);
  assert.equal(request?.[0]?.status, 'rejected');
  assert.equal(closes, 1);
  assert.ok(diagnostics.some(event => event.failure.category === 'transport-unavailable'));
});

test('concurrent dispatch rejects before a second sink effect and permits later sequential requests', async () => {
  const host = invocation();
  const entered = deferred();
  const release = deferred();
  const outputContext: CommandContext = { ...host.context, stdout: { async write(bytes) {
    host.stdout.push(Uint8Array.from(bytes)); entered.resolve(); await release.promise;
  } } };
  let refused: PromiseSettledResult<unknown> | undefined;
  const [command] = createPythonCommands({ createExecutor: () => ({
    async run(start) {
      const first = start.dispatch({ op: 'stdout', args: [[65]] });
      await entered.promise;
      [refused] = await Promise.allSettled([start.dispatch({ op: 'stdout', args: [[66]] })]);
      release.resolve();
      await first;
      await start.dispatch({ op: 'stdout', args: [[67]] });
      return 0;
    },
    async terminate() { release.resolve(); },
  }) });
  try {
    assert.equal((await command!.execute(outputContext)).exitCode, 0);
    assert.equal(refused?.status, 'rejected');
    if (refused?.status === 'rejected') assert.equal(refused.reason.category, 'transport-unavailable');
    assert.equal(Buffer.concat(host.stdout).toString(), 'AC');
  } finally { release.resolve(); }
});

test('late ready and dispatch callbacks cannot revive an invocation or mutate its filesystem', async () => {
  const host = invocation();
  await host.context.fs.writeFile('/keep', new Uint8Array([91]));
  const phases: string[] = [];
  let retained!: PythonExecutorStart;
  let terminations = 0;
  const [command] = createPythonCommands({
    createExecutor: () => ({
      async run(start) { retained = start; start.onReady(); start.onReady(); return 0; },
      async terminate() { terminations++; retained.onReady(); },
    }),
    onProgress(event) { phases.push(event.phase); },
  });
  assert.equal((await command!.execute(host.context)).exitCode, 0);
  retained.onReady();
  const effects = await Promise.allSettled([
    retained.dispatch({ op: 'rm', args: ['/keep'] }), retained.dispatch({ op: 'stdout', args: [[65]] }),
  ]);
  assert.ok(effects.every(effect => effect.status === 'rejected'));
  assert.equal(retained.signal.aborted, true);
  assert.deepEqual(phases, ['initializing', 'ready', 'finished']);
  assert.deepEqual(await host.context.fs.readFile('/keep'), new Uint8Array([91]));
  assert.equal(host.stdout.length, 0);
  assert.equal(terminations, 1);
});

test('direct execution needs neither SharedArrayBuffer nor Atomics even for binary output', async context => {
  context.mock.property(globalThis, 'SharedArrayBuffer', undefined);
  context.mock.property(globalThis, 'Atomics', undefined);
  const host = invocation();
  const createExecutor = () => ({ async run(start: PythonExecutorStart) {
    start.onReady(); await start.dispatch({ op: 'stdout', args: [[0, 255]] }); return 0;
  }, async terminate() {} });
  assert.equal(inspectPythonCapabilities({ createExecutor }).configurationValid, true);
  const [command] = createPythonCommands({ createExecutor });
  assert.equal((await command!.execute(host.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(host.stdout), Buffer.from([0, 255]));
});

test('direct dispatch enforces transfer and open-handle limits without partial writes', async () => {
  const host = invocation();
  await host.context.fs.writeFile('/input', new Uint8Array([1, 2]));
  const refusals: PromiseSettledResult<unknown>[] = [];
  const [command] = createPythonCommands({ maxTransferBytes: 2, maxOpenFiles: 1, createExecutor: () => ({
    async run(start) {
      const handle = await start.dispatch({ op: 'open', args: ['/input', { access: 'readwrite' }] });
      for (const request of [
        { op: 'open', args: ['/input', { access: 'read' }] },
        { op: 'read', args: [handle, 3, 0] },
        { op: 'write', args: [handle, [3, 4, 5], 0] },
        { op: 'stdout', args: [[3, 4, 5]] },
      ]) refusals.push((await Promise.allSettled([start.dispatch(request)]))[0]!);
      await start.dispatch({ op: 'close', args: [handle] });
      const next = await start.dispatch({ op: 'open', args: ['/input', { access: 'read' }] });
      await start.dispatch({ op: 'close', args: [next] });
      return 0;
    }, async terminate() {},
  }) });
  assert.equal((await command!.execute(host.context)).exitCode, 0);
  assert.ok(refusals.every(result => result.status === 'rejected'));
  assert.equal(host.stdout.length, 0);
  assert.deepEqual(await host.context.fs.readFile('/input'), new Uint8Array([1, 2]));
});

test('invalid invocation is refused before executor factory acquisition', async () => {
  const host = invocation();
  let factories = 0;
  const [command] = createPythonCommands({ createExecutor() {
    factories++; return { async run() { return 0; }, async terminate() {} };
  } });
  const result = await command!.execute({ ...host.context, args: ['-c'] });
  assert.equal(result.exitCode, 2);
  assert.equal(factories, 0);
});

test('two shells borrow the same factory without disposing its provider or terminating sibling sessions', async () => {
  const firstStarted = deferred();
  const secondStarted = deferred<PythonExecutorStart>();
  const gates = [deferred(), deferred()];
  const terminations = [0, 0, 0];
  let factories = 0;
  let providerDisposals = 0;
  const createExecutor = Object.assign(() => {
    const index = factories++;
    return {
      async run(start: PythonExecutorStart) {
        if (index === 0) firstStarted.resolve();
        if (index === 1) secondStarted.resolve(start);
        await gates[index]?.promise;
        if (index !== 0) await start.dispatch({ op: 'stdout', args: [[65 + index]] });
        return 0;
      },
      async terminate() { terminations[index]!++; gates[index]?.resolve(); },
    };
  }, { dispose() { providerDisposals++; } });
  const environment = createPythonPackageEnvironment();
  const first = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor, environment }));
  const second = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor, environment }));
  const firstRun = Promise.allSettled([first.exec('python -c pass')]);
  const secondRun = second.exec('python3 -c pass');
  try {
    await firstStarted.promise;
    const sibling = await secondStarted.promise;
    await first.dispose();
    assert.equal(sibling.signal.aborted, false);
    assert.deepEqual(terminations, [1, 0, 0]);
    gates[1]!.resolve();
    assert.equal((await secondRun).stdout, 'B');
    assert.equal((await second.exec('python -c pass')).stdout, 'C');
    assert.equal(providerDisposals, 0);
  } finally {
    for (const gate of gates) gate.resolve();
    await Promise.allSettled([firstRun, secondRun, first.dispose(), second.dispose(), environment.dispose()]);
  }
  assert.deepEqual(terminations, [1, 1, 1]);
  assert.equal(providerDisposals, 0);
});

test('malformed executor with a callable terminate is retired and does not consume the next alias slot', async () => {
  let factories = 0;
  let terminations = 0;
  const diagnostics: PythonDiagnostic[] = [];
  const commands = createPythonCommands({ maxConcurrentWorkers: 1,
    createExecutor() {
      factories++;
      const terminate = async () => { terminations++; };
      return factories === 1 ? { terminate } as PythonAsyncExecutor : { async run() { return 0; }, terminate };
    },
    onDiagnostic(event) { diagnostics.push(event); },
  });
  const host = invocation();
  assert.equal((await commands[0]!.execute(host.context)).exitCode, 1);
  assert.equal(diagnostics[0]!.failure.category, 'executor-unavailable');
  assert.equal((await commands[1]!.execute(invocation().context)).exitCode, 0);
  assert.equal(terminations, 2);
});

test('capability inspection rejects the same malformed second factory as command construction', () => {
  const options = {
    createExecutor: () => ({ async run() { return 0; }, async terminate() {} }),
    createWorker: 42,
  } as unknown as PythonCommandsOptions;
  assert.throws(() => createPythonCommands(options), PythonFailure);
  const report = inspectPythonCapabilities(options);
  assert.equal(report.configurationValid, false, 'inspection must not certify a configuration rejected at installation');
  assert.ok(report.failures.some(failure => failure.category === 'executor-unavailable'));
});

test('executor factory PythonFailure preserves its category like the worker factory', async () => {
  const failure = new PythonFailure('runtime-abi');
  const diagnostics: PythonDiagnostic[] = [];
  const [command] = createPythonCommands({ createExecutor() { throw failure; }, onDiagnostic(event) { diagnostics.push(event); } });
  const host = invocation();
  assert.equal((await command!.execute(host.context)).exitCode, 1);
  assert.equal(diagnostics[0]!.cause, failure);
  assert.equal(diagnostics[0]!.failure.category, 'runtime-abi');
  assert.match(Buffer.concat(host.stderr).toString(), /native ABI is unsupported/);
});

test('invalid executor exit status is a transport diagnostic rather than an interpreter failure', async () => {
  const host = invocation();
  const diagnostics: PythonDiagnostic[] = [];
  const [command] = createPythonCommands({ createExecutor: () => ({
    async run(start) { start.onReady(); return NaN; }, async terminate() {},
  }), onDiagnostic(event) { diagnostics.push(event); } });
  assert.equal((await command!.execute(host.context)).exitCode, 1);
  assert.equal(diagnostics[0]!.failure.category, 'transport-unavailable');
});

test('caught ENOTSUP dispatches retain one filesystem diagnostic instead of silently losing worker parity', async () => {
  const host = invocation();
  Object.defineProperty(host.context.fs, 'open', { value: undefined });
  const diagnostics: PythonDiagnostic[] = [];
  const [command] = createPythonCommands({ createExecutor: () => ({
    async run(start) {
      start.onReady();
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(start.dispatch({ op: 'open', args: ['/input', { access: 'read' }] }), { code: 'ENOTSUP' });
      }
      return 1;
    }, async terminate() {},
  }), onDiagnostic(event) { diagnostics.push(event); } });
  assert.equal((await command!.execute(host.context)).exitCode, 1);
  assert.deepEqual(diagnostics.map(event => event.failure.category), ['filesystem-open']);
  assert.equal(Buffer.concat(host.stderr).toString(), 'python: ' + new PythonFailure('filesystem-open').message + '\n');
});

test('oversized stdin preserves the worker input-limit diagnostic and does not poison later alias admission', async () => {
  const host = invocation();
  let finalized = 0;
  let attempts = 0;
  const inputContext: CommandContext = { ...host.context, stdin: { async *[Symbol.asyncIterator]() {
    try { yield new Uint8Array([1, 2, 3]); }
    finally { finalized++; }
  } } };
  const commands = createPythonCommands({ maxInputChunkBytes: 2, maxConcurrentWorkers: 1, createExecutor: () => ({
    async run(start) { start.onReady(); if (attempts++ === 0) await start.dispatch({ op: 'stdin', args: [1] }); return 0; },
    async terminate() {},
  }) });
  assert.equal((await commands[0]!.execute(inputContext)).exitCode, 1);
  assert.equal(finalized, 1);
  assert.equal((await commands[1]!.execute(invocation().context)).exitCode, 0);
  assert.match(Buffer.concat(host.stderr).toString(), /Python input chunk exceeds maxInputChunkBytes/);
});
