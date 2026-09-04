import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext, CommandResult } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";
import { ArrayOwner, type Admission } from "../../src/shell/arrays/ledger.js";
import { StateMonitor, stateMonitor } from "../../src/shell/arrays/state.js";
import { Runtime } from "../../src/shell/runtime.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("cleanup is registered before acquisition and delays normal public settlement", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const started = deferred();
  const release = deferred();
  let acquired = false;
  let cleaned = false;
  let settled = false;
  commands.register({ name: "owned", execute(context) {
    assert.equal(typeof context.registerCleanup, "function");
    context.registerCleanup!(async () => { assert.equal(acquired, true); started.resolve(); await release.promise; cleaned = true; });
    acquired = true;
    return { exitCode: 7 };
  } });
  const execution = shell.exec("owned").finally(() => { settled = true; });
  await Promise.race([started.promise, execution]);
  assert.equal(acquired, true);
  await turn();
  assert.equal(settled, false);
  release.resolve();
  assert.equal((await execution).exitCode, 7);
  assert.equal(cleaned, true);
  await shell.dispose();
});

test("caller cancellation drains middleware hooks without waiting opaque next", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const reason = { code: "EPIPE", caller: true };
  let cleaned = false;
  let settled = false;
  shell.use(async (context) => {
    context.registerCleanup?.(async () => { await release.promise; cleaned = true; });
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  });
  const execution = shell.exec("true", { signal: controller.signal }).then(
    () => { settled = true; assert.fail("expected abort"); },
    (error: unknown) => { settled = true; assert.equal(error, reason); },
  );
  await entered.promise;
  controller.abort(reason);
  await turn();
  assert.equal(settled, false);
  release.resolve();
  await execution;
  assert.equal(cleaned, true);
  await shell.dispose();
});

test("cancellation starts parent and child cleanup without serializing their barriers", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const entered = deferred(), release = deferred();
  const controller = new AbortController();
  const events: string[] = [];
  commands.register({ name: "child-cleanup", execute(context) {
    context.registerCleanup!(async () => { events.push("child"); entered.resolve(); await release.promise; events.push("child done"); });
    return { exitCode: 0 };
  } });
  commands.register({ name: "parent-cleanup", async execute(context) {
    context.registerCleanup!(() => { events.push("parent"); release.resolve(); });
    return await context.invoke!("child-cleanup", []);
  } });
  const execution = shell.exec("seed=; parent-cleanup", { signal: controller.signal });
  const rejected = assert.rejects(execution, error => Object.is(error, 0));
  try {
    await entered.promise;
    controller.abort(0);
    await rejected;
    assert.deepEqual(events, ["child", "parent", "child done"]);
  } finally { release.resolve(); await shell.dispose(); }
});

for (const cleanupFails of [false, true]) {
  test(`cancelled scalar prefixes restore before root ownership closes: cleanup failure ${cleanupFails}`, { timeout: 2000 }, async context => {
    const { shell, commands } = setup();
    const controller = new AbortController();
    const cleanups: number[] = [];
    const observed: { value: string | undefined; rootClosed: boolean }[] = [];
    let rootClosed = false;
    const close = ArrayOwner.prototype.close;
    context.mock.method(ArrayOwner.prototype, "close", function (this: ArrayOwner) {
      if (!this.parent) rootClosed = true;
      return close.call(this);
    });
    const simple = Runtime.prototype.simple;
    context.mock.method(Runtime.prototype, "simple", async function (this: Runtime, ...args: Parameters<Runtime["simple"]>) {
      try { return await simple.apply(this, args); }
      finally {
        if (args[0].words.some(word => word.plain === "cancel-prefix")) observed.push({ value: args[1].variables.V, rootClosed });
      }
    });
    commands.register({ name: "cancel-prefix", execute(command) {
      command.registerCleanup!(() => { cleanups.push(1); if (cleanupFails) throw undefined; });
      command.registerCleanup!(() => { cleanups.push(2); if (cleanupFails) throw null; });
      controller.abort(0);
      return { exitCode: 0 };
    } });
    try {
      await assert.rejects(shell.exec("V=outer; V=inner cancel-prefix", { signal: controller.signal }), error => Object.is(error, 0));
      assert.deepEqual(cleanups, [1, 2]);
      assert.deepEqual(observed, [{ value: "outer", rootClosed: false }]);
      assert.equal(rootClosed, true);
    } finally { await shell.dispose(); }
  });
}

test("superseded middleware overlays release their saved scalar ownership", async context => {
  const { shell } = setup({ limits: { maxExpansionBytes: 512 } });
  const retained: number[] = [];
  const simple = Runtime.prototype.simple;
  context.mock.method(Runtime.prototype, "simple", async function (this: Runtime, ...args: Parameters<Runtime["simple"]>) {
    const result = await simple.apply(this, args);
    if (args[0].words.some(word => word.plain === "f")) retained.push(stateMonitor(args[1])!.values.arena.usage.bytes);
    return result;
  });
  shell.use((command, next) => {
    if (command.command === "f") Object.assign(command, { env: { ...command.env, V: "m".repeat(20) } });
    return next();
  });
  try {
    const result = await shell.exec(`V=${"o".repeat(20)}; f() { V=${"g".repeat(20)}; }; f; f; f`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(retained, [40, 40, 40]);
  } finally { await shell.dispose(); }
});

test("normal completion seals saved registration and invoke before input acquisition", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let saved!: CommandContext;
  let acquisitions = 0;
  commands.register({ name: "save", execute(context) { saved = context; return { exitCode: 0 }; } });
  await shell.exec("save");
  assert.equal(saved.signal.aborted, false);
  assert.throws(() => saved.registerCleanup!(() => {}), Error);
  await assert.rejects(saved.invoke!("pass", [], { stdin: { [Symbol.asyncIterator]() {
    acquisitions++;
    return { async next() { return { done: true, value: undefined }; } };
  } } }));
  assert.equal(acquisitions, 0);
  await shell.dispose();
});

for (const first of ["read", "return", "throw"] as const) {
  test(`closed descriptor source preserves iterator ${first} semantics`, async () => {
    const { shell, commands } = setup();
    commands.register({ name: "closed-input", async execute(context) {
      const iterator = context.stdin[Symbol.asyncIterator]();
      if (first === "read") await assert.rejects(iterator.next(), { code: "EBADF", message: "Bad file descriptor" });
      else if (first === "return") assert.deepEqual(await iterator.return!(), { done: true, value: undefined });
      else await assert.rejects(iterator.throw!(0), error => Object.is(error, 0));
      assert.deepEqual(await iterator.next(), { done: true, value: undefined });
      const independent = context.stdin[Symbol.asyncIterator]();
      await assert.rejects(independent.next(), { code: "EBADF", message: "Bad file descriptor" });
      return { exitCode: 0 };
    } });
    try {
      const result = await shell.exec("closed-input 0<&-");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("closed descriptor return awaits its value and serializes later reads", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  commands.register({ name: "closed-return", async execute(context) {
    const iterator = context.stdin[Symbol.asyncIterator]();
    const release = deferred<Uint8Array>(), value = Uint8Array.of(0, 255);
    let returned = false, advanced = false;
    const returning = iterator.return!(release.promise).finally(() => { returned = true; });
    const next = iterator.next().finally(() => { advanced = true; });
    try {
      await turn();
      assert.equal(returned, false);
      assert.equal(advanced, false);
    } finally { release.resolve(value); }
    const result = await returning;
    assert.equal(result.done, true);
    assert.equal(result.value, value);
    assert.deepEqual(await next, { done: true, value: undefined });
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("closed-return 0<&-");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("all redirected inputs close and retain both falsey failures", { timeout: 2000 }, async context => {
  const { shell, fs } = setup();
  await fs.writeFile("/first", new Uint8Array());
  await fs.writeFile("/second", new Uint8Array());
  const entered = deferred(), release = deferred();
  const returned: string[] = [];
  context.mock.method(fs, "readStream", (path: string) => ({ [Symbol.asyncIterator]() { return {
    async next() { return { done: true, value: undefined }; },
    async return() {
      returned.push(path);
      if (path === "/second") { entered.resolve(); await release.promise; throw null; }
      throw undefined;
    },
  }; } }));
  let settled = false;
  const pending = shell.exec("true </first </second").finally(() => { settled = true; });
  const checked = assert.rejects(pending, error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [undefined, null]);
    return true;
  });
  try {
    await entered.promise;
    await turn();
    assert.equal(settled, false);
    assert.deepEqual(returned, ["/first", "/second"]);
  } finally { release.resolve(); }
  try { await checked; }
  finally { await shell.dispose(); }
});

test("all cleanup failures survive undefined and null without hiding nonzero results", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const calls: number[] = [];
  commands.register({ name: "fail-cleanup", execute(context) {
    context.registerCleanup?.(() => { calls.push(1); throw undefined; });
    context.registerCleanup?.(async () => { calls.push(2); throw null; });
    context.registerCleanup?.(() => { calls.push(3); });
    return { exitCode: 4 };
  } });
  await assert.rejects(shell.exec("fail-cleanup"), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [undefined, null]);
    return true;
  });
  assert.deepEqual(calls, [1, 2, 3]);
  await shell.dispose();
});

for (const failures of [[undefined], [null], [false], [0], [""], [undefined, null, false, 0, ""]]) {
  test(`cleanup preserves ${failures.length} rejection identities: ${failures.map(String).join(",")}`, { timeout: 2000 }, async () => {
    const { shell, commands } = setup();
    const calls: number[] = [];
    commands.register({ name: "cleanup-identities", execute(context) {
      failures.forEach((failure, index) => context.registerCleanup!(async () => { calls.push(index); throw failure; }));
      return { exitCode: 3 };
    } });
    try {
      await assert.rejects(shell.exec("cleanup-identities; true"), error => {
        if (failures.length === 1) return Object.is(error, failures[0]);
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, failures);
        return true;
      });
      assert.deepEqual(calls, failures.map((_, index) => index));
    } finally { await shell.dispose(); }
  });
}

for (const source of ["seed=; true", "seed=; f() { return 4; }; f", "seed=; cancel-cleanup"]) {
  test(`overlay cleanup failures release all restoration holds: ${source}`, { timeout: 2000 }, async context => {
    const { shell, commands } = setup();
    const controller = new AbortController();
    commands.register({ name: "cancel-cleanup", execute() { controller.abort(0); throw 0; } });
    const holds: Admission[] = [];
    const hold = ArrayOwner.prototype.hold, closeOverlay = StateMonitor.prototype.closeOverlay;
    let closed = 0;
    context.mock.method(ArrayOwner.prototype, "hold", function (this: ArrayOwner) {
      const admission = hold.call(this); holds.push(admission); return admission;
    });
    context.mock.method(StateMonitor.prototype, "closeOverlay", function (this: StateMonitor, ...args: Parameters<StateMonitor["closeOverlay"]>) {
      closeOverlay.apply(this, args);
      if (++closed === 1) throw undefined;
      if (closed === 2) throw null;
    });
    try {
      await assert.rejects(shell.exec(source, { signal: controller.signal }), error => {
        if (source.endsWith("cancel-cleanup")) return Object.is(error, 0);
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [undefined, null]);
        return true;
      });
      assert.ok(holds.length > 0);
      assert.ok(holds.every(admission => admission.released));
      assert.ok(closed >= 2);
    } finally { await shell.dispose(); }
  });
}

test("dispose closes admissions and shares the active cleanup barrier before plugins", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const entered = deferred();
  const release = deferred();
  let callbacks = 0;
  const events: string[] = [];
  shell.use({ name: "owner", setup() {}, dispose() { events.push("plugin"); } });
  commands.register({ name: "wait", async execute(context) {
    context.registerCleanup?.(async () => { callbacks++; await release.promise; events.push("cleanup"); });
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  const execution = shell.exec("wait").catch(() => { events.push("exec"); });
  await entered.promise;
  let firstDone = false;
  let secondDone = false;
  const first = shell.dispose().then(() => { firstDone = true; });
  const second = shell.dispose().then(() => { secondDone = true; });
  await turn();
  assert.equal(firstDone, false);
  assert.equal(secondDone, false);
  await assert.rejects(shell.exec("true"), /disposed/);
  release.resolve();
  await Promise.all([execution, first, second]);
  assert.equal(callbacks, 1);
  assert.ok(events.indexOf("cleanup") < events.indexOf("plugin"));
});
