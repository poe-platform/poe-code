import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Volume, createFsFromVolume } from "memfs";
const own = await import("../dist/index.js"),
  original = await import("../../agent-spawn/dist/index.js");
const volume = new Volume(),
  memory = createFsFromVolume(volume),
  calls = [];
for (const key of ["existsSync", "readFileSync", "mkdirSync", "openSync", "writeSync", "closeSync"])
  mock.method(fs, key, memory[key].bind(memory));
mock.method(childProcess, "spawn", (command, args, options) => {
  const child = new EventEmitter();
  child.pid = undefined;
  child.unref = () => {};
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    child.emit("close", 1, signal);
    return true;
  };
  let input = "";
  child.stdin.on("data", (chunk) => {
    input += chunk;
  });
  calls.push({ command, args, options, child, input: () => input });
  setImmediate(() => {
    child.stdout.end("done\n");
    child.stderr.end("progress\n");
    child.emit("close", 0, null);
  });
  return child;
});
syncBuiltinESMExports();
test("spawn keeps cyclic host callbacks and middleware outside native DTOs", async () => {
  for (const api of [original, own]) {
    const tee = {
      output: "",
      write(chunk) {
        this.output += chunk;
      }
    };
    tee.self = tee;
    const sink = {
      startSpan() {
        return { setAttribute() {}, addEvent() {}, end() {} };
      },
      recordException() {}
    };
    sink.self = sink;
    const result = await api.spawn("codex", {
      prompt: "secret",
      cwd: "/work",
      useStdin: true,
      tee: { stdout: tee },
      otelSink: sink,
      signal: new AbortController().signal
    });
    assert.deepEqual(result, { stdout: "done\n", stderr: "progress\n", exitCode: 0 });
    assert.equal(tee.output, "done\n");
    assert.equal(calls.at(-1).input(), "secret");
  }
});
test("spawn appends both channels and applies exact safe filename precedence", async () => {
  for (const api of [original, own]) {
    volume.reset();
    calls.length = 0;
    volume.fromJSON({ "/logs/out.log": "previous\n" });
    let result = await api.spawn("codex", {
      prompt: "p",
      cwd: "/work",
      logPath: "/logs/out.log",
      logDir: "/other",
      logFileName: "ignored"
    });
    assert.equal(result.logFile, "/logs/out.log");
    assert.equal(memory.readFileSync(result.logFile, "utf8"), "previous\ndone\nprogress\n");
    for (const name of ["../escape", "..\\escape", "/absolute", "C:\\absolute", ""]) {
      result = await api.spawn("codex", {
        prompt: "p",
        cwd: "/work",
        logDir: "/logs",
        logFileName: name
      });
      assert.equal(Object.hasOwn(result, "logFile"), false);
    }
    result = await api.spawn("codex", {
      prompt: "p",
      cwd: "/work",
      logDir: "/logs",
      logFileName: "valid.jsonl"
    });
    assert.equal(result.logFile, "/logs/valid.jsonl");
    assert.equal(memory.readFileSync(result.logFile, "utf8"), "done\nprogress\n");
  }
});
test("spawn dry runs redact prompts and create no filesystem or process effects", async () => {
  for (const api of [original, own]) {
    volume.reset();
    calls.length = 0;
    const messages = [];
    const result = await api.spawn(
      "codex",
      { prompt: "private", cwd: "/work", logPath: "/logs/unused" },
      { dryRun: true, logger: { dryRun: (text) => messages.push(text) } }
    );
    assert.deepEqual(result, { stdout: "", stderr: "", exitCode: 0 });
    assert.equal(calls.length, 0);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes("[prompt redacted]"));
    assert.equal(messages[0].includes("private"), false);
    assert.deepEqual(volume.toJSON(), {});
  }
});
