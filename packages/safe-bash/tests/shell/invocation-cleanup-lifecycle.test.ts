import assert from "node:assert/strict";
import { test } from "node:test";
import type { ByteSource, CommandContext, CommandResult, InvocationCleanup } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

for (const failure of [undefined, null, new Error("cleanup only")]) {
  test(`sole cleanup rejection preserves ${String(failure)} identity`, { timeout: 2000 }, async () => {
    const { shell, commands } = setup();
    commands.register({ name: "owned", execute(context) {
      context.registerCleanup!(() => { throw failure; });
      return { exitCode: 3 };
    } });
    let rejected = false;
    await shell.exec("owned").then(() => assert.fail("expected cleanup rejection"), (error: unknown) => {
      rejected = true;
      assert.equal(error, failure);
    });
    assert.equal(rejected, true);
    await shell.dispose();
  });
}

for (const reason of [null, 0, "cancel", { code: "EPIPE" }, new Error("caller")]) {
  test(`caller abort during drain wins over execution and cleanup: ${String(reason)}`, { timeout: 2000 }, async () => {
    const { shell, commands } = setup();
    const controller = new AbortController();
    const draining = deferred();
    const release = deferred();
    const executionFailure = new ShellLimitError("maxCommands");
    let rest = false;
    commands.register({ name: "owned", execute(context) {
      context.registerCleanup!(async () => { draining.resolve(); await release.promise; throw undefined; });
      context.registerCleanup!(() => { rest = true; throw null; });
      throw executionFailure;
    } });
    const execution = shell.exec("owned", { signal: controller.signal });
    const observed = execution.then(() => assert.fail("expected rejection"), (error: unknown) => assert.equal(error, reason));
    await draining.promise;
    controller.abort(reason);
    assert.equal(rest, true);
    release.resolve();
    await observed;
    await shell.dispose();
  });
}

test("execution rejection wins while every delayed cleanup failure is observed", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const primary = new ShellLimitError("maxOutputBytes");
  const completed: string[] = [];
  commands.register({ name: "owned", execute(context) {
    context.registerCleanup!(async () => { await delay(); completed.push("delayed"); throw null; });
    context.registerCleanup!(() => { completed.push("sync"); throw undefined; });
    throw primary;
  } });
  await assert.rejects(shell.exec("owned"), (error: unknown) => error === primary);
  assert.deepEqual(completed, ["sync", "delayed"]);
  await shell.dispose();
});

test("ordinary command throw keeps its diagnostic and status after cleanup", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let done = false;
  commands.register({ name: "owned", execute(context) {
    context.registerCleanup!(async () => { await delay(); done = true; });
    throw new Error("ordinary command failure");
  } });
  const result = await shell.exec("owned");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "shell: line 1: ordinary command failure\n");
  assert.equal(done, true);
  await shell.dispose();
});

test("noncallable registration and cleanup-time registration fail synchronously", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let late = false;
  commands.register({ name: "owned", execute(context) {
    assert.equal(Object.getOwnPropertySymbols(context).length, 0);
    assert.throws(() => context.registerCleanup!(null as unknown as InvocationCleanup), TypeError);
    context.registerCleanup!(() => {
      assert.throws(() => context.registerCleanup!(() => { late = true; }), Error);
    });
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("owned")).exitCode, 0);
  assert.equal(late, false);
  await shell.dispose();
});

test("all hooks start while an earlier hook is pending; finally shares the owned close", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const entered = deferred();
  const started = deferred();
  const release = deferred();
  let closes = 0;
  let close: Promise<void> | undefined;
  let second = false;
  let third = false;
  commands.register({ name: "owned", async execute(context) {
    const cleanup = () => close ??= (async () => { closes++; started.resolve(); await release.promise; })();
    context.registerCleanup!(cleanup);
    context.registerCleanup!(() => { second = true; throw new Error("second"); });
    context.registerCleanup!(() => { third = true; });
    entered.resolve();
    try { await new Promise<void>((_resolve, reject) => context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true })); }
    finally { await cleanup(); }
    return { exitCode: 0 };
  } });
  const reason = new Error("abort");
  const execution = assert.rejects(shell.exec("owned", { signal: controller.signal }), (error: unknown) => error === reason);
  await entered.promise;
  controller.abort(reason);
  await started.promise;
  await turn();
  assert.equal(second, true);
  assert.equal(third, true);
  assert.equal(closes, 1);
  release.resolve();
  await execution;
  await shell.dispose();
});

test("normal parent closure seals detached descendants before iterator or FS acquisition", { timeout: 2000 }, async () => {
  const { shell, commands, fs } = setup();
  let parent!: CommandContext;
  let child!: CommandContext;
  const childEntered = deferred();
  const childClose = deferred();
  const release = deferred();
  let acquisitions = 0;
  let filesystemCalls = 0;
  let invocations = 0;
  const stat = fs.stat.bind(fs);
  fs.stat = async (...args) => { filesystemCalls++; return stat(...args); };
  shell.use(async (_context, next) => { invocations++; return next(); });
  commands.register({ name: "parent", async execute(context) {
    parent = context;
    void context.invoke!("child", []);
    await childEntered.promise;
    return { exitCode: 0 };
  } });
  commands.register({ name: "child", async execute(context) {
    child = context;
    context.registerCleanup!(async () => { childClose.resolve(); await release.promise; });
    childEntered.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  let settled = false;
  const execution = shell.exec("parent").finally(() => { settled = true; });
  await childClose.promise;
  const input: ByteSource = { [Symbol.asyncIterator]() { acquisitions++; return { async next() { return { done: true, value: undefined }; } }; } };
  for (const context of [parent, child]) {
    assert.throws(() => context.registerCleanup!(() => {}), Error);
    await assert.rejects(context.invoke!("cd", ["/new"], { stdin: input }));
  }
  assert.equal(acquisitions, 0);
  assert.equal(filesystemCalls, 0);
  assert.equal(invocations, 2);
  assert.equal(settled, false);
  release.resolve();
  assert.equal((await execution).exitCode, 0);
  await shell.dispose();
});

test("caller-aborted saved capabilities preserve exact admission reason", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const entered = deferred();
  let context!: CommandContext;
  commands.register({ name: "owned", async execute(current) { context = current; entered.resolve(); return new Promise<CommandResult>(() => {}); } });
  const reason = { marker: "exact" };
  const execution = assert.rejects(shell.exec("owned", { signal: controller.signal }), (error: unknown) => error === reason);
  await entered.promise;
  controller.abort(reason);
  await execution;
  assert.throws(() => context.registerCleanup!(() => {}), (error: unknown) => error === reason);
  await assert.rejects(context.invoke!("true", []), (error: unknown) => error === reason);
  await shell.dispose();
});

test("late opaque rejection is observed after owned cleanup and public settlement", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const entered = deferred();
  const handler = deferred<CommandResult>();
  let done = false;
  commands.register({ name: "owned", execute(context) {
    context.registerCleanup!(async () => { await delay(); done = true; });
    entered.resolve();
    return handler.promise;
  } });
  const reason = new Error("cancel");
  const execution = assert.rejects(shell.exec("owned", { signal: controller.signal }), (error: unknown) => error === reason);
  await entered.promise;
  controller.abort(reason);
  await execution;
  assert.equal(done, true);
  handler.reject(new Error("late opaque handler"));
  await turn();
  await turn();
  await shell.dispose();
});

test("nested middleware overlays keep their cleanup closure and exact replacement environment", { timeout: 2000 }, async () => {
  const { shell, commands } = setup({ env: { INHERITED: "secret" } });
  const closed: string[] = [];
  shell.use(async (context, next) => {
    context.registerCleanup!(() => { closed.push(`middleware:${context.command}`); });
    Object.assign(context, { env: { ...context.env, OVERLAY: context.command } });
    return next();
  });
  commands.register({ name: "parent", execute(context) { return context.invoke!("child", [], { replaceEnv: true, env: { ONLY: "child" } }); } });
  commands.register({ name: "child", execute(context) {
    context.registerCleanup!(() => { closed.push("child"); });
    assert.deepEqual({ ...context.env }, { ONLY: "child", OVERLAY: "child" });
    assert.equal(context.stdinIsDefault, true);
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("parent")).exitCode, 0);
  assert.deepEqual(closed.sort(), ["child", "middleware:child", "middleware:parent"]);
  await shell.dispose();
});

test("dispose and cancellation isolate concurrent execs and another shell sharing an owner", { timeout: 2000 }, async () => {
  const first = setup();
  const other = setup();
  const leases = new Set<string>();
  const entries = new Map<string, ReturnType<typeof deferred<void>>>();
  const releases = new Map<string, ReturnType<typeof deferred<CommandResult>>>();
  const register = (target: typeof first, name: string) => {
    const entered = deferred();
    const release = deferred<CommandResult>();
    entries.set(name, entered);
    releases.set(name, release);
    target.commands.register({ name, execute(context) {
      context.registerCleanup!(async () => { await delay(); leases.delete(name); });
      leases.add(name);
      entered.resolve();
      return release.promise;
    } });
  };
  register(first, "one"); register(first, "two"); register(other, "three");
  const controller = new AbortController();
  const reason = new Error("only one");
  const one = assert.rejects(first.shell.exec("one", { signal: controller.signal }), (error: unknown) => error === reason);
  const two = first.shell.exec("two");
  const twoObserved = assert.rejects(two, Error);
  const three = other.shell.exec("three");
  await Promise.all([...entries.values()].map((entry) => entry.promise));
  controller.abort(reason);
  await one;
  assert.deepEqual([...leases].sort(), ["three", "two"]);
  await first.shell.dispose();
  await twoObserved;
  assert.deepEqual([...leases], ["three"]);
  releases.get("three")!.resolve({ exitCode: 0 });
  assert.equal((await three).exitCode, 0);
  assert.equal(leases.size, 0);
  await other.shell.dispose();
});

test("reentrant dispose returns the identical barrier and starts plugin disposal once", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const entered = deferred();
  let reentrant: Promise<void> | undefined;
  let cleanups = 0;
  let plugins = 0;
  shell.use({ name: "plugin", setup() {}, async dispose() { plugins++; await delay(); } });
  commands.register({ name: "owned", execute(context) {
    context.registerCleanup!(() => { cleanups++; });
    context.signal.addEventListener("abort", () => { reentrant = shell.dispose(); }, { once: true });
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  const execution = assert.rejects(shell.exec("owned"), Error);
  await entered.promise;
  const disposal = shell.dispose();
  assert.equal(reentrant, disposal);
  assert.equal(shell.dispose(), disposal);
  await Promise.all([disposal, execution]);
  assert.equal(cleanups, 1);
  assert.equal(plugins, 1);
});

test("dispose drains every owned failure before reverse plugin disposal", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const entered = deferred();
  const events: string[] = [];
  shell.use({ name: "first", setup() {}, dispose() { events.push("first"); } });
  shell.use({ name: "second", setup() {}, dispose() { events.push("second"); throw new Error("plugin"); } });
  commands.register({ name: "owned", execute(context) {
    context.registerCleanup!(async () => { await delay(); events.push("cleanup"); throw undefined; });
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  const execution = assert.rejects(shell.exec("owned"), Error);
  await entered.promise;
  const disposal = shell.dispose();
  await assert.rejects(disposal, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0], undefined);
    assert.equal(error.errors[1].message, "plugin");
    return true;
  });
  await execution;
  assert.equal(shell.dispose(), disposal);
  assert.deepEqual(events, ["cleanup", "second", "first"]);
});

test("closed detached middleware cannot call later middleware through a saved next", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const entered = deferred();
  let nextChild!: () => Promise<CommandResult>;
  let childEffects = 0;
  shell.use((context, next) => {
    if (context.command !== "child") return next();
    context.registerCleanup!(() => {});
    nextChild = next;
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  });
  shell.use((context, next) => { if (context.command === "child") childEffects++; return next(); });
  commands.register({ name: "parent", async execute(context) {
    void context.invoke!("child", []);
    await entered.promise;
    return { exitCode: 0 };
  } });
  commands.register({ name: "child", execute() { childEffects++; return { exitCode: 0 }; } });
  assert.equal((await shell.exec("parent")).exitCode, 0);
  await assert.rejects(nextChild(), Error);
  assert.equal(childEffects, 0);
  await shell.dispose();
});

test("each duplicate registration runs once without exposing closure authority", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let calls = 0;
  commands.register({ name: "owned", execute(context) {
    const cleanup = () => { calls++; };
    context.registerCleanup!(cleanup);
    context.registerCleanup!(cleanup);
    assert.equal(Object.getOwnPropertySymbols(context).length, 0);
    return { exitCode: 0 };
  } });
  await shell.exec("owned");
  await Promise.all([shell.dispose(), shell.dispose()]);
  assert.equal(calls, 2);
});
