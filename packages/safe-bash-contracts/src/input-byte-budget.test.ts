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
