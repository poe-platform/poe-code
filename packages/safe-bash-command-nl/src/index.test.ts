import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createNlCommand } from "./index.js";

test("nl help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createNlCommand().execute({
  command: "nl", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});


test("nl admits every batched section delimiter before buffering", async t => {
 const { Session } = await import("safe-bash-text-stream-engine/stream-format/shared");
 const admitted = t.mock.method(Session.prototype, "admitOutput");
 const values = createCommandArguments([]);
 let output = "";
 const result = await createNlCommand().execute({
  command: "nl", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("\\:\n\\:\n\\:\n"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write() {} }, signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0);
 assert.equal(output, "\n\n\n");
 // Three admissions before buffering, plus the first one-byte flush.
 assert.equal(admitted.mock.calls.filter(call => call.arguments[0] === 1).length, 4);
});
