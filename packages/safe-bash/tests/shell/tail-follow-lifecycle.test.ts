import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { getEventListeners } from "node:events";
import { standardCommands } from "../../src/commands/index.js";
import { browserCommands } from "../../src/browser.js";
import { setup } from "./helpers.js";
import { tailFollowScheduler } from "../../src/commands/tail-follow.js";
import { FsError, type ByteSource, type FileSystem } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/types.js";

const encode = (text: string) => new TextEncoder().encode(text);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 64 && !predicate(); turn++) await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(predicate(), true, "bounded Shell capability checkpoint not reached");
}

class Clock {
  time = 0;
  sequence = 0;
  readonly timers = new Map<number, { due: number; callback: () => void }>();
  constructor(context: TestContext) {
    context.mock.method(tailFollowScheduler, "now", () => this.time);
    context.mock.method(tailFollowScheduler, "setTimeout", (callback: () => void, milliseconds: number) => {
      const handle = ++this.sequence;
      this.timers.set(handle, { due: this.time + milliseconds, callback });
      return handle;
    });
    context.mock.method(tailFollowScheduler, "clearTimeout", (handle: number) => { this.timers.delete(handle); });
  }
  advance(milliseconds: number): void {
    this.time += milliseconds;
    for (const [handle, timer] of [...this.timers]) if (timer.due <= this.time) {
      this.timers.delete(handle);
      timer.callback();
    }
  }
}

function composition(fs: FileSystem, open: NonNullable<FileSystem["openReadFile"]>): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (key === "openReadFile") return open;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function fixture() {
  const result = setup();
  result.shell.use(standardCommands());
  return result;
}

for (const browser of [false, true]) test(`actual ${browser ? "browser" : "standard"} tail follow uses retained memory and initial-only output`, async () => {
  const { shell, fs } = setup();
  shell.use(browser ? browserCommands({ maxTailFollowHandles: 2 }) : standardCommands({ maxTailFollowHandles: 2 }));
  await fs.writeFile("/log", new TextEncoder().encode("first\nlast\n"));
  try {
    const result = await shell.exec("tail -F --max-idle=0 -n1 /log");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "last\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("Shell retains the original shared CPU checkpoint through follow reads", async context => {
  const clock = new Clock(context);
  const { shell, fs, commands } = fixture();
  let now = 0;
  context.mock.method(performance, "now", () => now);
  commands.register({ name: "spend", execute() { now += 3; return { exitCode: 0 }; } });
  await fs.writeFile("/log", encode(""));
  let reads = 0;
  let closed = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { stat: options => handle.stat(options), async read(...input) { reads++; now += 3; return handle.read(...input); }, async close() { closed++; await handle.close(); } };
  });
  const controller = new AbortController();
  const running = shell.exec("spend; tail -f -n0 /log", { fs: bound, signal: controller.signal, limits: { maxCpuMs: 5 } });
  let settled = false;
  void running.then(() => { settled = true; }, () => { settled = true; });
  const observed = assert.rejects(running, error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
  try {
    await until(() => clock.timers.size > 0);
    await fs.appendFile("/log", new Uint8Array(131073));
    clock.advance(100);
    await until(() => settled || clock.timers.size > 0);
    assert.equal(settled, true, `CPU budget did not stop follow: ${reads} reads, clock ${now}`);
    await observed;
    assert.equal(reads, 1);
    assert.equal(closed, 1);
    assert.equal(clock.timers.size, 0);
  } finally { controller.abort(); await running.catch(() => {}); await observed.catch(() => {}); await shell.dispose(); }
});

test("Shell wall-clock cancellation drains held close without an idle timeout", async context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const clock = new Clock(context);
  const { shell, fs } = fixture();
  await fs.writeFile("/log", encode(""));
  const release = deferred();
  let closing = false;
  let settled = false;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { stat: options => handle.stat(options), read: (...input) => handle.read(...input), async close() { closing = true; await release.promise; await handle.close(); } };
  });
  const running = shell.exec("tail -f /log", { fs: bound, limits: { maxWallClockMs: 50 } });
  void running.then(() => { settled = true; }, () => { settled = true; });
  const observed = assert.rejects(running, error => error instanceof ShellLimitError && error.limit === "maxWallClockMs");
  try {
    await until(() => clock.timers.size > 0 || settled);
    context.mock.timers.tick(50);
    await until(() => closing || settled);
    assert.equal(closing, true);
    assert.equal(settled, false);
    assert.equal(clock.timers.size, 0);
    release.resolve();
    await observed;
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("Shell consumed stdin EOF retires only stdin, not named follow", async context => {
  const clock = new Clock(context);
  const { shell, fs } = fixture();
  await fs.writeFile("/log", encode("file\n"));
  const chunks: Uint8Array[] = [];
  let settled = false;
  const running = shell.exec("tail -q -f -n1 --max-idle=.2 - /log", { stdin: "first\nlast\n", stdout: { async write(chunk) { chunks.push(chunk.slice()); } } });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => clock.timers.size > 0 || settled);
    assert.equal(settled, false);
    assert.equal(Buffer.concat(chunks).toString(), "last\nfile\n");
    await fs.appendFile("/log", encode("appended\n"));
    clock.advance(100);
    await until(() => Buffer.concat(chunks).toString().endsWith("appended\n") && clock.timers.size > 0 || settled);
    assert.equal(settled, false);
    clock.advance(200);
    await running;
    assert.equal(Buffer.concat(chunks).toString(), "last\nfile\nappended\n");
    assert.equal(clock.timers.size, 0);
  } finally { await shell.dispose(); }
});

test("Shell implicit default stdin does not terminate named follow", async context => {
  const clock = new Clock(context);
  const { shell, fs } = fixture();
  await fs.writeFile("/log", encode(""));
  const controller = new AbortController();
  const chunks: Uint8Array[] = [];
  const running = shell.exec("tail -f -n0 /log", { signal: controller.signal, stdout: { async write(chunk) { chunks.push(chunk.slice()); } } });
  const observed = assert.rejects(running, error => error === controller.signal.reason);
  try {
    await until(() => clock.timers.size > 0);
    await fs.appendFile("/log", encode("appended\n"));
    clock.advance(100);
    await until(() => chunks.length > 0);
    assert.equal(Buffer.concat(chunks).toString(), "appended\n");
    controller.abort(false);
    await observed;
  } finally { controller.abort(false); await running.catch(() => {}); await shell.dispose(); }
});

test("Shell output backpressure holds follow progress and raw-byte ownership", async context => {
  const clock = new Clock(context);
  const { shell, fs } = fixture();
  await fs.writeFile("/log", Uint8Array.of(0, 255, 128));
  const release = deferred();
  let writing = false;
  let settled = false;
  const chunks: Uint8Array[] = [];
  const running = shell.exec("tail -f -c3 --max-idle=.1 /log", { stdout: { async write(chunk) { writing = true; await release.promise; chunks.push(chunk.slice()); } } });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => writing || settled);
    clock.advance(10000);
    assert.equal(settled, false);
    assert.equal(clock.timers.size, 0);
    await fs.writeFile("/log", Uint8Array.of(1, 2, 3));
    release.resolve();
    await until(() => clock.timers.size > 0 || settled);
    assert.deepEqual(chunks, [Uint8Array.of(0, 255, 128)]);
    clock.advance(100);
    assert.equal((await running).exitCode, 0);
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("Shell pipe consumer closure cancels owned follow output and joins its handle", async context => {
  const clock = new Clock(context);
  const { shell, fs } = fixture();
  await fs.writeFile("/log", new Uint8Array(131073).fill(65));
  let closed = 0;
  let reads = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { stat: options => handle.stat(options), async read(...input) { reads++; return handle.read(...input); }, async close() { closed++; await handle.close(); } };
  });
  try {
    const result = await shell.exec("tail -f -c +1 /log | head -c1", { fs: bound, limits: { pipeHighWaterMark: 1 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "A");
    assert.equal(result.stderr, "");
    assert.equal(closed, 1);
    assert.ok(reads <= 2);
    assert.equal(clock.timers.size, 0);
  } finally { await shell.dispose(); }
});

for (const failure of [undefined, null, false, 0, ""]) test(`Shell sole retained close failure stays exact: ${String(failure)}`, async () => {
  const { shell, fs } = fixture();
  await fs.writeFile("/log", encode(""));
  let closed = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { stat: options => handle.stat(options), read: (...input) => handle.read(...input), async close() { closed++; await handle.close(); throw failure; } };
  });
  try {
    await assert.rejects(shell.exec("tail -f --max-idle=0 /log", { fs: bound }), error => Object.is(error, failure));
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

for (const reason of [undefined, null, false, 0, ""]) test(`Shell late open and held close drain before caller cancellation: ${String(reason)}`, async () => {
  const { shell, fs } = fixture();
  await fs.writeFile("/log", encode(""));
  const acquired = deferred();
  const release = deferred();
  const controller = new AbortController();
  let opened = 0;
  let closing = 0;
  let settled = false;
  const bound = composition(fs, async path => {
    opened++;
    await acquired.promise;
    const handle = await fs.openReadFile!(path);
    return { stat: options => handle.stat(options), read: (...input) => handle.read(...input), async close() { closing++; await release.promise; await handle.close(); throw "secondary"; } };
  });
  const running = shell.exec("tail -F /log", { fs: bound, signal: controller.signal });
  void running.then(() => { settled = true; }, () => { settled = true; });
  const observed = assert.rejects(running, error => Object.is(error, controller.signal.reason));
  try {
    await until(() => opened > 0 || settled);
    controller.abort(reason);
    acquired.resolve();
    await until(() => closing > 0 || settled);
    assert.equal(settled, false);
    assert.equal(closing, 1);
    release.resolve();
    await observed;
    assert.equal(opened, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { controller.abort(reason); acquired.resolve(); release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("Shell output budget failure drains every reader and keeps its fatal reason", async () => {
  const { shell, fs } = fixture();
  await fs.writeFile("/one", encode("ab"));
  await fs.writeFile("/two", encode("cd"));
  const release = deferred();
  let closing = 0;
  let settled = false;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { stat: options => handle.stat(options), read: (...input) => handle.read(...input), async close() { closing++; await release.promise; await handle.close(); throw false; } };
  });
  const running = shell.exec("tail -q -f --max-idle=0 /one /two", { fs: bound, limits: { maxOutputBytes: 3 } });
  void running.then(() => { settled = true; }, () => { settled = true; });
  const observed = assert.rejects(running, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  try {
    await until(() => closing === 2 || settled);
    assert.equal(closing, 2);
    assert.equal(settled, false);
    release.resolve();
    await observed;
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("Shell explicit stdin idle flushes suffix and drains iterator return", async context => {
  const clock = new Clock(context);
  const { shell } = fixture();
  const release = deferred();
  let next = 0;
  let returned = 0;
  let settled = false;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { if (++next === 1) return { done: false, value: encode("first\nlast\n") }; return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    async return() { returned++; await release.promise; return { done: true, value: undefined }; },
  }; } };
  const running = shell.exec("tail -f -n1 --max-idle=.1", { stdin });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => next === 2 && clock.timers.size > 0 || settled);
    clock.advance(100);
    await until(() => returned > 0 || settled);
    assert.equal(settled, false);
    release.resolve();
    const result = await running;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "last\n");
    assert.equal(returned, 1);
    assert.equal(clock.timers.size, 0);
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("Shell retains ordinary VFS diagnostics instead of retrying operational errors", async () => {
  const { shell, fs } = fixture();
  let opened = 0;
  const bound = composition(fs, async () => { opened++; throw new FsError("EIO", { path: "/log" }); });
  try {
    const result = await shell.exec("tail -F --max-idle=0 /log", { fs: bound });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EIO/u);
    assert.equal(opened, 1);
  } finally { await shell.dispose(); }
});
