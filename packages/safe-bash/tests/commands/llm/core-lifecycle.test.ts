import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { llmCommands } from "../../../src/commands/llm/index.js";

for (const lateReject of [false, true]) {
  test(`llm abort closes an opaque blocked provider, late rejection ${lateReject}`, { timeout: 1500 }, async () => {
    const controller = new AbortController();
    const reason = { cancelled: true };
    let entered!: () => void;
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    let reject!: (reason: unknown) => void;
    const pending = new Promise<IteratorResult<string>>((_, fail) => { reject = fail; });
    let returns = 0;
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], complete() { return { [Symbol.asyncIterator]() { return { next() { entered(); return pending; }, return() { returns++; return new Promise(() => {}); } }; } }; } }] }));
    const execution = shell.exec("llm", { signal: controller.signal });
    try {
      await admitted;
      controller.abort(reason);
      await assert.rejects(execution, error => error === reason);
      assert.equal(returns, 1);
      if (lateReject) reject(new Error("late provider failure"));
      await new Promise(resolve => setImmediate(resolve));
    } finally { controller.abort(reason); await shell.dispose(); }
  });
}

test("llm preserves existing output budget and provider cleanup", async () => {
  let closed = false;
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxOutputBytes: 2 } }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], async *complete() { try { yield "toolong"; } finally { closed = true; } } }] }));
  try {
    await assert.rejects(shell.exec("llm"), { name: "ShellLimitError", message: "Shell limit exceeded: maxOutputBytes" });
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});

test("llm copies reused stdin chunks before advancing producer", async () => {
  let prompt = "";
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], async *complete(request) { prompt = request.prompt; yield "ok"; } }] }));
  const bytes = new Uint8Array([65]);
  async function* input() { yield bytes; bytes[0] = 66; yield bytes; bytes[0] = 67; }
  try { assert.equal((await shell.exec("llm", { stdin: input() })).exitCode, 0); assert.equal(prompt, "AB"); }
  finally { await shell.dispose(); }
});

test("llm does not advance provider until the sink has consumed a chunk", async () => {
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let advances = 0;
  const chunks: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], async *complete() { advances++; yield "first"; advances++; yield "second"; } }] }));
  const execution = shell.exec("llm", { stdout: { async write(bytes) { chunks.push(new TextDecoder().decode(bytes)); entered(); await barrier; } } });
  try {
    await writing;
    assert.equal(advances, 1);
    release();
    assert.equal((await execution).exitCode, 0);
    assert.deepEqual(chunks, ["first", "second", "\n"]);
  } finally { release(); await execution; await shell.dispose(); }
});

test("llm yields to cancellation on an endless empty provider", { timeout: 1500 }, async () => {
  const controller = new AbortController();
  const reason = false;
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let closed = false;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], async *complete() { try { entered(); while (true) yield ""; } finally { closed = true; } } }] }));
  const execution = shell.exec("llm", { signal: controller.signal });
  try {
    await admitted;
    const timer = setTimeout(() => controller.abort(reason), 0);
    try { await assert.rejects(execution, error => error === reason); }
    finally { clearTimeout(timer); }
    assert.equal(closed, true);
  } finally { controller.abort(reason); await shell.dispose(); }
});

test("llm closes an opaque wrong-chunk response without awaiting its unbounded return", async () => {
  let returns = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], complete() { return { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: new Uint8Array([1]) }; }, return() { returns++; return new Promise(() => {}); } }; } }; } }] }));
  try { assert.equal((await shell.exec("llm")).exitCode, 1); assert.equal(returns, 1); }
  finally { await shell.dispose(); }
});
