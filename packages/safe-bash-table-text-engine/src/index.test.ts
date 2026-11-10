import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, command, encode, fail, OrderCheck, RecordReader, settings } from "./table-text/internal.js";
test("table readers enforce configured record ceilings", () => { assert.equal(settings({ limits: { maxRecordBytes: 8 } }).maxRecordBytes, 8); assert.throws(() => settings({ limits: { maxRecordBytes: -1 } }), RangeError); });

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, FsError, toByteSource, type CommandContext } from "safe-bash-contracts";

function capture() {
 let output = "";
 const values = createCommandArguments([]);
 const sink = { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } };
 const context: CommandContext = {
  command: "comm", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""), stdout: sink, stderr: sink,
  signal: new AbortController().signal,
 };
 return { context, output: () => output };
}

test("command error handling flushes buffered output before diagnostics", async () => {
 const result = capture();
 const definition = command("comm", settings({}), async (_context, budget) => {
  await budget.output([encode("first\n")]);
  await budget.output([encode("second\n")]);
  fail("failure");
 });
 assert.equal((await definition.execute(result.context)).exitCode, 1);
 assert.ok(result.output().startsWith("first\nsecond\ncomm: "), result.output());
});

test("order summary flushes output produced after the first warning", async () => {
 const result = capture();
 const budget = new Budget(result.context, settings({}));
 const order = new OrderCheck("default", result.context, budget);
 await order.markUnpaired();
 await order.check(encode("b"), encode("a"), 1);
 await budget.output([encode("first\n")]);
 await budget.output([encode("second\n")]);
 await order.finish();
 assert.ok(result.output().endsWith("first\nsecond\ncomm: input is not in sorted order\n"), result.output());
});

test("record readers still throw read errors without a handler", async () => {
 const { context } = capture();
 const error = new FsError("EIO");
 const reader = new RecordReader((async function* () {
  yield encode("partial");
  throw error;
 })(), 10, new Budget(context, settings({})), context.signal);
 await assert.rejects(async () => reader.next(), caught => caught === error);
 await reader.close();
});

test("record read error handlers cannot suppress cancellation", async () => {
 const { context } = capture();
 const controller = new AbortController();
 const reason = new Error("cancel");
 let handled = false;
 const reader = new RecordReader((async function* () {
  yield encode("partial");
  controller.abort(reason);
  throw reason;
 })(), 10, new Budget(context, settings({})), controller.signal, () => { handled = true; });
 await assert.rejects(async () => reader.next(), caught => caught === reason);
 assert.equal(handled, false);
 await reader.close();
});

test("record read error handlers cannot suppress resource limits", async () => {
 for (const limits of [{ maxInputBytes: 2 }, { maxRecordBytes: 2 }]) {
  const { context } = capture();
  let handled = false;
  const reader = new RecordReader(toByteSource("partial"), 10,
   new Budget(context, settings({ limits })), context.signal, () => { handled = true; });
  await assert.rejects(async () => reader.next(), error => error instanceof FsError && error.code === "EFBIG");
  assert.equal(handled, false);
  await reader.close();
 }
});
