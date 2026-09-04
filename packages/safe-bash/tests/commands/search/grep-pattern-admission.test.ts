import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { bufferLimit } from "../../../src/commands/internal.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import type { RegexWorkerRequest } from "../../../src/commands/regex-execution/provider.js";
import { createGrepCommands } from "../../../src/commands/search/grep.js";

async function run(args: readonly string[], overrides: Partial<CommandContext> = {}) {
  const messages: RegexWorkerRequest[] = [];
  const workers: EventEmitter[] = [];
  let terminated = 0;
  const executor = new RegexExecutor({ createWorker() {
    const worker = new EventEmitter();
    workers.push(worker);
    queueMicrotask(() => worker.emit("message", { ready: true }));
    return Object.assign(worker, {
      postMessage(request: RegexWorkerRequest) {
        messages.push(request);
        queueMicrotask(() => worker.emit("message", { id: request.id, results: request.rows.map(() => new Float64Array()) }));
      },
      async terminate() { terminated++; },
    });
  } });
  const errors: Uint8Array[] = [];
  const context: CommandContext = {
    command: "grep", args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdinIsDefault: false, stdin: toByteSource(""),
    stdout: { async write() { assert.fail("admission fixture must not produce output"); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } }, ...overrides,
  };
  try {
    const result = await createGrepCommands(executor)[0]!.execute(context);
    return { code: result.exitCode, stderr: Buffer.concat(errors).toString(), messages, created: workers.length };
  } finally {
    await executor.dispose();
    assert.equal(terminated, workers.length);
    for (const worker of workers) assert.deepEqual(worker.eventNames(), []);
  }
}

test("grep rejects the modest pattern-file spread reproduction before dispatch", { timeout: 5000 }, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/patterns", Buffer.from("x\n".repeat(131072)));
  let consumed = false;
  const stdin = (async function* () { consumed = true; yield Buffer.from("subject"); })();
  const result = await run(["-f", "/patterns"], { fs, stdin });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /pattern count limit exceeded/u);
  assert.equal(result.created, 0);
  assert.equal(consumed, false);
});

test("grep count admission stops and closes pattern stdin before reading later chunks", { timeout: 5000 }, async () => {
  let closed = false;
  let reads = 0;
  const stdin = (async function* () {
    try {
      reads++; yield Buffer.from("\n".repeat(1025));
      reads++; yield Buffer.from("must not read");
    } finally { closed = true; }
  })();
  const result = await run(["-f", "-"], { stdin });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /pattern count limit exceeded/u);
  assert.equal(result.created, 0);
  assert.equal(reads, 1);
  assert.equal(closed, true);
});

test("grep count ceiling is cumulative across explicit options and files", { timeout: 5000 }, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("x\n".repeat(512)));
  await fs.writeFile("/second", Buffer.from("x\n".repeat(512)));
  const result = await run(["-e", "", "-f", "/first", "-f", "/second"], { fs });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /pattern count limit exceeded/u);
  assert.equal(result.created, 0);
});

test("grep admits exactly 1024 patterns without a trailing phantom pattern", { timeout: 5000 }, async () => {
  for (const ending of ["", "\n"]) {
    const result = await run(["-e", "x\n".repeat(1023) + "x" + ending]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(result.messages[0]!.descriptor.kind, "grep");
    assert.equal((result.messages[0]!.descriptor as { patterns: readonly string[] }).patterns.length, 1024);
  }
});

test("grep positional multiline patterns obey count admission", { timeout: 5000 }, async () => {
  const result = await run(["x\n".repeat(1025)]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /pattern count limit exceeded/u);
  assert.equal(result.created, 0);
});

test("grep counts repeated empty options and unterminated patterns across chunks", { timeout: 5000 }, async () => {
  const repeated = await run(Array.from({ length: 2050 }, (_value, index) => index % 2 ? "" : "-e"));
  assert.equal(repeated.code, 2);
  assert.match(repeated.stderr, /pattern count limit exceeded/u);
  assert.equal(repeated.created, 0);
  const stdin = (async function* () {
    yield Buffer.from("\n".repeat(1023));
    yield Buffer.from("x");
    yield new Uint8Array();
    yield Buffer.from("\n");
    yield Buffer.from("overflow");
  })();
  const split = await run(["-f", "-"], { stdin });
  assert.equal(split.code, 2);
  assert.match(split.stderr, /pattern count limit exceeded/u);
  assert.equal(split.created, 0);
});

test("grep preserves empty files, empty options, CR, NUL and split raw bytes", { timeout: 5000 }, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  const chunks = [Buffer.from([0xff]), new Uint8Array(), Buffer.from([13, 10, 10, 0, 0xfe])];
  const stdin = (async function* () { for (const chunk of chunks) yield chunk; })();
  const result = await run(["-e", "", "-e", "é\n", "-f", "/empty", "-f", "-"], { fs, stdin });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual((result.messages[0]!.descriptor as { patterns: readonly string[] }).patterns, ["", "\xc3\xa9", "\xff\r", "", "\0\xfe"]);
});

test("grep owns retained fragments from a reused pattern input buffer", { timeout: 5000 }, async () => {
  const chunk = Buffer.from("a");
  const stdin = (async function* () { yield chunk; chunk[0] = 98; yield chunk; chunk[0] = 99; })();
  const result = await run(["-f", "-"], { stdin });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual((result.messages[0]!.descriptor as { patterns: readonly string[] }).patterns, ["ab"]);
});

test("grep cumulatively rejects oversized pattern bytes before dispatch", { timeout: 5000 }, async () => {
  let closed = false;
  const oversized = new Uint8Array(bufferLimit);
  const stdin: ByteSource = (async function* () { try { yield oversized; } finally { closed = true; } })();
  const result = await run(["-e", "é", "-f", "-"], { stdin });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /pattern byte limit exceeded/u);
  assert.equal(result.created, 0);
  assert.equal(closed, true);
});

for (const excess of [0, 1]) test(`grep cumulative UTF-8 byte boundary plus ${excess}`, { timeout: 10000 }, async () => {
  const chunk = Buffer.alloc(32768, 120);
  chunk[chunk.length - 1] = 10;
  let closed = false;
  const stdin = (async function* () {
    try {
      for (let index = 0; index < 1022; index++) yield chunk;
      yield Buffer.alloc(65534, 120);
      if (excess) yield Buffer.from("x");
    } finally { closed = true; }
  })();
  const result = await run(["-F", "-e", "é", "-f", "-"], { stdin });
  assert.equal(result.code, excess ? 2 : 1);
  assert.equal(result.created, excess ? 0 : 1);
  assert.equal(closed, true);
  if (excess) assert.match(result.stderr, /pattern byte limit exceeded/u);
  else {
    assert.equal(result.stderr, "");
    const patterns = (result.messages[0]!.descriptor as { patterns: readonly string[] }).patterns;
    assert.equal(patterns.length, 1024);
    assert.equal(patterns.reduce((total, pattern) => total + pattern.length, 0) + 1022, bufferLimit);
  }
});

test("grep rejects oversized UTF-8 argv before reading pattern files", { timeout: 5000 }, async () => {
  const result = await run(["-e", "é".repeat(bufferLimit / 2 + 1), "-f", "/must-not-open"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /pattern byte limit exceeded/u);
  assert.equal(result.created, 0);
});

test("grep preserves cancellation while reading patterns without provider dispatch", { timeout: 5000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel pattern input");
  let closed = false;
  const stdin = (async function* () {
    try { yield Buffer.from("x"); controller.abort(reason); yield Buffer.from("y"); }
    finally { closed = true; }
  })();
  await assert.rejects(run(["-f", "-"], { stdin, signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
});
