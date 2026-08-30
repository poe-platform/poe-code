import assert from 'node:assert/strict';
import { encoder, never, turn, gate, watch, pending, resolved, rejected, result, register, closedRegistration } from './support.mjs';

export const cases = [];
const define = (id, title, obligations, run) => cases.push({ id, title, obligations, run });

define('H01', 'Middleware and command acquire after registration; normal delayed barrier',
  ['pre-acquisition middleware ownership', 'all hooks start', 'normal exact bytes/sinks', 'no early settlement'], async host => {
    const shell = host.shell();
    const release = gate();
    const middlewareStarted = gate();
    const commandStarted = gate();
    const calls = { middleware: 0, command: 0 };
    let acquired = 0;
    shell.use(async (context, next) => {
      register(context, async () => { calls.middleware++; middlewareStarted.release(); await release.promise; acquired--; });
      acquired++;
      host.event('middleware-acquired-after-register');
      return next();
    });
    shell.register({ name: 'owned', async execute(context) {
      register(context, async () => { calls.command++; commandStarted.release(); await release.promise; acquired--; });
      acquired++;
      host.event('command-acquired-after-register');
      await context.stdout.write(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41, 0, 0xff]));
      return { exitCode: 0 };
    } });
    const sink = [];
    const execution = watch(shell.exec('owned', { stdout: { write: async bytes => { sink.push(Buffer.from(bytes)); } } }));
    await Promise.all([middlewareStarted.promise, commandStarted.promise]);
    assert.equal(acquired, 2);
    await pending(execution, 'exec cannot bypass either privileged hook');
    release.release();
    result(await resolved(execution), 0, 'efbbbf4100ff');
    assert.equal(Buffer.concat(sink).toString('hex'), 'efbbbf4100ff');
    assert.equal(acquired, 0);
    await host.dispose(shell);
    assert.deepEqual(calls, { middleware: 1, command: 1 });
  });

define('H02', 'Duplicate registrations, invalid callback and shared idempotent owner',
  ['sync TypeError', 'each registration once', 'finally/drain sharing', 'repeated dispose'], async host => {
    const shell = host.shell();
    let callbacks = 0;
    let releases = 0;
    let closed;
    const ownerStarted = gate();
    const ownerRelease = gate();
    const callbacksStarted = gate();
    const controller = new AbortController();
    const reason = new Error('abort overlaps command finally');
    const closeOwner = () => closed ??= Promise.resolve().then(async () => { ownerStarted.release(); await ownerRelease.promise; releases++; });
    shell.register({ name: 'owned', async execute(context) {
      assert.equal(typeof context.registerCleanup, 'function');
      assert.throws(() => context.registerCleanup(null), TypeError);
      const cleanup = () => { if (++callbacks === 2) callbacksStarted.release(); return closeOwner(); };
      register(context, cleanup);
      register(context, cleanup);
      try { return { exitCode: 0 }; } finally { await closeOwner(); }
    } });
    const execution = watch(shell.exec('owned', { signal: controller.signal }));
    await ownerStarted.promise;
    controller.abort(reason);
    await callbacksStarted.promise;
    await pending(execution, 'overlapping finally and callbacks share delayed owner close');
    ownerRelease.release();
    await rejected(execution, reason);
    await Promise.all([host.dispose(shell), host.dispose(shell)]);
    assert.equal(callbacks, 2);
    assert.equal(releases, 1);
  });

define('H03', 'Undefined sole cleanup rejection supersedes nonzero command result',
  ['undefined failure presence', 'nonzero result does not hide cleanup failure'], async host => {
    const shell = host.shell();
    let calls = 0;
    shell.register({ name: 'owned', execute(context) {
      register(context, () => { calls++; return Promise.reject(undefined); });
      return { exitCode: 7 };
    } });
    await rejected(watch(shell.exec('owned')), undefined);
    assert.equal(calls, 1);
  });

define('H04', 'All hooks start and finish despite synchronous/async multiple failures',
  ['drain-all', 'no sequential deadlock', 'AggregateError exact members without order'], async host => {
    const shell = host.shell();
    const barrier = gate();
    const allStarted = gate();
    const failure = { tag: 'second cleanup' };
    let started = 0;
    let finished = 0;
    const start = () => { if (++started === 3) allStarted.release(); };
    shell.register({ name: 'owned', execute(context) {
      register(context, async () => { start(); await barrier.promise; finished++; });
      register(context, () => { start(); throw undefined; });
      register(context, async () => { start(); throw failure; });
      return { exitCode: 0 };
    } });
    const execution = watch(shell.exec('owned'));
    await allStarted.promise;
    await pending(execution, 'failure cannot abandon a different admitted cleanup');
    barrier.release();
    await execution.promise;
    assert.equal(execution.rejected, true);
    assert.ok(execution.reason instanceof AggregateError);
    assert.equal(execution.reason.errors.length, 2);
    assert.ok(execution.reason.errors.includes(undefined));
    assert.ok(execution.reason.errors.includes(failure));
    assert.equal(finished, 1);
  });

define('H05', 'Existing ordinary command error-to-status diagnostic remains exact',
  ['existing execution semantics', 'normal cleanup after command error'], async host => {
    const shell = host.shell();
    let cleaned = 0;
    const started = gate();
    const release = gate();
    shell.register({ name: 'owned', execute(context) {
      register(context, async () => { started.release(); await release.promise; cleaned++; });
      throw new Error('plain failure');
    } });
    const execution = watch(shell.exec('owned'));
    await started.promise;
    await pending(execution, 'error-to-status path must not bypass cleanup');
    release.release();
    result(await resolved(execution), 1, '', Buffer.from('shell: line 1: plain failure\n').toString('hex'));
    assert.equal(cleaned, 1);
    await host.dispose(shell);
  });

define('H06', 'Existing public execution rejection wins over cleanup failure',
  ['selected execution rejection identity', 'no primary mutation', 'secondary cleanup observed'], async host => {
    const shell = host.shell();
    const original = new host.api.ShellLimitError('maxCommands');
    const before = Reflect.ownKeys(original);
    const cleanupFailure = { tag: 'cleanup must lose' };
    let cleaned = 0;
    shell.register({ name: 'owned', execute(context) {
      register(context, () => { cleaned++; throw cleanupFailure; });
      throw original;
    } });
    await rejected(watch(shell.exec('owned')), original);
    assert.deepEqual(Reflect.ownKeys(original), before);
    assert.equal(cleaned, 1);
  });

define('H07', 'Caller primitive abort arriving during drain wins after delayed failure',
  ['caller identity over execution and cleanup', 'abort must not race drain', 'falsy reason'], async host => {
    const shell = host.shell();
    const controller = new AbortController();
    const started = gate();
    const release = gate();
    shell.register({ name: 'owned', execute(context) {
      register(context, async () => { started.release(); await release.promise; throw new Error('cleanup secondary'); });
      throw new host.api.ShellLimitError('maxCommands');
    } });
    const execution = watch(shell.exec('owned', { signal: controller.signal }));
    await started.promise;
    controller.abort('');
    await pending(execution, 'caller abort must not abandon cleanup');
    release.release();
    await rejected(execution, '');
  });

define('H08', 'Abort drains hooks without joining never-resolving handler or stdin',
  ['opaque handler/input not awaited', 'caller errno-shaped object identity', 'exec/dispose barrier'], async host => {
    const shell = host.shell();
    const entered = gate();
    const cleanupStarted = gate();
    const release = gate();
    const controller = new AbortController();
    const reason = { code: 'EPIPE', tag: 'caller, not internal downstream close' };
    let inputPulls = 0;
    let cleaned = 0;
    const input = { [Symbol.asyncIterator]() { return { next() { inputPulls++; return never(); }, return() { return never(); } }; } };
    shell.register({ name: 'owned', execute(context) {
      register(context, async () => { cleanupStarted.release(); await release.promise; cleaned++; });
      void context.stdin[Symbol.asyncIterator]().next().catch(() => {});
      entered.release();
      return never();
    } });
    const execution = watch(shell.exec('owned', { stdin: input, signal: controller.signal }));
    await entered.promise;
    await turn();
    assert.equal(inputPulls, 1);
    controller.abort(reason);
    const disposal = watch(shell.dispose());
    await cleanupStarted.promise;
    await pending(execution, 'abort exec barrier');
    await pending(disposal, 'dispose barrier');
    release.release();
    await rejected(execution, reason);
    await resolved(disposal);
    assert.equal(cleaned, 1);
  });

define('H09', 'Dispose seals admissions and shares drain across concurrent calls',
  ['dispose-before-opaque-handler completion', 'repeated dispose cannot return early', 'new exec closed'], async host => {
    const shell = host.shell();
    const entered = gate();
    const started = gate();
    const release = gate();
    let cleaned = 0;
    shell.register({ name: 'owned', execute(context) {
      register(context, async () => { started.release(); await release.promise; cleaned++; });
      entered.release();
      return never();
    } });
    const execution = watch(shell.exec('owned'));
    await entered.promise;
    const first = watch(shell.dispose());
    const second = watch(shell.dispose());
    const newExecution = watch(shell.exec('owned'));
    await newExecution.promise;
    assert.equal(newExecution.rejected, true);
    assert.ok(newExecution.reason instanceof Error);
    await started.promise;
    await pending(execution, 'existing exec cannot settle before its cleanup');
    await pending(first, 'first dispose barrier');
    await pending(second, 'second dispose barrier');
    release.release();
    await Promise.all([resolved(first), resolved(second), execution.promise]);
    assert.equal(cleaned, 1);
    host.event('dispose-triggered-exec-outcome-unspecified-by-contract', { rejected: execution.rejected, status: execution.value?.exitCode });
  });

for (const pipefail of [false, true]) define(pipefail ? 'H11' : 'H10', `Internal early pipe close with pipefail=${pipefail}`,
  ['internal abort not caller abort', 'opaque producer not joined', 'exact selected pipeline status/bytes'], async host => {
    const shell = host.shell();
    const started = gate();
    const release = gate();
    let producerCleaned = 0;
    let consumerCleaned = 0;
    shell.register({ name: 'producer', async execute(context) {
      register(context, async () => { started.release(); await release.promise; producerCleaned++; });
      await context.stdout.write(encoder.encode('row\n'));
      return never();
    } });
    shell.register({ name: 'consumer', async execute(context) {
      register(context, () => { consumerCleaned++; });
      const first = await context.stdin[Symbol.asyncIterator]().next();
      assert.equal(first.done, false);
      await context.stdout.write(first.value);
      return { exitCode: 0 };
    } });
    const execution = watch(shell.exec(`${pipefail ? 'set -o pipefail; ' : ''}producer | consumer`));
    await started.promise;
    await pending(execution, 'pipeline cannot outrun producer cleanup');
    release.release();
    result(await resolved(execution), pipefail ? 141 : 0, '726f770a');
    assert.equal(producerCleaned, 1);
    assert.equal(consumerCleaned, 1);
    await host.dispose(shell);
  });

define('H12', 'Parent return closes transitive admitted child scopes and late child work',
  ['parent-child linkage before call', 'all descendants drained', 'late invoke before iterator/acquisition'], async host => {
    const shell = host.shell();
    const leafEntered = gate();
    const allStarted = gate();
    const release = gate();
    const contexts = [];
    const childCalls = [];
    let starts = 0;
    let finishes = 0;
    let forbidden = 0;
    const own = context => {
      contexts.push(context);
      register(context, async () => { if (++starts === 3) allStarted.release(); await release.promise; finishes++; });
    };
    shell.register({ name: 'leaf', execute(context) { own(context); leafEntered.release(); return never(); } });
    shell.register({ name: 'middle', execute(context) { own(context); childCalls.push(watch(context.invoke('leaf', []))); return never(); } });
    shell.register({ name: 'outer', async execute(context) { own(context); childCalls.push(watch(context.invoke('middle', []))); await leafEntered.promise; return { exitCode: 0 }; } });
    shell.register({ name: 'forbidden', execute() { forbidden++; return { exitCode: 0 }; } });
    const execution = watch(shell.exec('outer'));
    await allStarted.promise;
    for (const context of contexts) {
      closedRegistration(context, () => { forbidden++; });
      const late = watch(context.invoke('forbidden', [], { stdin: { [Symbol.asyncIterator]() { forbidden++; return { next: () => never() }; } } }));
      await late.promise;
      assert.equal(late.rejected, true);
      assert.ok(late.reason instanceof Error);
    }
    assert.equal(forbidden, 0);
    await pending(execution, 'parent result cannot bypass descendants');
    release.release();
    result(await resolved(execution));
    assert.equal(finishes, 3);
    await Promise.all(childCalls.map(child => child.promise));
    await host.dispose(shell);
  });

for (const cancelled of [false, true]) define(cancelled ? 'H14' : 'H13', `Closed saved context rejects all admission, caller-cancelled=${cancelled}`,
  ['late registration sync', 'late invoke before iterator/middleware/FS', 'closed-scope exact caller reason'], async host => {
    const calls = { stat: 0, read: 0, write: 0, iterator: 0, middleware: 0, lateHook: 0 };
    class CountedMemory extends host.api.MemoryFileSystem {
      stat(...args) { calls.stat++; return super.stat(...args); }
      readFile(...args) { calls.read++; return super.readFile(...args); }
      writeFile(...args) { calls.write++; return super.writeFile(...args); }
    }
    const shell = host.shell({ fs: new CountedMemory() });
    const controller = new AbortController();
    const entered = gate();
    let saved;
    shell.use((context, next) => { calls.middleware++; return next(); });
    shell.register({ name: 'save', execute(context) { saved = context; register(context, () => {}); entered.release(); return cancelled ? never() : { exitCode: 0 }; } });
    const execution = watch(shell.exec('save', { signal: controller.signal }));
    await entered.promise;
    if (cancelled) { controller.abort(0); await rejected(execution, 0); }
    else result(await resolved(execution));
    const before = { ...calls };
    if (cancelled) closedRegistration(saved, () => { calls.lateHook++; }, 0);
    else closedRegistration(saved, () => { calls.lateHook++; });
    const late = watch(saved.invoke('/never-acquire', [], { stdin: { [Symbol.asyncIterator]() { calls.iterator++; return { next: () => never() }; } } }));
    await late.promise;
    assert.equal(late.rejected, true);
    if (cancelled) assert.equal(late.reason, 0);
    else assert.ok(late.reason instanceof Error);
    assert.deepEqual(calls, before);
    await host.dispose(shell);
  });

define('H15', 'Late losing handler rejection is observed without delaying caller abort',
  ['opaque handler not joined', 'late rejection handled', 'primary outcome immutable'], async host => {
    const shell = host.shell();
    const entered = gate();
    const handler = gate();
    const controller = new AbortController();
    const reason = Symbol('caller');
    let cleaned = 0;
    shell.register({ name: 'owned', execute(context) { register(context, () => { cleaned++; }); entered.release(); return handler.promise; } });
    const execution = watch(shell.exec('owned', { signal: controller.signal }));
    await entered.promise;
    controller.abort(reason);
    await rejected(execution, reason);
    assert.equal(cleaned, 1);
    handler.reject(new Error('late opaque handler failure'));
    await turn();
    await turn();
    await rejected(execution, reason);
    await host.dispose(shell);
  });

for (const separateShells of [false, true]) define(separateShells ? 'H17' : 'H16', `Shared resource leases isolated across ${separateShells ? 'Shell disposal' : 'concurrent exec abort'}`,
  ['local ownership only', 'no sibling cancel', 'do not await global resource zero'], async host => {
    const firstShell = host.shell();
    const secondShell = separateShells ? host.shell() : firstShell;
    const leases = new Set();
    const admitted = { first: gate(), second: gate() };
    const secondRelease = gate();
    const controller = new AbortController();
    const reason = { tag: 'first caller' };
    const cleaned = { first: 0, second: 0 };
    let secondSignal;
    const definition = { name: 'lease', async execute(context) {
      const name = context.args[0];
      let closed;
      register(context, () => closed ??= Promise.resolve().then(() => { cleaned[name]++; leases.delete(name); }));
      leases.add(name);
      if (name === 'second') secondSignal = context.signal;
      admitted[name].release();
      if (name === 'first') return never();
      await secondRelease.promise;
      await context.stdout.write(encoder.encode('B'));
      return { exitCode: 0 };
    } };
    firstShell.register(definition);
    if (separateShells) secondShell.register(definition);
    const first = watch(firstShell.exec('lease first', { signal: controller.signal }));
    const second = watch(secondShell.exec('lease second'));
    await Promise.all([admitted.first.promise, admitted.second.promise]);
    assert.equal(leases.size, 2);
    if (separateShells) { await host.dispose(firstShell); await first.promise; host.event('dispose-triggered-exec-outcome-unspecified-by-contract', { rejected: first.rejected, status: first.value?.exitCode }); }
    else { controller.abort(reason); await rejected(first, reason); }
    assert.deepEqual([...leases], ['second']);
    assert.equal(secondSignal.aborted, false);
    assert.equal(second.settled, false);
    assert.deepEqual(cleaned, { first: 1, second: 0 });
    secondRelease.release();
    result(await resolved(second), 0, '42');
    assert.equal(leases.size, 0);
    assert.deepEqual(cleaned, { first: 1, second: 1 });
    await host.dispose(secondShell);
  });

define('H18', 'Nested output and command budgets remain shared with cleanup',
  ['shared byte cap', 'shared command/source accounting', 'exact external byte effects'], async host => {
    const shell = host.shell();
    let acquired = 0;
    let cleaned = 0;
    shell.register({ name: 'inner', async execute(context) { register(context, () => { cleaned++; }); acquired++; await context.stdout.write(Uint8Array.from([0x41, 0, 0xff])); return { exitCode: 0 }; } });
    shell.register({ name: 'outer', async execute(context) { register(context, () => { cleaned++; }); acquired++; await context.invoke('inner', []); await context.stdout.write(Uint8Array.from([0x42])); return { exitCode: 0 }; } });
    result(await shell.exec('outer', { limits: { maxOutputBytes: 4 } }), 0, '4100ff42');
    assert.equal(acquired, cleaned);
    const sink = [];
    const limited = watch(shell.exec('outer', { limits: { maxOutputBytes: 3 }, stdout: { write: async bytes => { sink.push(Buffer.from(bytes)); } } }));
    await limited.promise;
    assert.equal(limited.rejected, true);
    assert.ok(limited.reason instanceof host.api.ShellLimitError);
    assert.equal(limited.reason.limit, 'maxOutputBytes');
    assert.equal(Buffer.concat(sink).toString('hex'), '4100ff');
    assert.equal(acquired, cleaned);
    const prior = acquired;
    const commands = watch(shell.exec('outer', { limits: { maxCommands: 1 } }));
    await commands.promise;
    assert.equal(commands.rejected, true);
    assert.ok(commands.reason instanceof host.api.ShellLimitError);
    assert.equal(commands.reason.limit, 'maxCommands');
    assert.equal(acquired, prior + 1);
    assert.equal(acquired, cleaned);
    const beforeSourceLimit = acquired;
    const sourceLimit = watch(shell.exec('outer', { limits: { maxSourceBytes: 4 } }));
    await sourceLimit.promise;
    assert.equal(sourceLimit.rejected, true);
    assert.ok(sourceLimit.reason instanceof host.api.ShellLimitError);
    assert.equal(sourceLimit.reason.limit, 'maxSourceBytes');
    assert.equal(acquired, beforeSourceLimit);
    await host.dispose(shell);
  });

define('H19', 'Nested replacement environment, stdin provenance and parent context survive',
  ['stdinIsDefault true/false', 'replaceEnv exact map', 'parent environment unchanged'], async host => {
    const shell = host.shell({ env: { TOKEN: 'parent' } });
    const origins = [];
    const childContexts = [];
    let cleaned = 0;
    shell.register({ name: 'leaf', async execute(context) {
      register(context, () => { cleaned++; });
      childContexts.push(context);
      origins.push(context.stdinIsDefault);
      assert.deepEqual({ ...context.env }, { TOKEN: 'child' });
      await context.stdout.write(encoder.encode(context.args[0]));
      return { exitCode: 0 };
    } });
    shell.register({ name: 'parent', async execute(context) {
      register(context, () => { cleaned++; });
      const original = { ...context.env };
      await context.invoke('leaf', ['1'], { replaceEnv: true, env: { TOKEN: 'child' } });
      closedRegistration(childContexts[0], () => { throw new Error('completed child reopened'); });
      await context.invoke('leaf', ['2'], { replaceEnv: true, env: { TOKEN: 'child' }, stdin: { async *[Symbol.asyncIterator]() {} } });
      closedRegistration(childContexts[1], () => { throw new Error('completed child reopened'); });
      assert.deepEqual({ ...context.env }, original);
      assert.equal(context.env.TOKEN, 'parent');
      await context.stdout.write(encoder.encode(context.env.TOKEN));
      return { exitCode: 0 };
    } });
    result(await shell.exec('parent'), 0, Buffer.from('12parent').toString('hex'));
    assert.deepEqual(origins, [true, false]);
    assert.equal(cleaned, 3);
    await host.dispose(shell);
  });

define('H20', 'Existing errexit and tested-list behavior survive scoped cleanup',
  ['errexit status', 'tested failure continues', 'cleanup before selected shell outcome'], async host => {
    const shell = host.shell();
    const cleaned = { bad: 0, after: 0 };
    let after = 0;
    shell.register({ name: 'bad', execute(context) { register(context, () => { cleaned.bad++; }); return { exitCode: 7 }; } });
    shell.register({ name: 'after', async execute(context) { register(context, () => { cleaned.after++; }); after++; await context.stdout.write(encoder.encode('after\n')); return { exitCode: 0 }; } });
    result(await shell.exec('set -e; bad; after'), 7);
    assert.equal(after, 0);
    assert.deepEqual(cleaned, { bad: 1, after: 0 });
    result(await shell.exec('set -e; bad || after'), 0, '61667465720a');
    assert.equal(after, 1);
    assert.deepEqual(cleaned, { bad: 2, after: 1 });
    await host.dispose(shell);
  });

define('H21', 'A direct custom host can omit the optional capability and retain finally',
  ['optional host structural compatibility', 'no fake Shell barrier claim'], async host => {
    let acquired = 0;
    let closed;
    const cleanup = () => closed ??= Promise.resolve().then(() => { acquired--; });
    const execute = async context => {
      context.registerCleanup?.(cleanup);
      acquired++;
      try { return { exitCode: 0 }; } finally { await cleanup(); }
    };
    const context = { command: 'direct', args: [], stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} }, cwd: '/', env: {}, fs: new host.api.MemoryFileSystem(), signal: new AbortController().signal };
    assert.equal('registerCleanup' in context, false);
    assert.deepEqual(await execute(context), { exitCode: 0 });
    assert.equal(acquired, 0);
  });

define('H22', 'Acquisition owner closes before queued continuation resumes',
  ['registered owner blocks admitted-late resource creation', 'closed late admission', 'no arbitrary handler join'], async host => {
    const shell = host.shell();
    const admitted = gate();
    const queued = gate();
    const continued = gate();
    const controller = new AbortController();
    const reason = new Error('queued acquisition caller');
    let ownerClosed = false;
    let acquisitions = 0;
    let lateFailure;
    let cleanupCalls = 0;
    shell.register({ name: 'owned', async execute(context) {
      register(context, () => { cleanupCalls++; ownerClosed = true; });
      admitted.release();
      await queued.promise;
      if (!ownerClosed) acquisitions++;
      try { context.registerCleanup(() => { acquisitions++; }); } catch (error) { lateFailure = error; }
      continued.release();
      return { exitCode: 0 };
    } });
    const execution = watch(shell.exec('owned', { signal: controller.signal }));
    await admitted.promise;
    controller.abort(reason);
    await rejected(execution, reason);
    assert.equal(ownerClosed, true);
    queued.release();
    await continued.promise;
    assert.equal(acquisitions, 0);
    assert.equal(lateFailure, reason);
    assert.equal(cleanupCalls, 1);
    await host.dispose(shell);
  });
