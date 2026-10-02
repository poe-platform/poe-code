import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { FileSystem } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { Runtime } from "../../src/shell/runtime.js";

function fixture(context: TestContext, backgroundJobs = false, fs = new MemoryFileSystem()) {
  const shell = new Shell({ fs, deviceView: "provided", backgroundJobs, limits: { maxCommands: 64 } });
  context.after(() => shell.dispose());
  const seen: FileSystem[] = [];
  const prototype = Runtime.prototype as unknown as {
    getContextFsFor(mask: number, signal: AbortSignal): FileSystem;
  };
  const original = prototype.getContextFsFor;
  context.mock.method(prototype, "getContextFsFor", function(this: Runtime, mask: number, signal: AbortSignal) {
    const fs = original.call(this, mask, signal);
    seen.push(fs);
    return fs;
  });
  return { shell, seen, async rootScope(target = shell) {
    const before = seen.length;
    const result = await target.exec("cd /");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(seen.length, before + 1);
    return seen[before]!;
  } };
}

for (const source of ["probe | probe", "(probe)", "probe & wait", ": $(probe)", "invoke"]) {
  test(`child filesystem scopes leave a cold reusable scope available after ${source}`, async context => {
    const { shell, rootScope, seen } = fixture(context, true);
    shell.commands.register({ name: "probe", execute({ fs }) { void fs.capabilities; return { exitCode: 0 }; } });
    shell.commands.register({ name: "invoke", execute(context) { return context.invoke!("probe", []); } });
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    const childScopes = seen.slice();
    assert.ok(childScopes.length > 0);
    const first = await rootScope();
    assert.ok(childScopes.every(scope => scope !== first));
    assert.equal(await rootScope(), first);
  });

  test(`child filesystem scopes do not disable reuse after ${source}`, async context => {
    const { shell, rootScope } = fixture(context, true);
    shell.commands.register({ name: "probe", execute({ fs }) { void fs.capabilities; return { exitCode: 0 }; } });
    shell.commands.register({ name: "invoke", execute(context) { return context.invoke!("probe", []); } });
    const first = await rootScope();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await rootScope(), first);
    assert.equal(await rootScope(), first);
  });
}

for (const failure of ["abort", "budget", "command", "cleanup"] as const) {
  test(`filesystem reuse survives ${failure} failure after claiming the root scope`, async context => {
    const { shell, rootScope } = fixture(context);
    const controller = new AbortController();
    const reason = new Error(failure);
    shell.register({ name: "fail", async execute({ fs, registerCleanup }) {
      if (failure === "abort") { controller.abort(reason); throw reason; }
      if (failure === "budget") await fs.stat("/");
      if (failure === "command") throw reason;
      if (failure === "cleanup") registerCleanup!(() => { throw reason; });
      return { exitCode: 0 };
    } });
    const first = await rootScope();
    const execution = shell.exec("cd /; fail", {
      signal: controller.signal,
      ...(failure === "budget" ? { limits: { maxFileSystemOperations: 1 } } : {}),
    });
    if (failure === "command") {
      const result = await execution;
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stderr, "shell: line 1: internal error\n");
    } else {
      await assert.rejects(execution, error => failure === "budget"
        ? error instanceof ShellLimitError && error.limit === "maxFileSystemOperations"
        : error === reason || error instanceof AggregateError && error.errors.includes(reason));
    }
    assert.equal(await rootScope(), first);
    assert.equal(await rootScope(), first);
  });
}

test("filesystem reuse survives stdin finalization failure", async context => {
  const { shell, rootScope } = fixture(context);
  const reason = new Error("input cleanup");
  const first = await rootScope();
  const stdin = {
    [Symbol.asyncIterator]() {
      return {
        async next() { return { done: false as const, value: new Uint8Array([120]) }; },
        async return(): Promise<IteratorResult<Uint8Array>> { throw reason; },
      };
    },
  };
  await assert.rejects(shell.exec("cd /; read -n 1 value", { stdin }), error => error === reason);
  assert.equal(await rootScope(), first);
});

test("another invocation cannot release an active filesystem scope", async context => {
  const { shell, rootScope } = fixture(context);
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  shell.register({ name: "hold", async execute({ registerCleanup }) {
    registerCleanup!(async () => { entered(); await pending; });
    return { exitCode: 0 };
  } });
  const first = await rootScope();
  const active = shell.exec("cd /; hold");
  try {
    await started;
    assert.notEqual(await rootScope(), first);
    assert.notEqual(await rootScope(), first);
  } finally {
    release();
    assert.equal((await active).exitCode, 0);
  }
  assert.equal(await rootScope(), first);
});

test("aborted invocations keep the filesystem scope until cooperative cleanup finishes", async context => {
  const { shell, rootScope } = fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel during cleanup");
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  shell.register({ name: "hold", async execute({ registerCleanup }) {
    registerCleanup!(async () => { entered(); await pending; });
    return { exitCode: 0 };
  } });
  const first = await rootScope();
  const active = shell.exec("cd /; hold", { signal: controller.signal });
  const outcome = assert.rejects(active, error => error === reason);
  try {
    await started;
    controller.abort(reason);
    await setImmediate();
    assert.notEqual(await rootScope(), first);
  } finally {
    release();
    await outcome;
  }
  assert.equal(await rootScope(), first);
});

for (const warmed of [false, true]) {
  test(`disposing a shell drains cleanup before another shell reuses its scope (warmed=${warmed})`, async context => {
    const fs = new MemoryFileSystem();
    const { shell, rootScope } = fixture(context, false, fs);
    const next = new Shell({ fs, deviceView: "provided" });
    context.after(() => next.dispose());
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    shell.commands.register({ name: "hold", async execute({ registerCleanup }) {
      registerCleanup!(async () => { entered(); await pending; });
      return { exitCode: 0 };
    } });
    const first = await rootScope();
    if (warmed) await shell.exec("");
    const active = shell.exec("cd /; hold");
    const outcome = assert.rejects(active, error => error instanceof Error && error.message === "Shell is disposed");
    await started;
    const disposal = shell.dispose();
    try {
      await setImmediate();
      assert.notEqual(await rootScope(next), first);
    } finally {
      release();
      await Promise.all([outcome, disposal]);
    }
    assert.equal(await rootScope(next), first);
  });
}

for (const [name, source, fails] of [
  ["command completion", "cd /", false],
  ["input EOF", "cd /; read value", false],
  ["command limit", `cd /; ${Array(70).fill(":").join("; ")}`, true],
  ["loop limit", "cd /; while :; do :; done", true],
] as const) {
  test(`warmed execution releases its filesystem scope after ${name}`, async context => {
    const { shell, rootScope, seen } = fixture(context);
    const first = await rootScope();
    await shell.exec("");
    const before = seen.length;
    const execution = shell.exec(source);
    if (fails) {
      await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxCommands");
    } else {
      const result = await execution;
      assert.equal(result.exitCode, source.includes("read") ? 1 : 0, result.stderr);
    }
    assert.equal(seen[before], first);
    assert.equal(await rootScope(), first);
  });
}
