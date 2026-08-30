import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { ByteSource } from "../../../src/contracts/index.js";
import { archive, binary, direct, fixture, gate, header, member, source, wrapped } from "./helpers.js";

function pause(signal: AbortSignal): Promise<never> {
  signal.throwIfAborted();
  return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

async function settle<Value>(promise: Promise<Value>): Promise<Value> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("archive settlement watchdog")), 1500); })]);
  } finally { if (timer) clearTimeout(timer); }
}

test("pre-abort performs no FS or stream work", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  let calls = 0;
  const adapter = wrapped(fs, { async lstat() { calls++; throw new Error("unexpected FS access"); } });
  const controller = new AbortController(); const reason = new Error("pre-abort"); controller.abort(reason);
  await assert.rejects(direct(["cf", "-", "file"], adapter, { signal: controller.signal }), error => error === reason);
  assert.equal(calls, 0);
});

for (const stage of ["header", "body"]) test(`cancellation while reading ${stage} closes cooperative input`, async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  const controller = new AbortController(); const entered = gate(); const closed = gate();
  const input: ByteSource = { async *[Symbol.asyncIterator]() {
    try { if (stage === "body") yield header("file", binary); entered.resolve(); await pause(controller.signal); }
    finally { closed.resolve(); }
  } };
  const reason = new Error(`cancel ${stage}`);
  const checked = assert.rejects(direct(["xf", "-", "-C", "/out"], fs, { stdin: input, signal: controller.signal }), error => error === reason);
  await settle(entered.promise); controller.abort(reason);
  await settle(checked); await settle(closed.promise);
});

test("blocked stdout backpressures before payload acquisition and abort settles", async () => {
  const { fs, shell } = await fixture(); await shell.dispose(); await fs.writeFile("/work/file", binary);
  let reads = 0;
  const adapter = wrapped(fs, { readStream(path, options) { reads++; return fs.readStream!(path, options); } });
  const controller = new AbortController(); const entered = gate();
  const reason = new Error("blocked archive output");
  const checked = assert.rejects(direct(["cf", "-", "file"], adapter, { signal: controller.signal, stdout: { async write() { entered.resolve(); await pause(controller.signal); } } }), error => error === reason);
  await settle(entered.promise);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(reads, 0);
  controller.abort(reason); await settle(checked);
});

test("blocked extractor writer backpressures input and receives cancellation", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  const controller = new AbortController(); const entered = gate(); const closed = gate();
  let produced = 0;
  const bytes = archive(member("file", randomBytes(512 * 1024)));
  const input: ByteSource = { async *[Symbol.asyncIterator]() { try {
    for (let offset = 0; offset < bytes.length; offset += 1024) { produced++; yield bytes.subarray(offset, offset + 1024); }
  } finally { closed.resolve(); } } };
  const adapter = wrapped(fs, { async writeStream(_path, content, options) {
    for await (const _chunk of content) { entered.resolve(); await pause(options!.signal!); }
  } });
  const reason = new Error("cancel extraction write");
  const checked = assert.rejects(direct(["xf", "-", "-C", "/out"], adapter, { stdin: input, signal: controller.signal }), error => error === reason);
  await settle(entered.promise); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(produced, 1);
  controller.abort(reason); await settle(checked); await settle(closed.promise);
});

test("gzip compressor has bounded read-ahead at a blocked output sink", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  const payload = randomBytes(2 * 1024 * 1024); await fs.writeFile("/work/file", payload);
  const controller = new AbortController(); const entered = gate(); const closed = gate();
  let produced = 0;
  const adapter = wrapped(fs, { async *readStream(_path, options) { try {
    for (let offset = 0; offset < payload.length; offset += 4096) { options!.signal!.throwIfAborted(); produced++; yield payload.subarray(offset, offset + 4096); }
  } finally { closed.resolve(); } } });
  const reason = new Error("cancel gzip output");
  const checked = assert.rejects(direct(["czf", "-", "file"], adapter, { signal: controller.signal, stdout: { async write() { entered.resolve(); await pause(controller.signal); } } }), error => error === reason);
  await settle(entered.promise); await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(produced < 100, `gzip unexpectedly consumed ${produced} chunks`);
  controller.abort(reason); await settle(checked);
  if (produced > 0) await settle(closed.promise);
});

test("cancellation during compressor source read closes the source task", async () => {
  const { fs, shell } = await fixture(); await shell.dispose(); await fs.writeFile("/work/file", binary);
  const entered = gate(); const closed = gate(); const controller = new AbortController();
  const adapter = wrapped(fs, { async *readStream(_path, options) { try { entered.resolve(); await pause(options!.signal!); } finally { closed.resolve(); } } });
  const reason = new Error("cancel gzip producer");
  const checked = assert.rejects(direct(["czf", "-", "file"], adapter, { signal: controller.signal }), error => error === reason);
  await settle(entered.promise); controller.abort(reason); await settle(checked); await settle(closed.promise);
});

for (const gzip of [false, true]) test(`early consumer sink rejection closes ${gzip ? "gzip" : "plain"} producer`, async () => {
  const { fs, shell } = await fixture(); await shell.dispose(); await fs.writeFile("/work/file", binary);
  let closed = false; let opened = false;
  const adapter = wrapped(fs, { async *readStream(path, options) { opened = true; try { yield* fs.readStream!(path, options); } finally { closed = true; } } });
  const result = await settle(direct([gzip ? "czf" : "cf", "-", "file"], adapter, { stdout: { async write() { throw new Error("EPIPE early consumer"); } } }));
  assert.equal(result.exitCode, 2, result.stderr);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(!opened || closed);
});

test("Shell head partial consumer closes plain/gzip archive pipelines", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/file", randomBytes(256 * 1024));
    for (const flags of ["cf", "czf"]) {
      const result = await settle(shell.exec(`tar ${flags} - file | head -c 16`));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdoutBytes.length, 16);
    }
  } finally { await shell.dispose(); }
});

test("gzip decoding with a blocked listing sink remains cancellable", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  const controller = new AbortController(); const entered = gate();
  const bytes = gzipSync(archive(member("file", binary)));
  const reason = new Error("cancel decoded listing");
  const checked = assert.rejects(direct(["tzf", "-"], fs, { stdin: source(bytes, 11), signal: controller.signal, stdout: { async write() { entered.resolve(); await pause(controller.signal); } } }), error => error === reason);
  await settle(entered.promise); controller.abort(reason); await settle(checked);
});

test("late producer and iterator-return rejections are observed after abort", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  const controller = new AbortController(); const entered = gate(); const returned = gate();
  let rejectNext!: (error: Error) => void;
  const input: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return new Promise((_resolve, reject) => { rejectNext = reject; }); },
    async return() { returned.resolve(); throw new Error("late return rejection"); },
  }; } };
  const reason = new Error("cancel uncooperative header producer");
  const checked = assert.rejects(direct(["tf", "-"], fs, { stdin: input, signal: controller.signal }), error => error === reason);
  await settle(entered.promise); controller.abort(reason); await settle(checked); await settle(returned.promise);
  rejectNext(new Error("late source rejection"));
  await new Promise(resolve => setTimeout(resolve, 10));
});

test("bad compressed input cancels its blocked upstream producer", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  const controller = new AbortController(); const closed = gate();
  const input: ByteSource = { [Symbol.asyncIterator]() {
    let first = true;
    let finish!: (value: IteratorResult<Uint8Array>) => void;
    return {
      async next() { if (first) { first = false; return { done: false, value: Buffer.from("not gzip") }; } return new Promise(resolve => { finish = resolve; }); },
      async return() { finish?.({ done: true, value: undefined }); closed.resolve(); return { done: true, value: undefined }; },
    };
  } };
  const result = await settle(direct(["tzf", "-"], fs, { stdin: input, signal: controller.signal }));
  assert.equal(result.exitCode, 2, result.stderr);
  await settle(closed.promise);
});
