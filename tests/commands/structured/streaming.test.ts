import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { structuredCommands } from "../../../src/commands/structured/index.js";
import { FsError, type ByteSource, type ByteSink } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { run } from "./helpers.js";

function pendingSource(first?: string) {
  let reads = 0; let closed = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; if (reads === 1 && first !== undefined) return { done: false as const, value: Buffer.from(first) }; return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    async return() { closed = true; return { done: true as const, value: undefined }; },
  }; } };
  return { source, reads: () => reads, closed: () => closed };
}

test("non-slurp emits before EOF and honors output backpressure", { timeout: 2000 }, async () => {
  const controller = new AbortController(); const reason = new Error("done");
  const input = pendingSource('{"a":1}');
  let emitted!: () => void; const outputReady = new Promise<void>(resolve => { emitted = resolve; });
  const stdout: ByteSink = { async write(chunk) { assert.equal(Buffer.from(chunk).toString(), '{"a":1}\n'); emitted(); await new Promise<void>(() => {}); } };
  const running = run(["-c", "."], input.source, {}, { signal: controller.signal, stdout });
  const rejection = assert.rejects(running, error => error === reason);
  await outputReady; assert.equal(input.reads(), 1); controller.abort(reason); await rejection;
  assert.equal(input.closed(), true);
});

test("slurp and exit-status wait for EOF rather than stopping at false", { timeout: 2000 }, async () => {
  for (const args of [["-sc", "."], ["-ec", "."]]) {
    const controller = new AbortController(); const reason = new Error("stop waiting");
    const input = pendingSource("false\n"); let output = "";
    const running = run(args, input.source, {}, { signal: controller.signal, stdout: { async write(chunk) { output += Buffer.from(chunk).toString(); } } });
    const rejection = assert.rejects(running, error => error === reason);
    await delay(10); assert.equal(input.reads(), 2); assert.equal(output, args[0] === "-sc" ? "" : "false\n");
    controller.abort(reason); await rejection; assert.equal(input.closed(), true);
  }
});

test("cancellation interrupts pending stdin and observes late source rejection", { timeout: 2000 }, async () => {
  const controller = new AbortController(); const reason = new Error("abort input");
  let rejectRead!: (error: Error) => void; let returned = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { return new Promise<IteratorResult<Uint8Array>>((_, reject) => { rejectRead = reject; }); },
    async return() { returned = true; return { done: true as const, value: undefined }; },
  }; } };
  const running = run(["-c", "."], source, {}, { signal: controller.signal });
  const rejection = assert.rejects(running, error => error === reason);
  await delay(5); controller.abort(reason); await rejection; rejectRead(new Error("late")); await delay(0); assert.equal(returned, true);
});

test("pending program/data filesystem reads receive cancellation signal", { timeout: 2000 }, async () => {
  for (const args of [["-f", "/filter"], [".", "/data"]]) {
    const controller = new AbortController(); const reason = new Error("abort fs"); const fs = new MemoryFileSystem();
    const input = pendingSource(); let seen = false;
    fs.readStream = (_, options) => { assert.equal(options?.signal, controller.signal); seen = true; return input.source; };
    const running = run(args, "", {}, { fs, signal: controller.signal });
    const rejection = assert.rejects(running, error => error === reason);
    await delay(5); controller.abort(reason); await rejection; assert.ok(seen); assert.ok(input.closed());
  }
});

test("empty chunk producers still yield for timer-driven cancellation", { timeout: 2000 }, async () => {
  const controller = new AbortController(); const reason = new Error("abort empty chunks"); let closed = false;
  const source = (async function* () { try { while (true) yield new Uint8Array(); } finally { closed = true; } })();
  const timer = setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(run(["-c", "."], source, {}, { signal: controller.signal }), error => error === reason);
  clearTimeout(timer); await delay(0); assert.equal(closed, true);
});

test("closed stdout propagates EPIPE and closes upstream immediately", async () => {
  const input = pendingSource("1\n"); const reason = new FsError("EPIPE", { syscall: "write" });
  await assert.rejects(run(["-c", "."], input.source, {}, { stdout: { async write() { throw reason; } } }), error => error === reason);
  assert.equal(input.reads(), 1); assert.equal(input.closed(), true);
});

test("abort interrupts stalled iterator return and ignores its late rejection", { timeout: 2000 }, async () => {
  const controller = new AbortController(); const reason = new Error("abort return");
  let rejectReturn!: (error: Error) => void; let returning!: () => void;
  const returnStarted = new Promise<void>(resolve => { returning = resolve; });
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: Buffer.from("1\n") }; },
    return() { returning(); return new Promise<IteratorResult<Uint8Array>>((_, reject) => { rejectReturn = reject; }); },
  }; } };
  const running = run(["-c", "."], source, {}, { signal: controller.signal, stdout: { async write() { throw new FsError("EPIPE"); } } });
  const rejection = assert.rejects(running, error => error === reason);
  await returnStarted; controller.abort(reason); await rejection; rejectReturn(new Error("late return")); await delay(0);
});

test("abort interrupts fallback readFile and pending stdout with late rejection", { timeout: 2000 }, async () => {
  for (const mode of ["program", "data", "stdout"] as const) {
    const controller = new AbortController(); const reason = new Error(`abort ${mode}`);
    let rejectHost!: (error: Error) => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const operation = (): Promise<Uint8Array> => { started(); return new Promise((_, reject) => { rejectHost = reject; }); };
    const memory = new MemoryFileSystem();
    const fs = new Proxy(memory, { get(target, property) {
      if (property === "readStream") return undefined;
      if (property === "readFile") return (_: string, options: { signal?: AbortSignal; maxBytes?: number }) => {
        assert.equal(options.signal, controller.signal); assert.equal(typeof options.maxBytes, "number"); return operation();
      };
      const value: unknown = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = mode === "program" ? ["-f", "/program"] : mode === "data" ? [".", "/data"] : ["-nc", "0"];
    const running = run(args, "", {}, { fs, signal: controller.signal, ...(mode === "stdout" ? { stdout: { async write() { await operation(); } } } : {}) });
    const rejection = assert.rejects(running, error => error === reason);
    await ready; controller.abort(reason); await rejection; rejectHost(new Error("late host rejection")); await delay(0);
  }
});

test("pre-aborted signals produce no command I/O", async () => {
  const controller = new AbortController(); const reason = new Error("already aborted"); controller.abort(reason);
  const source: ByteSource = { [Symbol.asyncIterator]() { throw new Error("must not acquire stdin"); } };
  await assert.rejects(run(["-c", "."], source, {}, { signal: controller.signal }), error => error === reason);
});

test("actual Shell pipeline transforms multiple values, slurps, and uses relative -f", { timeout: 3000 }, async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile("/work/filter.jq", Buffer.from(".a"));
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(structuredCommands());
  for (const program of ["jq -c '.a'", "jq -c -f filter.jq"]) {
    const result = await shell.exec(`printf '%s\\n' '{"a":1}' '{"a":2}' | ${program} | jq -sc 'add'`);
    assert.equal(result.stdout, "3\n"); assert.equal(result.exitCode, 0, result.stderr);
  }
});

test("actual Shell downstream head closes a large jq generator", { timeout: 3000 }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(structuredCommands());
  const result = await shell.exec("jq -nc 'range(1000000000)' | head -n 1");
  assert.equal(result.stdout, "0\n"); assert.equal(result.exitCode, 0, result.stderr);
});
