import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource, type CommandContext } from "safe-bash-contracts";

test("private LLM command applies explicit byte limits without querying an oversized input", async () => {
  const { createLlmCommand } = await import("./index.js");
  let requests = 0;
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const command = createLlmCommand({ defaultModel: "echo", limits: { maxInputBytes: 2 }, providers: [{
    name: "fixture", models: [{ id: "echo" }], async *complete() { requests++; yield "answer"; },
  }] });
  const context: CommandContext = {
    command: "llm", args: [], fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource("abc"),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  };
  assert.equal((await command.execute(context)).exitCode, 1);
  assert.equal(requests, 0);
  assert.equal(output.length, 0);
  assert.match(Buffer.concat(errors).toString(), /input byte limit exceeded/);
});

test("output byte limit includes final newline and closes the provider", async () => {
  const { createLlmCommand } = await import("./index.js");
  let closed = false;
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const command = createLlmCommand({ defaultModel: "echo", limits: { maxOutputBytes: 2 }, providers: [{
    name: "fixture", models: [{ id: "echo" }], async *complete() {
      try { yield "é"; } finally { closed = true; }
    },
  }] });
  const context: CommandContext = {
    command: "llm", args: [], fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource("hello"),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  };
  assert.equal((await command.execute(context)).exitCode, 1);
  assert.equal(Buffer.concat(output).toString(), "é");
  assert.match(Buffer.concat(errors).toString(), /output byte limit exceeded/);
  assert.equal(closed, true);
});

test("command limits reject unsafe, fractional and negative values at construction", async () => {
  const { createLlmCommand } = await import("./index.js");
  for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createLlmCommand({ providers: [], limits: { maxInputBytes: value } }), /Invalid llm limit/);
    assert.throws(() => createLlmCommand({ providers: [], limits: { maxOutputBytes: value } }), /Invalid llm limit/);
  }
});

test("validated command limits are retained when the caller mutates its configuration", async () => {
  const { createLlmCommand } = await import("./index.js");
  const limits = { maxInputBytes: 2 };
  let requests = 0;
  const errors: Uint8Array[] = [];
  const command = createLlmCommand({ defaultModel: "echo", limits, providers: [{
    name: "fixture", models: [{ id: "echo" }], async *complete() { requests++; yield "answer"; },
  }] });
  limits.maxInputBytes = 10;
  const context: CommandContext = {
    command: "llm", args: [], fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource("abc"),
    stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  };
  assert.equal((await command.execute(context)).exitCode, 1);
  assert.equal(requests, 0);
  assert.match(Buffer.concat(errors).toString(), /input byte limit exceeded/);
});
