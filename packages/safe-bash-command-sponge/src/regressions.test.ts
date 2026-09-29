import assert from "node:assert/strict";
import test from "node:test";
import { createSpongeCommand } from "./index.js";

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { type CommandContext, createCommandArguments } from "safe-bash-contracts";

function fixture(args: string[] = [], input = "abcdef") {
  let diagnostic = "";
  const context: CommandContext = {
    command: "sponge", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(input); } },
    stdout: { async write() {} },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } },
    signal: new AbortController().signal,
  };
  return { context, diagnostic: () => diagnostic };
}

test("sponge propagates filesystem output budget failures", async () => {
  const run = fixture(["output"]);
  const failure = Object.assign(new Error("budget exceeded"), { name: "BudgetExceededError" });
  run.context.fs.writeFile = async () => { throw failure; };
  await assert.rejects(async () => createSpongeCommand().execute(run.context), (error: unknown) => error === failure);
  assert.equal(run.diagnostic(), "");
});

test("sponge propagates cancellation from filesystem calls", async () => {
  const run = fixture(["output"]);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const context = { ...run.context, signal: controller.signal };
  context.fs.writeFile = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(async () => createSpongeCommand().execute(context), (error: unknown) => error === reason);
});

test("sponge validates byte argument identity", async () => {
  const run = fixture(["shown"]);
  const values = createCommandArguments(["different"]);
  await assert.rejects(async () => createSpongeCommand().execute({ ...run.context, argumentValues: values }));
});

test("sponge allows timer cancellation with a frozen clock and no setImmediate", async () => {
  const run = fixture([], "x\n".repeat(4096));
  const controller = new AbortController();
  const reason = new Error("timer cancellation");
  const context = { ...run.context, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { for (let i = 0; i < 2048; i++) yield new Uint8Array(); } } };
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  const clock = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "setImmediate", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => 0 } });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(async () => createSpongeCommand().execute(context), (error: unknown) => error === reason); }
  finally {
    clearTimeout(timer);
    Object.defineProperty(globalThis, "setImmediate", immediate!);
    Object.defineProperty(globalThis, "performance", clock!);
  }
});

test("sponge append does not swallow cancellation while reading the existing target", async () => {
  const run = fixture(["-a", "output"]);
  const controller = new AbortController();
  const reason = new Error("append cancelled");
  run.context.fs.readFile = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(async () => createSpongeCommand().execute({ ...run.context, signal: controller.signal }), (error: unknown) => error === reason);
});
