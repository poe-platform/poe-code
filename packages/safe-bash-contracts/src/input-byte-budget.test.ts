import assert from "node:assert/strict";
import test from "node:test";
import { InputByteBudget } from "./io.js";

test("input budget counts cumulatively and retains a failure caught by operand probes", () => {
  const budget = new InputByteBudget(3);
  budget.charge(2);
  assert.throws(() => budget.charge(2), /input byte limit/);
  assert.throws(() => budget.assertOpen(), /input byte limit/);
});

test("input budget yields under frozen clocks and observes timer aborts", async () => {
  const controller = new AbortController();
  const original = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  Object.defineProperty(globalThis, "setImmediate", { value: undefined, configurable: true });
  const now = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", { value: () => 0, configurable: true });
  try {
    const budget = new InputByteBudget(Infinity);
    const timer = setTimeout(() => controller.abort(new Error("timer abort")), 0);
    try {
      await assert.rejects(async () => {
        for await (const chunk of budget.read((async function* () {
          for (let i = 0; i < 10000; i++) yield new Uint8Array();
        })(), controller.signal)) void chunk;
      }, /timer abort/);
    } finally { clearTimeout(timer); }
  } finally {
    if (original) Object.defineProperty(globalThis, "setImmediate", original);
    if (now) Object.defineProperty(performance, "now", now);
    else Reflect.deleteProperty(performance, "now");
  }
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { retainFileSystemCleanup, scopeFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "./command.js";

test("command input budgeting never overrides methods on a scoped filesystem proxy", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/in", new Uint8Array([65]));
  const fs = new Proxy(memory, {
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  });
  const originalRead = fs.readFile;
  await new InputByteBudget(1).run({
    command: "probe", args: createCommandArguments([]).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), stdout: { write: async () => {} }, stderr: { write: async () => {} },
    signal: new AbortController().signal,
  }, async limited => {
    assert.equal(fs.readFile, originalRead);
    assert.deepEqual(await limited.fs.readFile("/in"), new Uint8Array([65]));
    return { exitCode: 0 };
  });
});


test("host input ceilings account retained reads together with buffered files and stdin", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", Uint8Array.of(65, 66));
  const observed: number[] = [];
  const budget = new InputByteBudget(Infinity, { maxBytes: 5, check(total) {
    observed.push(total);
    if (total > 5) throw new Error("host input exceeded");
  } });
  await assert.rejects(budget.run({
    command: "probe", args: createCommandArguments([]).args, cwd: "/", env: {}, fs,
    stdin: (async function* () { yield Uint8Array.of(67, 68); })(),
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
    signal: new AbortController().signal,
  }, async limited => {
    const handle = await limited.fs.openReadFile!("/in");
    try { assert.deepEqual(await handle.read(0, 2), Uint8Array.of(65, 66)); }
    finally { await handle.close(); }
    assert.deepEqual(await limited.fs.readFile("/in"), Uint8Array.of(65, 66));
    for await (const chunk of limited.stdin) void chunk;
    return { exitCode: 0 };
  }), /host input exceeded/);
  assert.deepEqual(observed, [2, 4, 6]);
});

test("host budget failures survive command error handlers", async () => {
  const failure = new Error("host budget exceeded");
  const budget = new InputByteBudget(Infinity, { maxBytes: 0, check() { throw failure; } });
  assert.throws(() => budget.charge(1), error => error === failure);
  assert.throws(() => budget.assertOpen(), error => error === failure);
});

for (const reason of [false, null, new Error("cancelled")]) {
  test(`input budget preserves retained filesystem cleanup after abort: ${String(reason)}`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/stage", Uint8Array.of(65));
    const controller = new AbortController();
    let cleanupCharges = 0;
    const fs = scopeFileSystem(memory, () => {}, controller.signal, () => { cleanupCharges++; });
    const originalBinding = Reflect.get(fs, Symbol.for("safe-fs.retainedCleanup"));
    let cleanupError: unknown;
    await assert.rejects(new InputByteBudget(1).run({
      command: "probe", args: createCommandArguments([]).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), stdout: { write: async () => {} }, stderr: { write: async () => {} },
      signal: controller.signal,
    }, async limited => {
      const cleanup = retainFileSystemCleanup(limited.fs, view => view.rm("/stage"), { maxOperations: 1 });
      assert.equal(Reflect.get(fs, Symbol.for("safe-fs.retainedCleanup")), originalBinding);
      controller.abort(reason);
      try { await cleanup(); } catch (error) { cleanupError = error; }
      return { exitCode: 0 };
    }), error => error === reason);
    assert.equal(cleanupError, undefined);
    await assert.rejects(memory.lstat("/stage"), { code: "ENOENT" });
    assert.equal(cleanupCharges, 1);
  });
}
