import assert from "node:assert/strict";
import test from "node:test";
import { createPathchkCommand } from "./index.js";

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { type CommandContext, createCommandArguments, shellValueFromBytes } from "safe-bash-contracts";

function fixture(args: string[] = [], input = "abcdef") {
  let diagnostic = "";
  const context: CommandContext = {
    command: "pathchk", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(input); } },
    stdout: { async write() {} },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } },
    signal: new AbortController().signal,
  };
  return { context, diagnostic: () => diagnostic };
}

test("pathchk propagates cancellation from filesystem calls", async () => {
  const run = fixture(["a/b"]);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const context = { ...run.context, signal: controller.signal };
  context.fs.stat = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(async () => createPathchkCommand().execute(context), (error: unknown) => error === reason);
});

test("pathchk validates byte argument identity", async () => {
  const run = fixture(["shown"]);
  const values = createCommandArguments(["different"]);
  await assert.rejects(async () => createPathchkCommand().execute({ ...run.context, argumentValues: values }));
});

test("pathchk allows timer cancellation with a frozen clock and no setImmediate", async () => {
  const run = fixture(Array.from({ length: 2048 }, () => "name"), "x\n".repeat(4096));
  const controller = new AbortController();
  const reason = new Error("timer cancellation");
  const context = { ...run.context, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { for (let i = 0; i < 2048; i++) yield new Uint8Array(); } } };
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  const clock = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "setImmediate", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => 0 } });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(async () => createPathchkCommand().execute(context), (error: unknown) => error === reason); }
  finally {
    clearTimeout(timer);
    Object.defineProperty(globalThis, "setImmediate", immediate!);
    Object.defineProperty(globalThis, "performance", clock!);
  }
});

test("pathchk admits original argument bytes rather than replacement UTF-8", async () => {
  const run = fixture();
  const carrier = createCommandArguments([shellValueFromBytes(new Uint8Array([255]))]);
  assert.equal((await createPathchkCommand({ limits: { maxArgumentBytes: 1 } }).execute({ ...run.context, args: carrier.args, argumentValues: carrier })).exitCode, 0);
});

test("pathchk component limits count original bytes", async () => {
  const run = fixture();
  const carrier = createCommandArguments([shellValueFromBytes(new Uint8Array(100).fill(255))]);
  assert.equal((await createPathchkCommand().execute({ ...run.context, args: carrier.args, argumentValues: carrier })).exitCode, 0);
});
