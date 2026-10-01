import assert from "node:assert/strict";
import test from "node:test";
import { createLessCommand, createMoreCommand } from "./index.js";

import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { type CommandContext, createCommandArguments } from "safe-bash-contracts";

function fixture(args: string[] = [], input = "abcdef") {
  let diagnostic = "";
  const context: CommandContext = {
    command: "less", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(input); } },
    stdout: { async write() {} },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } },
    signal: new AbortController().signal,
  };
  return { context, diagnostic: () => diagnostic };
}

test("both pagers diagnose oversized stdin with formatting and explicit stdin", async () => {
  for (const command of [createLessCommand, createMoreCommand]) for (const args of [["-N"], ["-s"], ["+2"], ["+/a"], ["-"]]) {
    const run = fixture(args);
    assert.deepEqual(await command({ maxInputBytes: 2 }).execute(run.context), { exitCode: 1 });
    assert.equal(run.diagnostic(), `${command().name}: input exceeds maximum size of 2 bytes\n`);
  }
});

test("less propagates cancellation from filesystem calls", async () => {
  const run = fixture(["file"]);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const context = { ...run.context, signal: controller.signal };
  context.fs.readFile = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(async () => createLessCommand().execute(context), (error: unknown) => error === reason);
});

test("less validates byte argument identity", async () => {
  const run = fixture(["shown"]);
  const values = createCommandArguments(["different"]);
  await assert.rejects(async () => createLessCommand().execute({ ...run.context, argumentValues: values }));
});

test("less allows timer cancellation with a frozen clock and no setImmediate", async () => {
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
  try { await assert.rejects(async () => createLessCommand().execute(context), (error: unknown) => error === reason); }
  finally {
    clearTimeout(timer);
    Object.defineProperty(globalThis, "setImmediate", immediate!);
    Object.defineProperty(globalThis, "performance", clock!);
  }
});

for (const args of [["-N"], ["-s"], ["+/missing"]]) {
  test(`less yields during formatting/search for ${args.join(" ")}`, async () => {
    const run = fixture(args, "x\n".repeat(4096));
    const controller = new AbortController();
    const reason = new Error("format cancelled");
    // EOF is reached before cancellation: the formatting/search loop must yield.
    const stdin = { async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode("x\n".repeat(4096));
      registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
    } };
    await assert.rejects(async () => createLessCommand().execute({ ...run.context, stdin, signal: controller.signal }), (error: unknown) => error === reason);
  });
}
