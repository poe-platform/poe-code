import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { getEventListeners } from "node:events";
import { FsError, toByteSource, type CommandContext, type FileSystem, type ByteSource } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { streamCommands } from "../../src/commands/streams.js";
import { tailFollowScheduler } from "../../src/commands/tail-follow.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createBrowserCommands } from "../../src/browser.js";
import { createAgentCommands } from "../../src/plugins/index.js";

const encode = (text: string) => new TextEncoder().encode(text);

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 64 && !predicate(); turn++) await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(predicate(), true, "bounded capability checkpoint not reached");
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

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/log", encode("first\nlast\n"));
  return fs;
}

function launch(args: readonly string[], fs: FileSystem, overrides: Partial<CommandContext> = {}, cap = 64) {
  const controller = new AbortController();
  const stdout: number[] = [];
  const stderr: number[] = [];
  const context: CommandContext = {
    command: "tail", args, fs, cwd: "/", env: {}, signal: controller.signal,
    stdin: toByteSource("first\nlast\n"),
    stdout: { async write(chunk) { stdout.push(...chunk); } },
    stderr: { async write(chunk) { stderr.push(...chunk); } },
    ...overrides,
  };
  const completion = Promise.resolve(streamCommands(64, cap).find(command => command.name === "tail")!.execute(context));
  let settled = false;
  void completion.then(() => { settled = true; }, () => { settled = true; });
  return { completion, controller, stdout, stderr, get settled() { return settled; }, text: () => new TextDecoder().decode(Uint8Array.from(stdout)), errors: () => new TextDecoder().decode(Uint8Array.from(stderr)) };
}

for (const mode of ["-f", "-F", "-fF", "-Ff"]) test(`tail ${mode} supports bounded initial-only selection`, async () => {
  const run = launch([mode, "--max-idle", "0", "-n1", "/log"], await fixture());
  assert.equal((await run.completion).exitCode, 0, run.errors());
  assert.equal(run.text(), "last\n");
  assert.equal(run.errors(), "");
});

test("tail -f on consumed stdin finishes at EOF", async () => {
  const run = launch(["-f", "-n1"], await fixture());
  assert.equal((await run.completion).exitCode, 0, run.errors());
  assert.equal(run.text(), "last\n");
});

test("tail -F explicitly refuses stdin by name", async () => {
  const run = launch(["-F", "-"], await fixture());
  assert.equal((await run.completion).exitCode, 1);
  assert.match(run.errors(), /cannot follow.*by name/u);
});

for (const option of ["-1", "1e2", "NaN", "Infinity", "0.0001", "9007199254741"]) test(`max-idle rejects unsupported duration ${option} before opening`, async () => {
  let opened = 0;
  const fs = await fixture();
  const bound = Object.create(fs) as FileSystem;
  bound.openReadFile = async () => { opened++; throw new FsError("EIO"); };
  const run = launch(["-f", `--max-idle=${option}`, "/log"], bound);
  assert.equal((await run.completion).exitCode, 2);
  assert.equal(opened, 0);
});

test("named reservation preflight includes the F candidate and precedes filesystem effects", async () => {
  let opened = 0;
  const fs = await fixture();
  const bound = Object.create(fs) as FileSystem;
  bound.openReadFile = async () => { opened++; throw new FsError("EIO"); };
  const run = launch(["-F", "--max-idle=0", "/log"], bound, {}, 1);
  assert.equal((await run.completion).exitCode, 2);
  assert.match(run.errors(), /maxTailFollowHandles/u);
  assert.equal(opened, 0);
});

for (const cap of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) test(`invalid follow cap ${String(cap)}`, () => {
  assert.throws(() => streamCommands(64, cap), /maxTailFollowHandles/u);
});

test("finite tail and head remain unchanged", async () => {
  const fs = await fixture();
  const run = launch(["-n1", "/log"], fs, {}, 0);
  assert.equal((await run.completion).exitCode, 0);
  assert.equal(run.text(), "last\n");
});

for (const factory of [createStandardCommands, createBrowserCommands, createAgentCommands]) test(`${factory.name} forwards a zero named-follow cap`, async () => {
  assert.throws(() => factory({ maxTailFollowHandles: -1 }), /maxTailFollowHandles/u);
  const tail = factory({ maxTailFollowHandles: 0 }).find(command => command.name === "tail")!;
  const errors: number[] = [];
  const result = await tail.execute({ command: "tail", args: ["-f", "--max-idle=0", "/log"], fs: await fixture(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write(chunk) { errors.push(...chunk); } } });
  assert.equal(result.exitCode, 2);
  assert.match(new TextDecoder().decode(Uint8Array.from(errors)), /maxTailFollowHandles/u);
});

for (const args of [["-F", "-f"], ["-fFf"], ["-vFn1", "-f"]]) test(`ordered mode selection ${args.join(" ")}`, async () => {
  const run = launch([...args, "--max-idle=0", "/log"], await fixture(), {}, 1);
  assert.equal((await run.completion).exitCode, 0, run.errors());
});

test("count values and literal operands are not follow flags", async () => {
  const fs = await fixture();
  await fs.writeFile("/-F", encode("literal\n"));
  const run = launch(["-f", "--max-idle=0", "--", "-F"], fs, {}, 1);
  assert.equal((await run.completion).exitCode, 0);
  assert.equal(run.text(), "literal\n");
  const invalid = launch(["-n", "-F", "/log"], fs);
  assert.equal((await invalid.completion).exitCode, 2);
});

for (const mode of ["-f", "-F"]) test(`${mode} append, no duplicate bytes, truncation and exact idle`, async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  const run = launch([mode, "-n1", "--max-idle=.2", "/log"], fs);
  try {
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), "last\n");
    await fs.appendFile("/log", encode("append\n"));
    clock.advance(100);
    await until(() => run.text().endsWith("append\n") && clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), "last\nappend\n");
    await fs.writeFile("/log", encode("x\n"));
    clock.advance(100);
    await until(() => run.text().endsWith("x\n") && clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), "last\nappend\nx\n");
    assert.match(run.errors(), /file truncated/u);
    clock.advance(100);
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.settled, false);
    clock.advance(100);
    assert.equal((await run.completion).exitCode, 0, run.errors());
    assert.equal(clock.timers.size, 0);
  } finally { run.controller.abort(); await run.completion.catch(() => {}); }
});

for (const mode of ["-f", "-F"]) test(`${mode} follows the selected retained identity across replacement`, async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  const run = launch([mode, "-n0", "/log"], fs);
  try {
    await until(() => clock.timers.size > 0 || run.settled);
    await fs.rename("/log", "/old");
    await fs.writeFile("/log", encode("replacement\n"));
    await fs.appendFile("/old", encode("old append\n"));
    clock.advance(100);
    await until(() => run.stdout.length > 0 && clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), mode === "-f" ? "old append\n" : "replacement\n");
    assert.equal(run.errors().includes("replaced"), mode === "-F");
  } finally { run.controller.abort(false); await assert.rejects(run.completion, error => error === false); }
  assert.equal(clock.timers.size, 0);
  assert.equal(getEventListeners(run.controller.signal, "abort").length, 0);
});

test("initial retained selection does not chase append after its first stat", async () => {
  const fs = await fixture();
  let appended = false;
  const reads: number[] = [];
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { ...handle, async stat(options) {
      const stat = await handle.stat(options);
      if (!appended) { appended = true; await fs.appendFile("/log", encode("later\n")); }
      return stat;
    }, async read(position, maximum, options) { reads.push(maximum); return handle.read(position, maximum, options); } };
  });
  const run = launch(["-f", "-n1", "--max-idle=0", "/log"], bound);
  assert.equal((await run.completion).exitCode, 0, run.errors());
  assert.equal(run.text(), "last\n");
  assert.deepEqual(reads, [11]);
});

test("short reads preserve line suffixes and raw unterminated bytes", async () => {
  const fs = await fixture();
  await fs.writeFile("/log", Uint8Array.of(255, 10, 254, 253));
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { ...handle, read: (position, maximum, options) => handle.read(position, Math.min(1, maximum), options) };
  });
  const run = launch(["-f", "-n1", "--max-idle=0", "/log"], bound);
  assert.equal((await run.completion).exitCode, 0);
  assert.deepEqual(run.stdout, [254, 253]);
});

for (const bytes of [false, true]) test(`positive ${bytes ? "byte" : "line"} initial offsets use the selected GNU behavior`, async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  await fs.writeFile("/log", encode("a\n"));
  const run = launch(["-f", bytes ? "-c+5" : "-n+5", "/log"], fs);
  try {
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), bytes ? "a\n" : "");
    assert.equal(run.errors().includes("file truncated"), bytes);
    await fs.appendFile("/log", encode("second\n"));
    clock.advance(100);
    await until(() => run.text().endsWith("second\n") && clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), `${bytes ? "a\n" : ""}second\n`);
  } finally { run.controller.abort(); await run.completion.catch(() => {}); }
});

for (const initial of [false, true]) test(`name recovery restarts zero and ${initial ? "retains initial failure" : "does not fail for later loss"}`, async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  let unavailable = initial;
  const bound = composition(fs, async (...args) => { if (unavailable) throw new FsError("ENOENT", { path: "/log" }); return fs.openReadFile!(...args); });
  const run = launch(["-F", "-n1", "--max-idle=.3", "/log"], bound);
  try {
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), initial ? "" : "last\n");
    unavailable = true;
    await fs.appendFile("/log", encode("hidden\n"));
    clock.advance(100);
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), initial ? "" : "last\n");
    unavailable = false;
    clock.advance(50);
    clock.advance(50);
    await until(() => run.text().includes("hidden\n") || run.settled);
    if (!initial) assert.equal(run.text(), "last\nfirst\nlast\nhidden\n");
    else assert.equal(run.text(), "first\nlast\nhidden\n");
    await until(() => clock.timers.size > 0 || run.settled);
    clock.advance(300);
    assert.equal((await run.completion).exitCode, initial ? 1 : 0, run.errors());
  } finally { run.controller.abort(); await run.completion.catch(() => {}); }
});

test("repeated missing names and empty replacements do not reset idle", async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  await fs.writeFile("/empty", encode(""));
  const run = launch(["-F", "--max-idle=.3", "/missing", "/empty"], fs);
  try {
    for (let poll = 0; poll < 3; poll++) {
      await until(() => clock.timers.size > 0 || run.settled);
      await fs.rename("/empty", `/old${poll}`);
      await fs.writeFile("/empty", encode(""));
      clock.advance(100);
    }
    assert.equal((await run.completion).exitCode, 1);
    assert.equal(clock.timers.size, 0);
    assert.equal(run.errors().split("ENOENT").length - 1, 1);
  } finally { run.controller.abort(); await run.completion.catch(() => {}); }
});

test("initial EISDIR emits a header and positive lines stop before later operands", async () => {
  const fs = await fixture();
  await fs.mkdir("/directory");
  const opened: string[] = [];
  const bound = composition(fs, async (path, options) => { opened.push(path); return fs.openReadFile!(path, options); });
  const run = launch(["-F", "-n+1", "--max-idle=0", "/directory", "/log"], bound);
  assert.equal((await run.completion).exitCode, 1);
  assert.equal(run.text(), "==> /directory <==\n");
  assert.deepEqual(opened, ["/directory"]);
});

test("late access loss emits the observed empty header and recovery replays from zero", async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  await fs.writeFile("/other", encode("other\n"));
  let denied = false;
  const bound = composition(fs, async (path, options) => { if (denied && path === "/log") throw new FsError("EACCES", { path }); return fs.openReadFile!(path, options); });
  const run = launch(["-F", "-n1", "/log", "/other"], bound);
  try {
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), "==> /log <==\nlast\n\n==> /other <==\nother\n");
    denied = true;
    clock.advance(100);
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.text(), "==> /log <==\nlast\n\n==> /other <==\nother\n\n==> /log <==\n");
    denied = false;
    clock.advance(100);
    await until(() => run.text().endsWith("first\nlast\n") || run.settled);
  } finally { run.controller.abort(); await run.completion.catch(() => {}); }
});

test("fair finite-size rounds use 64 KiB reads without sleeping for backlog chunks", async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  await fs.writeFile("/a", encode(""));
  await fs.writeFile("/b", encode(""));
  const reads: { path: string; maximum: number }[] = [];
  const bound = composition(fs, async (path, options) => {
    const handle = await fs.openReadFile!(path, options);
    return { ...handle, read(position, maximum, input) { reads.push({ path, maximum }); return handle.read(position, maximum, input); } };
  });
  const run = launch(["-qf", "-n0", "/a", "/b"], bound);
  try {
    await until(() => clock.timers.size > 0 || run.settled);
    await fs.appendFile("/a", new Uint8Array(131073).fill(65));
    await fs.appendFile("/b", new Uint8Array(131073).fill(66));
    clock.advance(100);
    await until(() => run.stdout.length === 262146 && clock.timers.size > 0 || run.settled);
    assert.equal(run.stdout.length, 262146);
    assert.deepEqual(reads.map(read => read.path), ["/a", "/b", "/a", "/b", "/a", "/b"]);
    assert.equal(reads.every(read => read.maximum <= 65536), true);
    assert.equal(clock.time, 100);
  } finally { run.controller.abort(); await run.completion.catch(() => {}); }
});

test("blocked writes are not idle expiration and acknowledge progress only when settled", async context => {
  const clock = new Clock(context);
  const release = deferred();
  let writing = false;
  const run = launch(["-f", "-n1", "--max-idle=.1", "/log"], await fixture(), { stdout: { async write() { writing = true; await release.promise; } } });
  try {
    await until(() => writing || run.settled);
    assert.equal(writing, true);
    clock.advance(5000);
    assert.equal(run.settled, false);
    assert.equal(clock.timers.size, 0);
    release.resolve();
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.settled, false);
    clock.advance(100);
    assert.equal((await run.completion).exitCode, 0);
  } finally { release.resolve(); run.controller.abort(); await run.completion.catch(() => {}); }
});

for (const duration of ["0", ".1"]) test(`stdin idle ${duration} flushes bounded suffix and joins return`, async context => {
  const clock = new Clock(context);
  const pending = deferred<IteratorResult<Uint8Array>>();
  const close = deferred();
  let pulls = 0;
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { pulls++; return pulls === 1 ? Promise.resolve({ done: false, value: encode("first\nlast\n") }) : pending.promise; },
    async return() { returns++; pending.resolve({ done: true, value: undefined }); await close.promise; return { done: true, value: undefined }; },
  }; } };
  const run = launch(["-f", "-n1", `--max-idle=${duration}`], await fixture(), { stdin }, 0);
  try {
    await until(() => pulls === 2 || run.settled);
    assert.equal(pulls, 2);
    clock.advance(100);
    await until(() => returns === 1 || run.settled);
    assert.equal(returns, 1);
    assert.equal(run.settled, false);
    close.resolve();
    assert.equal((await run.completion).exitCode, 0);
    assert.equal(run.text(), "last\n");
    assert.equal(clock.timers.size, 0);
  } finally { pending.resolve({ done: true, value: undefined }); close.resolve(); run.controller.abort(); await run.completion.catch(() => {}); }
});

test("positive stdin selection emits before EOF and mixed EOF does not stop named readers", async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  const ended = deferred();
  const stdin = (async function* () { yield encode("first\nsecond\n"); await ended.promise; })();
  const run = launch(["-qf", "-n+2", "-", "/log"], fs, { stdin, stdinIsDefault: false });
  try {
    await until(() => run.text() === "second\n" || run.settled);
    assert.equal(run.text(), "second\n");
    ended.resolve();
    await until(() => clock.timers.size > 0 || run.settled);
    assert.equal(run.settled, false);
    await fs.appendFile("/log", encode("after eof\n"));
    clock.advance(100);
    await until(() => run.text().endsWith("after eof\n") || run.settled);
  } finally { ended.resolve(); run.controller.abort(); await run.completion.catch(() => {}); }
});

test("missing identity is refused instead of using pathname, size or timestamps", async () => {
  const fs = await fixture();
  let closed = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { ...handle, async stat(options) { const stat = { ...await handle.stat(options) }; delete stat.identityScope; return stat; }, async close() { closed++; await handle.close(); } };
  });
  const run = launch(["-F", "--max-idle=0", "/log"], bound);
  assert.equal((await run.completion).exitCode, 1);
  assert.match(run.errors(), /complete retained identity/u);
  assert.equal(closed, 1);
});

test("polling reuses one session cleanup registration", async context => {
  const clock = new Clock(context);
  const cleanups: (() => void | Promise<void>)[] = [];
  const run = launch(["-F", "/log"], await fixture(), { registerCleanup: cleanup => { cleanups.push(cleanup); } });
  try {
    for (let poll = 0; poll < 8; poll++) { await until(() => clock.timers.size > 0 || run.settled); clock.advance(100); }
    assert.equal(cleanups.length, 1);
    assert.equal(run.settled, false);
  } finally { run.controller.abort(); await run.completion.catch(() => {}); await Promise.all(cleanups.map(cleanup => cleanup())); }
  assert.equal(clock.timers.size, 0);
});

for (const reason of [undefined, null, false, 0, ""]) test(`falsey stdin primary ${String(reason)} survives a different close failure`, async () => {
  const closeFailure = new Error("secondary close");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next: () => Promise.reject(reason),
    return: () => Promise.reject(closeFailure),
  }; } };
  const run = launch(["-f"], await fixture(), { stdin });
  assert.equal((await run.completion).exitCode, 1);
  assert.equal(run.errors(), `tail: ${String(reason)}\n`);
});

test("late acquired handles and closing comparison slots remain owned until release settles", async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  const acquisition = deferred();
  const release = deferred();
  let opened = 0;
  let closed = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    opened++;
    await acquisition.promise;
    return { ...handle, async close() { closed++; await release.promise; await handle.close(); } };
  });
  const run = launch(["-F", "/log"], bound, {}, 2);
  try {
    await until(() => opened === 1 || run.settled);
    assert.equal(opened, 1);
    run.controller.abort(false);
    acquisition.resolve();
    await until(() => closed === 1 || run.settled);
    assert.equal(closed, 1);
    assert.equal(run.settled, false);
    assert.equal(opened, 1);
    release.resolve();
    await assert.rejects(run.completion, error => error === false);
  } finally { acquisition.resolve(); release.resolve(); run.controller.abort(); await run.completion.catch(() => {}); }
  assert.equal(clock.timers.size, 0);
});

test("default cap is 64 and duplicate operands reserve independent slots before opening", async () => {
  const fs = await fixture();
  let opened = 0;
  const bound = composition(fs, async (...args) => { opened++; return fs.openReadFile!(...args); });
  for (const [mode, count] of [["-f", 65], ["-F", 64]] as const) {
    const run = launch([mode, "--max-idle=0", ...Array<string>(count).fill("/log")], bound);
    assert.equal((await run.completion).exitCode, 2);
    assert.match(run.errors(), /limit 64/u);
    assert.equal(opened, 0);
  }
  const run = launch(["-f", "--max-idle=0", "-q", "-n0", ...Array<string>(64).fill("/log")], bound);
  assert.equal((await run.completion).exitCode, 0);
  assert.equal(opened, 64);
});

test("zero named cap still permits stdin follow and leaves the first tee cap argument intact", async () => {
  const run = launch(["-f"], await fixture(), {}, 0);
  assert.equal((await run.completion).exitCode, 0);
  assert.equal(run.text(), "first\nlast\n");
  assert.throws(() => streamCommands(-1, 64), /maxTeeTargets/u);
});

test("name comparison cannot reuse a held or failed close slot", async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  const release = deferred();
  let opened = 0;
  let closed = 0;
  let live = 0;
  let maximum = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    const ordinal = ++opened;
    live++;
    maximum = Math.max(maximum, live);
    return { ...handle, async close() {
      closed++;
      if (ordinal === 2) { await release.promise; await handle.close(); throw false; }
      await handle.close();
      live--;
    } };
  });
  const run = launch(["-F", "-n0", "/log"], bound, {}, 2);
  try {
    await until(() => closed === 1 || run.settled);
    clock.advance(10000);
    assert.equal(opened, 2);
    assert.equal(maximum, 2);
    assert.equal(run.settled, false);
    release.resolve();
    assert.equal((await run.completion).exitCode, 1);
    assert.equal(run.errors(), "tail: false\n");
    assert.equal(opened, 2);
    assert.equal(closed, 2);
  } finally { release.resolve(); run.controller.abort(); await run.completion.catch(() => {}); }
  assert.equal(clock.timers.size, 0);
});

for (const retainedRead of [false, undefined]) test(`follow refuses ${String(retainedRead)} capability without attempting an open`, async () => {
  const fs = await fixture();
  let opened = 0;
  const bound = composition(fs, async (...args) => { opened++; return fs.openReadFile!(...args); });
  const unsupported = new Proxy(bound, { get(target, key) {
    if (key === "capabilitiesFor") return async () => ({ ...fs.capabilities, retainedRead });
    return Reflect.get(target, key);
  } });
  const run = launch(["-f", "--max-idle=0", "/log"], unsupported);
  assert.equal((await run.completion).exitCode, 1);
  assert.match(run.errors(), /ENOTSUP/u);
  assert.equal(opened, 0);
});

test("stock overridden adapter refusal is not bypassed by path reads", async () => {
  class OverrideMemory extends MemoryFileSystem {
    reads = 0;
    override async readFile(...args: Parameters<MemoryFileSystem["readFile"]>) { this.reads++; return super.readFile(...args); }
  }
  const fs = new OverrideMemory();
  await fs.writeFile("/log", encode("data"));
  const run = launch(["-f", "--max-idle=0", "/log"], fs);
  assert.equal((await run.completion).exitCode, 1);
  assert.match(run.errors(), /ENOTSUP/u);
  assert.equal(fs.reads, 0);
});

for (const reason of [undefined, null, false, 0, ""]) test(`retained stat primary ${String(reason)} is not replaced by failed candidate cleanup`, async () => {
  const fs = await fixture();
  let closed = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { ...handle, async stat() { throw reason; }, async close() { closed++; await handle.close(); throw new Error("secondary close"); } };
  });
  const run = launch(["-F", "--max-idle=0", "/log"], bound);
  assert.equal((await run.completion).exitCode, 1);
  assert.equal(run.errors(), `tail: ${String(reason)}\n`);
  assert.equal(closed, 1);
});

test("timer clear failure is exact and still closes retained readers", async context => {
  const clock = new Clock(context);
  const fs = await fixture();
  let closed = 0;
  const bound = composition(fs, async (...args) => {
    const handle = await fs.openReadFile!(...args);
    return { ...handle, async close() { closed++; await handle.close(); } };
  });
  const run = launch(["-f", "--max-idle=.1", "/log"], bound);
  try {
    await until(() => clock.timers.size > 0 || run.settled);
    context.mock.method(tailFollowScheduler, "clearTimeout", (handle: number) => { clock.timers.delete(handle); throw 0; });
    clock.advance(100);
    assert.equal((await run.completion).exitCode, 1);
    assert.equal(run.errors(), "tail: 0\n");
    assert.equal(closed, 1);
    assert.equal(clock.timers.size, 0);
  } finally { run.controller.abort(); await run.completion.catch(() => {}); }
});
