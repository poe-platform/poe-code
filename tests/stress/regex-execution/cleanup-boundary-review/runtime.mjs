import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const api = await import(pathToFileURL(resolve(process.argv[2], 'dist/index.js')));
const gates = [];
const shells = [];
const tasks = [];
const observations = [];
const tick = () => new Promise(resolveTick => setImmediate(resolveTick));
function deferred() {
  let release;
  const promise = new Promise(resolvePromise => { release = resolvePromise; });
  const gate = { promise, release };
  gates.push(gate);
  return gate;
}
const settle = promise => Promise.resolve(promise).then(value => ({ resolved: true, value }), error => ({ resolved: false, error }));
const track = promise => { const task = settle(promise); tasks.push(task); return task; };
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((unused, reject) => { timer = setTimeout(() => reject(new Error('bounded runtime observation timeout')), 1200); })]); }
  finally { clearTimeout(timer); }
}
function shell() {
  const instance = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
  shells.push(instance);
  return instance;
}
async function stillPending(promise) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await tick();
  assert.equal(settled, false, 'public boundary must await cooperative cleanup');
}
async function check(name, operation) {
  const shellStart = shells.length;
  const taskStart = tasks.length;
  const observation = { name, pass: false };
  try { observation.details = await operation(); observation.pass = true; }
  catch (error) { observation.error = error.stack; }
  finally {
    for (const gate of gates) gate.release();
    try {
      await within(Promise.all(shells.slice(shellStart).map(instance => settle(instance.dispose()))));
      await within(Promise.all(tasks.slice(taskStart)));
    } catch (error) { observation.pass = false; observation.cleanupError = error.stack; }
    observations.push(observation);
  }
}

await check('public:drain-all-sync-async-duplicates-cleanup-errors', async () => {
  const variants = [];
  for (const errors of [0, 1, 2]) {
    const instance = shell();
    const gate = deferred();
    const started = deferred();
    const failures = [new Error('cleanup first'), { source: 'cleanup second' }];
    const calls = [];
    const duplicate = () => { calls.push('duplicate'); };
    instance.register({ name: 'owned', execute(context) {
      assert.throws(() => context.registerCleanup(4), TypeError);
      context.registerCleanup(() => { calls.push('first'); if (errors) throw failures[0]; });
      context.registerCleanup(async () => { calls.push('pending'); started.release(); await gate.promise; if (errors === 2) throw failures[1]; });
      context.registerCleanup(duplicate);
      context.registerCleanup(duplicate);
      return { exitCode: 23 };
    } });
    const running = track(instance.exec('owned'));
    await within(started.promise);
    await tick();
    assert.deepEqual(calls.sort(), ['duplicate', 'duplicate', 'first', 'pending']);
    await stillPending(running);
    gate.release();
    const result = await within(running);
    if (errors === 0) assert.equal(result.value?.exitCode, 23);
    else if (errors === 1) assert.equal(result.error, failures[0]);
    else { assert.ok(result.error instanceof AggregateError); assert.deepEqual(new Set(result.error.errors), new Set(failures)); }
    variants.push({ errors, calls: calls.length });
  }
  return { variants };
});
await check('public:primary-error-and-abort-during-drain-identities', async () => {
  const variants = [];
  for (const caller of ['none', 0, false, '', { code: 'ENOENT' }]) {
    const instance = shell();
    const controller = new AbortController();
    const primary = new Error('selected execution failure');
    const gate = deferred();
    const started = deferred();
    let cleanups = 0;
    instance.register({ name: 'owned', execute(context) {
      context.registerCleanup(async () => { cleanups++; started.release(); await gate.promise; throw new Error('secondary cleanup failure'); });
      context.registerCleanup(() => { cleanups++; throw new Error('other secondary cleanup failure'); });
      throw primary;
    } });
    const running = track(instance.exec('owned', { signal: controller.signal }));
    await within(started.promise);
    if (caller !== 'none') controller.abort(caller);
    await stillPending(running);
    gate.release();
    const result = await within(running);
    assert.equal(result.resolved, false);
    assert.equal(result.error, caller === 'none' ? primary : caller);
    assert.equal(cleanups, 2);
    assert.deepEqual(Object.keys(primary), []);
    variants.push(caller);
  }
  return { variants };
});
await check('public:nested-abort-late-admission-before-child-work', async () => {
  const instance = shell();
  const controller = new AbortController();
  const reason = { code: 'EIO', caller: true };
  const childStarted = deferred();
  const cleanupStarted = deferred();
  const retirement = deferred();
  const host = deferred();
  const contexts = [];
  let forbidden = 0;
  let cleaned = 0;
  instance.use(async (context, next) => { if (context.command === 'forbidden') forbidden++; return next(); });
  instance.register({ name: 'forbidden', execute() { forbidden++; return { exitCode: 0 }; } });
  instance.register({ name: 'inner', async execute(context) {
    contexts.push(context);
    context.registerCleanup(async () => { cleaned++; cleanupStarted.release(); await retirement.promise; });
    childStarted.release();
    await host.promise;
    throw new Error('late losing handler rejection');
  } });
  instance.register({ name: 'outer', async execute(context) {
    contexts.push(context);
    context.registerCleanup(() => { cleaned++; });
    return context.invoke('inner', []);
  } });
  const running = track(instance.exec('outer', { signal: controller.signal }));
  await within(childStarted.promise);
  controller.abort(reason);
  await within(cleanupStarted.promise);
  for (const context of contexts) {
    assert.throws(() => context.registerCleanup(() => {}), error => error === reason);
    const nested = await within(settle(context.invoke('forbidden', [])));
    assert.equal(nested.error, reason);
  }
  assert.equal(forbidden, 0);
  await stillPending(running);
  retirement.release();
  assert.equal((await within(running)).error, reason);
  assert.equal(cleaned, 2);
  host.release();
  await tick();
});
await check('public:pipeline-and-substitution-own-descendant-drains', async () => {
  const variants = [];
  for (const command of ['leaf | cat', 'printf "%s" "$(leaf)"', 'outer']) {
    const instance = shell();
    const gate = deferred();
    const started = deferred();
    let cleaned = 0;
    let captured;
    instance.register({ name: 'leaf', async execute(context) {
      captured = context;
      context.registerCleanup(async () => { cleaned++; started.release(); await gate.promise; });
      await context.stdout.write(Buffer.from('ab\n'));
      return { exitCode: 0 };
    } });
    instance.register({ name: 'outer', execute(context) { return context.invoke('leaf', []); } });
    const running = track(instance.exec(command));
    await within(started.promise);
    await stillPending(running);
    assert.throws(() => captured.registerCleanup(() => {}), Error);
    gate.release();
    const result = await within(running);
    assert.equal(result.value?.exitCode, 0);
    assert.equal(result.value.stdout, command.includes('$(') ? 'ab' : 'ab\n');
    assert.equal(result.value.stderr, '');
    assert.equal(cleaned, 1);
    variants.push(command);
  }
  return { variants };
});
await check('public:overlapping-and-repeated-dispose-await-drain', async () => {
  const instance = shell();
  const retirement = deferred();
  const started = deferred();
  let cleaned = 0;
  instance.register({ name: 'owned', execute(context) {
    context.registerCleanup(async () => { cleaned++; started.release(); await retirement.promise; });
    return { exitCode: 0 };
  } });
  const running = track(instance.exec('owned'));
  await within(started.promise);
  const first = track(instance.dispose());
  const second = track(instance.dispose());
  await stillPending(first);
  await stillPending(second);
  retirement.release();
  await within(Promise.all([first, second, running]));
  await instance.dispose();
  assert.equal(cleaned, 1);
  assert.equal((await settle(instance.exec('true'))).resolved, false);
});
await check('public:same-shell-and-other-shell-cancellation-isolation', async () => {
  const instance = shell();
  const other = shell();
  const controller = new AbortController();
  const started = deferred();
  const host = deferred();
  let cleaned = 0;
  instance.register({ name: 'owned', async execute(context) {
    context.registerCleanup(() => { cleaned++; });
    started.release();
    await host.promise;
    return { exitCode: 0 };
  } });
  const running = track(instance.exec('owned', { signal: controller.signal }));
  await within(started.promise);
  const sibling = track(instance.exec("rg '^a'", { stdin: 'ab\n' }));
  const remote = track(other.exec("grep -E '^a'", { stdin: 'ab\n' }));
  const reason = new Error('only one invocation');
  controller.abort(reason);
  assert.equal((await within(running)).error, reason);
  for (const task of [sibling, remote]) {
    const result = await within(task);
    assert.equal(result.value?.exitCode, 0);
    assert.equal(result.value.stdout, 'ab\n');
  }
  assert.equal(cleaned, 1);
  host.release();
});
await check('public:abort-avoids-opaque-input-fs-sink-middleware', async () => {
  const variants = [];
  for (const opaque of ['stdin', 'fs', 'sink', 'middleware']) {
    const instance = shell();
    const controller = new AbortController();
    const entered = deferred();
    const host = deferred();
    let cleaned = 0;
    instance.register({ name: 'owned', async execute(context) {
      context.registerCleanup(() => { cleaned++; });
      entered.release();
      if (opaque === 'stdin') await context.stdin[Symbol.asyncIterator]().next();
      if (opaque === 'fs') await context.fs.readFile('/held');
      if (opaque === 'sink') await context.stdout.write(Buffer.from('ab\n'));
      return { exitCode: 0 };
    } });
    if (opaque === 'middleware') instance.use(async (context, next) => { context.registerCleanup(() => { cleaned++; }); entered.release(); await host.promise; return next(); });
    const fs = new api.MemoryFileSystem();
    fs.readFile = () => host.promise.then(() => Buffer.from('ab\n'));
    const stdin = { async *[Symbol.asyncIterator]() { await host.promise; yield Buffer.from('ab\n'); } };
    const stdout = { async write() { await host.promise; } };
    const running = track(instance.exec('owned', { fs, stdin, stdout, signal: controller.signal }));
    await within(entered.promise);
    controller.abort(opaque);
    assert.equal((await within(running)).error, opaque);
    assert.equal(cleaned, 1);
    host.release();
    await tick();
    variants.push(opaque);
  }
  return { variants };
});
await check('public:admitted-cooperative-acquisition-closes-permanently', async () => {
  const instance = shell();
  const controller = new AbortController();
  const entered = deferred();
  const acquisition = deferred();
  const host = deferred();
  let admission = true;
  let releases = 0;
  let cleanup;
  let captured;
  instance.register({ name: 'owned', async execute(context) {
    captured = context;
    let acquired;
    context.registerCleanup(() => {
      admission = false;
      cleanup ??= Promise.resolve().then(() => acquired).then(resource => { resource.release(); });
      return cleanup;
    });
    acquired = acquisition.promise.then(() => ({ release() { releases++; } }));
    entered.release();
    await host.promise;
    if (admission) throw new Error('late acquisition reopened');
    return { exitCode: 0 };
  } });
  const running = track(instance.exec('owned', { signal: controller.signal }));
  await within(entered.promise);
  controller.abort('close while acquiring');
  await tick();
  assert.equal(admission, false);
  await stillPending(running);
  acquisition.release();
  assert.equal((await within(running)).error, 'close while acquiring');
  assert.equal(releases, 1);
  assert.throws(() => captured.registerCleanup(() => {}), error => error === 'close while acquiring');
  host.release();
  await tick();
  assert.equal(releases, 1);
});

process.send({ kind: 'result', pass: observations.every(observation => observation.pass), counts: { controls: observations.length, passed: observations.filter(observation => observation.pass).length, failed: observations.filter(observation => !observation.pass).length }, observations, riskConsumed: 0, boundary: 'actual frozen Shell.exec, nested CommandContext.invoke and Shell.dispose' }, () => process.disconnect());
