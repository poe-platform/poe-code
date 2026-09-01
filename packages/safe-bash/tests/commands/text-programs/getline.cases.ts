import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource } from "../../../src/contracts/index.js";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";
import { makeFileSystem, runVirtual } from "./helpers.js";

test("getline retains execution and record buffer limits instead of converting them to I/O status", async () => {
  const actual = await runVirtual("awk", { args: ['BEGIN{print (getline value < "extra")}'], files: { extra: "x".repeat(256) } }, { maxBufferBytes: 64 });
  assert.equal(actual.exitCode, 2);
  assert.match(actual.stderr.toString(), /buffer limit/u);
  assert.equal(actual.stdout.length, 0);
});

test("getline rejects an empty filename instead of reporting successful EOF", async () => {
  const actual = await runVirtual("awk", { args: ['BEGIN{getline value < ""}'] });
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stdout.length, 0);
});

test("getline bounds retained file cursors and close permits reuse", async () => {
  const files = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`input-${index}`, "value\n"]));
  const exhausted = await runVirtual("awk", { args: ['BEGIN{for(fileIndex=0;fileIndex<257;fileIndex++)getline value < ("input-" fileIndex)}'], files });
  assert.equal(exhausted.exitCode, 2);
  assert.match(exhausted.stderr.toString(), /open-file limit/u);
  const reused = await runVirtual("awk", { args: ['BEGIN{for(fileIndex=0;fileIndex<257;fileIndex++){file="input-" fileIndex;getline value < file;close(file)}print value}'], files });
  assert.equal(reused.exitCode, 0, reused.stderr.toString());
  assert.equal(reused.stdout.toString(), "value\n");
});

test("getline closes partial files on successful early exit", async () => {
  const fs = await makeFileSystem();
  let closed = false;
  fs.readStream = async function* () {
    try { yield Buffer.from("first\n"); yield Buffer.from("second\n"); }
    finally { closed = true; }
  };
  const definition = createTextProgramCommands().find(command => command.name === "awk")!;
  const result = await definition.execute({ command: "awk", args: ['BEGIN{getline value < "extra";exit}'], cwd: "/work", env: {}, fs,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal });
  assert.equal(result.exitCode, 0);
  assert.equal(closed, true);
});

test("getline cancels blocked host reads and observes their eventual rejection", { timeout: 2000 }, async () => {
  const fs = await makeFileSystem();
  const controller = new AbortController();
  const reason = new Error("cancel getline");
  let rejectRead: ((error: Error) => void) | undefined;
  fs.readStream = async function* () {
    await new Promise<void>((_resolve, reject) => { rejectRead = reject; });
    yield Buffer.from("unused\n");
  };
  const definition = createTextProgramCommands().find(command => command.name === "awk")!;
  const timer = setTimeout(() => controller.abort(reason), 10);
  try {
    await assert.rejects(async () => definition.execute({ command: "awk", args: ['BEGIN{getline value < "extra"}'], cwd: "/work", env: {}, fs,
      stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} }, signal: controller.signal }), error => error === reason);
  } finally {
    clearTimeout(timer);
    rejectRead?.(new Error("late host rejection"));
  }
});
