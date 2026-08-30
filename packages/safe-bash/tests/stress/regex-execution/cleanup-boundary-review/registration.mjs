import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const snapshot = process.argv[2];
const tick = () => new Promise(resolveTick => setImmediate(resolveTick));
const gates = [];
function deferred() {
  let release;
  const promise = new Promise(resolvePromise => { release = resolvePromise; });
  const gate = { promise, release };
  gates.push(gate);
  return gate;
}
async function within(promise, milliseconds = 750) {
  let timer;
  try { return await Promise.race([promise, new Promise((unused, reject) => { timer = setTimeout(() => reject(new Error('bounded observation timeout')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const settle = promise => Promise.resolve(promise).then(value => ({ value }), error => ({ error }));
const workers = [];
const executors = [];
const tasks = [];
let behavior = {};
let acquisitionEvents = [];
class ControlledWorker extends EventEmitter {
  constructor(url, options) {
    super();
    acquisitionEvents.push('construct');
    behavior.construct?.();
    this.url = String(url);
    this.options = options;
    this.posts = [];
    this.terminationCalls = 0;
    this.exited = false;
    workers.push(this);
    queueMicrotask(() => this.emit('message', { ready: true }));
  }
  ref() { return this; }
  unref() { return this; }
  postMessage(message) {
    this.posts.push(message);
    if (behavior.post) behavior.post(this, message);
    else queueMicrotask(() => this.reply(message));
  }
  reply(message = this.posts.at(-1)) {
    this.emit('message', { id: message.id, results: message.rows.map(row => row.bytes.length ? new Float64Array([0, 1]) : new Float64Array()) });
  }
  async terminate() {
    this.terminationCalls++;
    behavior.retiring?.(this);
    if (behavior.retirement) await behavior.retirement.promise;
    this.exited = true;
    this.emit('exit', 1);
    return 1;
  }
}
workerThreads.Worker = ControlledWorker;
syncBuiltinESMExports();
const load = path => import(pathToFileURL(resolve(snapshot, 'dist', path)));
const { RegexExecutor } = await load('commands/regex-execution/client.js');
const { grepCommands } = await load('commands/grep.js');
const { rgCommand } = await load('commands/search/rg.js');
const { MemoryFileSystem } = await load('fs/memory/index.js');
const originalOpen = RegexExecutor.prototype.open;
RegexExecutor.prototype.open = function (...args) {
  acquisitionEvents.push('open');
  if (!executors.includes(this)) executors.push(this);
  return originalOpen.apply(this, args);
};
const descriptor = { kind: 'grep', patterns: ['a'], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const rows = [{ bytes: Uint8Array.of(97), all: false, terminated: true }];
const observations = [];
const makeExecutor = options => { const executor = new RegexExecutor(options); executors.push(executor); return executor; };
function contextFor(family, changes = {}) {
  const callbacks = [];
  const controller = new AbortController();
  const bytes = { stdout: '', stderr: '' };
  const context = {
    command: family, args: family === 'grep' ? ['-E', '^a'] : ['^a'],
    stdin: { async *[Symbol.asyncIterator]() { yield Buffer.from('ab\n'); } },
    stdinIsDefault: false, cwd: '/', env: {}, fs: new MemoryFileSystem(), signal: controller.signal,
    stdout: { async write(chunk) { bytes.stdout += Buffer.from(chunk); } },
    stderr: { async write(chunk) { bytes.stderr += Buffer.from(chunk); } },
    registerCleanup(callback) { acquisitionEvents.push('register'); callbacks.push(callback); },
    ...changes,
  };
  const command = family === 'grep' ? grepCommands()[0] : rgCommand();
  return { context, command, callbacks, controller, bytes };
}
const start = fixture => { const task = settle(fixture.command.execute(fixture.context)); tasks.push(task); return task; };
async function pendingUntilReleased(promise, gate) {
  let done = false;
  const observed = settle(promise).then(result => { done = true; return result; });
  await tick();
  assert.equal(done, false, 'overlapping cleanup cannot return before retirement');
  gate.release();
  return within(observed);
}
async function check(name, operation) {
  const firstWorker = workers.length;
  const firstExecutor = executors.length;
  const firstTask = tasks.length;
  behavior = {};
  acquisitionEvents = [];
  const observation = { name, pass: false };
  try { observation.details = await operation(); observation.pass = true; }
  catch (error) { observation.error = error.stack; }
  finally {
    for (const gate of gates) gate.release();
    try {
      await within(Promise.all(executors.slice(firstExecutor).map(executor => executor.dispose())));
      await within(Promise.all(tasks.slice(firstTask)));
      await tick();
      for (const worker of workers.slice(firstWorker)) {
        assert.equal(worker.exited, true);
        assert.equal(worker.terminationCalls, 1);
        for (const event of ['message', 'messageerror', 'error', 'exit']) assert.equal(worker.listenerCount(event), 0, event);
      }
    } catch (error) { observation.pass = false; observation.cleanupError = error.stack; }
    observation.events = acquisitionEvents;
    observation.workers = workers.slice(firstWorker).map(worker => ({ posts: worker.posts.length, terminationCalls: worker.terminationCalls, exited: worker.exited }));
    observations.push(observation);
  }
}

for (const family of ['grep', 'rg']) {
  await check(`${family}:registrar-rejection-before-open`, async () => {
    const rejection = new Error('independent closed registrar');
    const fixture = contextFor(family, { registerCleanup() { acquisitionEvents.push('reject-registration'); throw rejection; } });
    const result = await within(start(fixture));
    assert.equal(result.error, rejection);
    assert.deepEqual(acquisitionEvents, ['reject-registration']);
    assert.equal(fixture.bytes.stdout, '');
  });
  await check(`${family}:preabort-before-registration-acquisition`, async () => {
    const fixture = contextFor(family);
    const reason = { code: 'ENOENT', source: 'caller' };
    fixture.controller.abort(reason);
    assert.equal((await within(start(fixture))).error, reason);
    assert.deepEqual(acquisitionEvents, []);
  });
  await check(`${family}:close-during-registration-denies-later-acquisition`, async () => {
    let closing;
    const fixture = contextFor(family, { registerCleanup(callback) { acquisitionEvents.push('register'); closing = callback(); } });
    const result = await within(start(fixture));
    await within(closing);
    assert.ok(result.error, 'closed owner cannot execute');
    assert.deepEqual(acquisitionEvents, ['register']);
    assert.equal(fixture.bytes.stdout, '');
  });
  await check(`${family}:finally-duplicate-concurrent-reentrant-close`, async () => {
    const retirement = deferred();
    const retiring = deferred();
    const reentrant = [];
    const fixture = contextFor(family);
    behavior.retirement = retirement;
    behavior.retiring = () => { if (fixture.callbacks[0]) reentrant.push(settle(fixture.callbacks[0]())); retiring.release(); };
    const running = start(fixture);
    await within(retiring.promise);
    assert.equal(fixture.callbacks.length, 1);
    assert.equal(acquisitionEvents[0], 'register');
    assert.equal(acquisitionEvents[1], 'open');
    const duplicate = Promise.all([fixture.callbacks[0](), fixture.callbacks[0](), ...reentrant]);
    const observed = await pendingUntilReleased(duplicate, retirement);
    assert.equal(observed.error, undefined);
    const result = await within(running);
    assert.equal(result.value?.exitCode, 0);
    assert.equal(fixture.bytes.stdout, 'ab\n');
    assert.equal(fixture.bytes.stderr, '');
    await fixture.callbacks[0]();
    assert.equal(getEventListeners(fixture.context.signal, 'abort').length, 0);
  });
  await check(`${family}:cleanup-does-not-wait-opaque-input-fs-sink`, async () => {
    const variants = [];
    for (const opaque of ['stdin', 'fs', 'sink']) {
      const entered = deferred();
      const host = deferred();
      const fixture = contextFor(family);
      if (opaque === 'stdin') fixture.context.stdin = { async *[Symbol.asyncIterator]() { entered.release(); await host.promise; yield Buffer.from('ab\n'); } };
      if (opaque === 'fs') {
        fixture.context.args = family === 'grep' ? ['-E', '^a', '/held'] : ['^a', '/held'];
        await fixture.context.fs.writeFile('/held', Buffer.from('ab\n'));
        const original = fixture.context.fs.readFile.bind(fixture.context.fs);
        fixture.context.fs.readFile = async (...args) => { entered.release(); await host.promise; return original(...args); };
        const originalStream = fixture.context.fs.readStream.bind(fixture.context.fs);
        fixture.context.fs.readStream = async function* (...args) { entered.release(); await host.promise; yield* originalStream(...args); };
      }
      if (opaque === 'sink') fixture.context.stdout = { async write() { entered.release(); await host.promise; } };
      let handlerSettled = false;
      const running = start(fixture).then(result => { handlerSettled = true; return result; });
      await within(entered.promise);
      assert.equal(fixture.callbacks.length, 1);
      await within(fixture.callbacks[0]());
      assert.equal(handlerSettled, false, 'cleanup is independent of opaque host work');
      assert.equal(workers.filter(worker => !worker.exited).length, 0);
      fixture.controller.abort('release opaque continuation');
      host.release();
      assert.equal((await within(running)).error, 'release opaque continuation');
      variants.push(opaque);
    }
    return { variants };
  });
  await check(`${family}:constructor-error-versus-caller-abort`, async () => {
    const variants = [];
    for (const abort of [false, true]) {
      const fixture = contextFor(family);
      const error = new Error('independent constructor failure');
      const reason = { code: 'EIO', identity: 'caller wins' };
      behavior.construct = () => { if (abort) fixture.controller.abort(reason); throw error; };
      const result = await within(start(fixture));
      assert.equal(fixture.callbacks.length, 1);
      await fixture.callbacks[0]();
      if (abort) assert.equal(result.error, reason);
      else {
        assert.equal(result.value?.exitCode, 2);
        assert.equal(fixture.bytes.stdout, '');
        assert.match(fixture.bytes.stderr, /independent constructor failure/u);
      }
      variants.push(abort ? 'exact abort' : 'utility diagnostic');
    }
    return { variants };
  });
}

await check('session:active-close-cancels-and-shares-retirement', async () => {
  behavior.post = () => {};
  const retirement = deferred();
  behavior.retirement = retirement;
  const executor = makeExecutor();
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  const request = settle(session.run(descriptor, rows));
  tasks.push(request);
  await tick();
  const first = session.close();
  const second = session.close();
  assert.equal(first, second, 'same session close completion');
  assert.throws(() => session.run(descriptor, rows), error => error.code === 'CLOSED');
  await pendingUntilReleased(Promise.all([first, second]), retirement);
  assert.ok((await within(request)).error);
  assert.equal(controller.signal.aborted, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
await check('session:queued-close-does-not-cancel-active-sibling', async () => {
  behavior.post = () => {};
  const executor = makeExecutor({ maxWorkers: 1 });
  const controller = new AbortController();
  const active = executor.open(controller.signal);
  const queued = executor.open(controller.signal);
  const activeRequest = settle(active.run(descriptor, rows));
  const queuedRequest = settle(queued.run(descriptor, rows));
  tasks.push(activeRequest, queuedRequest);
  await tick();
  const worker = workers.at(-1);
  await within(queued.close());
  assert.ok((await within(queuedRequest)).error);
  assert.equal(worker.terminationCalls, 0);
  assert.equal(worker.posts.length, 1);
  worker.reply();
  assert.ok((await within(activeRequest)).value);
  await active.close();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
await check('session:active-close-leaves-other-lease-live', async () => {
  behavior.post = () => {};
  const executor = makeExecutor({ maxWorkers: 2 });
  const controller = new AbortController();
  const first = executor.open(controller.signal);
  const second = executor.open(controller.signal);
  const firstRequest = settle(first.run(descriptor, rows));
  const secondRequest = settle(second.run(descriptor, rows));
  tasks.push(firstRequest, secondRequest);
  await tick();
  const survivor = workers.at(-1);
  await within(first.close());
  assert.ok((await within(firstRequest)).error);
  assert.equal(survivor.exited, false);
  assert.equal(survivor.terminationCalls, 0);
  survivor.reply();
  assert.ok((await within(secondRequest)).value);
  await second.close();
});
await check('executor:concurrent-dispose-shares-inflight-retirement', async () => {
  behavior.post = () => {};
  const retirement = deferred();
  behavior.retirement = retirement;
  const executor = makeExecutor();
  const session = executor.open(new AbortController().signal);
  const request = settle(session.run(descriptor, rows));
  tasks.push(request);
  await tick();
  const first = executor.dispose();
  const second = executor.dispose();
  await pendingUntilReleased(Promise.all([first, second]), retirement);
  assert.ok((await within(request)).error);
  await session.close();
  assert.throws(() => executor.open(new AbortController().signal), error => error.code === 'CLOSED');
});
await check('session:worker-error-and-prior-falsy-caller-reason', async () => {
  const variants = [];
  for (const reason of [undefined, 0, false, '']) {
    behavior.post = () => {};
    const retirement = deferred();
    behavior.retirement = retirement;
    const executor = makeExecutor();
    const controller = new AbortController();
    const session = executor.open(controller.signal);
    const request = settle(session.run(descriptor, rows));
    tasks.push(request);
    await tick();
    if (reason !== undefined) controller.abort(reason);
    workers.at(-1).emit('error', new Error('independent worker fault'));
    await tick();
    retirement.release();
    const result = await within(request);
    if (reason === undefined) assert.equal(result.error?.code, 'WORKER_ERROR');
    else assert.equal(result.error, reason);
    await session.close();
    variants.push({ reason: reason ?? 'no caller abort', code: result.error?.code });
  }
  return { variants };
});

const result = { kind: 'result', pass: observations.every(observation => observation.pass), counts: { controls: observations.length, passed: observations.filter(observation => observation.pass).length, failed: observations.filter(observation => !observation.pass).length, workers: workers.length, active: workers.filter(worker => !worker.exited).length }, observations, riskConsumed: 0, transport: 'checked-in benign ControlledWorker; no native worker or regex evaluation' };
process.send(result, () => process.disconnect());
