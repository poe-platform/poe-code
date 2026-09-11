import assert from "node:assert/strict";
import test from "node:test";
import { createLlmCommands, llmCommands } from "../../../src/commands/llm/command.js";
import { acceptsMimeType, sniffMimeType } from "../../../src/commands/llm/mime.js";
import type { LlmProvider, LlmRequest } from "../../../src/commands/llm/types.js";
import { toByteSource, type CommandContext, type ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

async function fixture(complete: LlmProvider["complete"], options: {
  args?: readonly string[]; outputType?: string; attachmentTypes?: readonly string[]; stdin?: ByteSource;
  context?: Partial<CommandContext>;
} = {}) {
  const fs = new MemoryFileSystem();
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const requests: LlmRequest[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const provider: LlmProvider = {
    name: "review", models: [{ id: "model", outputType: options.outputType ?? "text/plain", attachmentTypes: options.attachmentTypes ?? [] }],
    complete(request) { requests.push(request); return complete(request); },
  };
  const context: CommandContext = {
    command: "llm", args: options.args ?? [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: options.stdin ?? toByteSource(""),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); }, ...options.context,
  };
  const command = createLlmCommands({ providers: [provider], defaultModel: "model" })[0]!;
  return { fs, stdout, stderr, requests, cleanups, context, provider, execute: () => command.execute(context) };
}

test("review: text output preserves a Unicode scalar split across provider chunks", async () => {
  const run = await fixture(async function* () { yield "fox: \ud83e"; yield "\udd8a"; });
  assert.equal((await run.execute()).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.stdout), Buffer.from("fox: 🦊\n"));
});

test("review: text output handles empty chunks within a split surrogate pair", async () => {
  const run = await fixture(async function* () { yield "\ud83e"; yield ""; yield "\udd8a"; });
  assert.equal((await run.execute()).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.stdout), Buffer.from("🦊\n"));
});

test("review: terminal unmatched surrogate is encoded before the required newline", async () => {
  const run = await fixture(async function* () { yield "unmatched \ud83e"; });
  assert.equal((await run.execute()).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.stdout), Buffer.from("unmatched \ufffd\n"));
});

test("review: zero-sized binary chunks do not add newline or corrupt reused slabs", async () => {
  const slab = Buffer.from([0, 255, 128]);
  const run = await fixture(async function* () {
    yield new Uint8Array(); yield slab; slab.fill(17); yield slab; slab.fill(42);
  }, { outputType: "audio/mpeg" });
  assert.equal((await run.execute()).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.stdout), Buffer.from([0, 255, 128, 17, 17, 17]));
});

test("review: exact shell output boundary includes the final text newline and closes the provider", async () => {
  for (const text of ["123", "1234"]) {
    let closed = 0;
    const run = await fixture(async function* () { try { yield text; } finally { closed++; } });
    const shell = new Shell({ fs: run.fs, limits: { maxOutputBytes: 4 } }).use(llmCommands({ providers: [run.provider], defaultModel: "model" }));
    try {
      if (text.length === 3) assert.equal((await shell.exec("llm")).stdout, "123\n");
      else await assert.rejects(shell.exec("llm"), /maxOutputBytes/);
      assert.equal(closed, 1);
      assert.equal(run.requests[0]?.signal.aborted, true);
    } finally { await shell.dispose(); }
  }
});

test("review: provider iteration never advances while a downstream write is outstanding", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  let advances = 0;
  const run = await fixture(async function* () { advances++; yield "first"; advances++; yield "second"; }, {
    context: { stdout: { async write() { if (advances === 1) { entered.resolve(); await release.promise; } } } },
  });
  const completion = run.execute();
  await entered.promise;
  assert.equal(advances, 1);
  release.resolve();
  assert.equal((await completion).exitCode, 0);
  assert.equal(advances, 2);
});

test("review: attachment snapshots survive an adapter reusing its read buffer", async () => {
  const run = await fixture(async function* () { yield "ok"; }, { args: ["--at", "/one", "image/png", "--at", "/two", "image/png"], attachmentTypes: ["image/*"] });
  const slab = new Uint8Array(3);
  let reads = 0;
  run.fs.readFile = async () => { slab.fill(++reads); return slab; };
  assert.equal((await run.execute()).exitCode, 0);
  assert.deepEqual(run.requests[0]?.attachments.map(({ bytes }) => [...bytes]), [[1, 1, 1], [2, 2, 2]]);
});

test("review: duplicate attachment paths are admitted cumulatively rather than deduplicated", async () => {
  const run = await fixture(async function* () { yield "ok"; }, { args: ["--at", "/same", "image/png", "--at", "/same", "image/png"], attachmentTypes: ["image/*"], stdin: toByteSource("🦊") });
  const limits: (number | undefined)[] = [];
  run.fs.readFile = async (_path, options) => { limits.push(options?.maxBytes); return new Uint8Array(3); };
  assert.equal((await run.execute()).exitCode, 0);
  assert.equal(limits.length, 2);
  assert.ok(typeof limits[0] === "number");
  assert.equal(limits[1], limits[0] - 3);
  assert.equal(run.requests[0]?.attachments.length, 2);
});

test("review: all attachment admission finishes before provider acquisition", async () => {
  const run = await fixture(async function* () { yield "must not query"; }, { args: ["-a", "/accepted.png", "-a", "/rejected.mp3"], attachmentTypes: ["image/*"] });
  await run.fs.writeFile("/accepted.png", Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
  await run.fs.writeFile("/rejected.mp3", Uint8Array.of(73, 68, 51));
  assert.equal((await run.execute()).exitCode, 1);
  assert.equal(run.requests.length, 0);
  assert.equal(Buffer.concat(run.stdout).length, 0);
  assert.match(Buffer.concat(run.stderr).toString(), /does not accept audio\/mpeg/);
});

test("review: falsey provider failures close acquired iterators and emit no success newline", async () => {
  for (const failure of [null, undefined, 0, false, ""]) {
    let returns = 0;
    const run = await fixture(() => ({ [Symbol.asyncIterator]() { return {
      async next() { throw failure; }, async return() { returns++; return { done: true as const, value: undefined }; },
    }; } }));
    assert.equal((await run.execute()).exitCode, 1);
    assert.equal(returns, 1);
    assert.equal(run.requests[0]?.signal.aborted, true);
    assert.equal(Buffer.concat(run.stdout).length, 0);
    await Promise.all(run.cleanups.map(cleanup => cleanup()));
    assert.equal(returns, 1);
  }
});

test("review: successful commands wait for cooperative iterator cleanup", async () => {
  const closing = deferred<void>(), release = deferred<void>();
  const run = await fixture(() => ({ [Symbol.asyncIterator]() { return {
    async next() { return { done: true as const, value: undefined }; },
    async return() { closing.resolve(); await release.promise; return { done: true as const, value: undefined }; },
  }; } }));
  const completion = Promise.resolve(run.execute());
  let settled = false;
  void completion.then(() => { settled = true; }, () => { settled = true; });
  await closing.promise;
  assert.equal(settled, false);
  assert.equal(run.requests[0]?.signal.aborted, true);
  release.resolve();
  assert.equal((await completion).exitCode, 0);
});

test("review: cancellation during provider acquisition still closes the acquired iterator exactly once", async () => {
  const controller = new AbortController();
  const failure = new Error("abort at iterator acquisition");
  let returns = 0, reads = 0;
  const run = await fixture(() => ({ [Symbol.asyncIterator]() {
    controller.abort(failure);
    return { async next() { reads++; return { done: true as const, value: undefined }; }, async return() { returns++; return { done: true as const, value: undefined }; } };
  } }), { context: { signal: controller.signal } });
  await assert.rejects(Promise.resolve(run.execute()), error => error === failure);
  assert.equal(returns, 1);
  assert.equal(reads, 0);
});

test("review: Ogg Theora video is not mistaken for Ogg audio", async () => {
  const ogg = new Uint8Array(70);
  ogg.set(new TextEncoder().encode("OggS"));
  ogg[5] = 2;
  ogg[26] = 1;
  ogg[27] = 42;
  ogg[28] = 0x80;
  ogg.set(new TextEncoder().encode("theora"), 29);
  ogg.set([3, 2, 1], 35);
  assert.equal(sniffMimeType("clip.ogv", ogg), "video/ogg");
  const run = await fixture(async function* () { yield "video accepted"; }, { args: ["-a", "/clip.ogv"], attachmentTypes: ["video/*"] });
  await run.fs.writeFile("/clip.ogv", ogg);
  assert.equal((await run.execute()).exitCode, 0);
  assert.equal(run.requests[0]?.attachments[0]?.mimeType, "video/ogg");
});

test("review: EBML DocType wins over unrelated webm text in a Matroska header", () => {
  const bytes = Uint8Array.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x91,
    0x42, 0x82, 0x88, ...new TextEncoder().encode("matroska"),
    0xec, 0x84, ...new TextEncoder().encode("webm"),
  ]);
  assert.equal(sniffMimeType("video.mkv", bytes), "video/x-matroska");
});

test("review: truncated signatures and dotted directories use only the final filename fallback", () => {
  for (const bytes of [new Uint8Array(), Uint8Array.of(137, 80, 78, 71), new TextEncoder().encode("RIFF")]) {
    assert.equal(sniffMimeType("/images.png/raw", bytes), "application/octet-stream");
    assert.equal(sniffMimeType("/images.png/file.MP4", bytes), "video/mp4");
  }
});

test("review: MIME matching normalizes case and parameters without admitting control characters or wildcards as actual types", () => {
  assert.equal(acceptsMimeType(["IMAGE/*"], "Image/PNG; profile=example"), true);
  assert.equal(acceptsMimeType(["text/plain"], "TEXT/PLAIN; charset=utf-8"), true);
  for (const mime of ["image/*", "image/png\r\nX: yes", "image/png; q=\0", "image/", "image/png/extra"]) {
    assert.equal(acceptsMimeType(["image/*"], mime), false, JSON.stringify(mime));
  }
});
