import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTimeoutCommand } from "./index.js";

test("timeout help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createTimeoutCommand().execute({
  command: "timeout", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

test("unlimited timer size still chunks waits at the platform limit", async () => {
 const delays: number[] = [];
 let callback: () => void = () => assert.fail("timer was not armed");
 let now = 0;
 const command = createTimeoutCommand({
  maxTimerMilliseconds: Infinity,
  scheduler: {
   now: () => now,
   setTimeout(fn, delay) { callback = fn; delays.push(delay); return delays.length; },
   clearTimeout() {},
  },
 });
 const result = await command.execute({
  command: "timeout", args: ["2147484", "child"], cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write() {} }, stderr: { async write() {} },
  signal: new AbortController().signal,
  async invoke(_name, _args, options) {
   assert.deepEqual(delays, [2147483647]);
   now = 2147483647;
   callback();
   assert.deepEqual(delays, [2147483647, 353]);
   now += 353;
   callback();
   throw options!.signal!.reason;
  },
 });
 assert.equal(result.exitCode, 124);
});
