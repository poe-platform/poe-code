import { expect, it, vi } from "vitest";
import { createEngine } from "./engine.js";
import type { Codec } from "./codecs.js";
import type { ByteSource, FileOutput } from "./contracts.js";

const operation = () => ({ signal: new AbortController().signal });
const workbook = { sheets: [{ id: "s", name: "Data", cells: [] }] };
function writer(source: () => AsyncIterable<Uint8Array>) {
  return { id: "stream", description: "streaming fixture", extensions: ["stream"],
    write: vi.fn(async () => { throw new Error("buffered exporter used"); }),
    writeStream: source
  } satisfies Codec;
}

it("awaits a slow sink before pulling and reusing the next exporter chunk", async () => {
  let consumed = 0, produced = 0, maximumOutstanding = 0;
  const codec = writer(async function* () {
    const chunk = new Uint8Array(8192);
    for (let i = 0; i < 128; i++) {
      expect(consumed).toBe(i);
      chunk.fill(i); produced++;
      maximumOutstanding = Math.max(maximumOutstanding, (produced - consumed) * chunk.length);
      yield chunk;
    }
  });
  const engine = createEngine({ codecs: [codec] });
  const book = await engine.adoptWorkbook(workbook, operation());
  const result = await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) {
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(bytes.every(value => value === consumed)).toBe(true);
    consumed++;
  } } }, { exportType: "stream" }, operation());
  expect(result.usage.outputBytes).toBe(128 * 8192);
  expect(maximumOutstanding).toBe(8192);
  expect(codec.write).not.toHaveBeenCalled();
  await engine.dispose();
});

it.each(["sink", "cancel", "limit"] as const)("retires the exporter after %s failure without pulling another chunk", async failure => {
  let retired = 0, pulled = 0;
  const controller = new AbortController();
  const reason = new Error("stop");
  const codec = writer(async function* () {
    try { while (true) { pulled++; yield new Uint8Array(8); } }
    finally { retired++; }
  });
  const engine = createEngine({ codecs: [codec], limits: { outputBytes: failure === "limit" ? 7 : Infinity } });
  const book = await engine.adoptWorkbook(workbook, operation());
  await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() {
    if (failure === "cancel") controller.abort(reason);
    else throw reason;
  } } }, { exportType: "stream" }, { signal: controller.signal })).rejects.toThrow(failure === "limit" ? "output bytes" : "stop");
  expect(pulled).toBe(1);
  expect(retired).toBe(1);
  await engine.dispose();
});

it("streams into the supplied publication transaction and closes only after EOF", async () => {
  const events: string[] = [];
  const codec = writer(async function* () { yield Uint8Array.of(1); yield Uint8Array.of(2); events.push("eof"); });
  const output: FileOutput = {
    write: vi.fn(async () => { throw new Error("whole-file write"); }),
    async writeStream(source: ByteSource) { for await (const chunk of source) events.push(String(chunk[0])); },
    async close() { events.push("close"); }, async abort() { events.push("abort"); }
  };
  const engine = createEngine({ codecs: [codec], filesystem: {
    async read() { throw new Error("read"); }, async write() { throw new Error("whole-file write"); },
    async openOutput() { return output; }
  } });
  const book = await engine.adoptWorkbook(workbook, operation());
  expect((await engine.writeWorkbook(book, { kind: "resource", uri: "/out.stream" }, { exportType: "stream" }, operation())).usage.outputBytes).toBe(2);
  expect(events).toEqual(["1", "2", "eof", "close"]);
  await engine.dispose();
});

it("rejects a filesystem that returns without consuming the exporter and aborts publication", async () => {
  const abort = vi.fn(async () => {}), close = vi.fn(async () => {});
  const engine = createEngine({ codecs: [writer(async function* () { yield Uint8Array.of(1); })], filesystem: {
    async read() { return []; }, async write() { throw new Error("whole-file write"); },
    async openOutput() { return { async write() {}, async writeStream() {}, close, abort }; }
  } });
  const book = await engine.adoptWorkbook(workbook, operation());
  await expect(engine.writeWorkbook(book, { kind: "resource", uri: "/out.stream" }, { exportType: "stream" }, operation())).rejects.toThrow("consuming");
  expect(close).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledOnce();
  await engine.dispose();
});

it("aborts the transaction when exporter acquisition throws synchronously", async () => {
  const reason = new Error("acquisition failed"), abort = vi.fn(async () => {});
  const engine = createEngine({ codecs: [writer(() => { throw reason; })], filesystem: {
    async read() { return []; }, async write() {},
    async openOutput() { return { async write() {}, async writeStream(source) { for await (const chunk of source) void chunk; }, async close() {}, abort }; }
  } });
  const book = await engine.adoptWorkbook(workbook, operation());
  await expect(engine.writeWorkbook(book, { kind: "resource", uri: "/out.stream" }, { exportType: "stream" }, operation())).rejects.toBe(reason);
  expect(abort).toHaveBeenCalledOnce();
  await engine.dispose();
});

it("publishes native failure bytes before returning the original exporter failure", async () => {
  const { CodecWriteFailure } = await import("./codecs/write-failure.js");
  const failure = new CodecWriteFailure(Uint8Array.of(2), "native failure");
  const events: number[] = [];
  const engine = createEngine({ codecs: [writer(async function* () { yield Uint8Array.of(1); throw failure; })] });
  const book = await engine.adoptWorkbook(workbook, operation());
  await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { events.push(...bytes); } } },
    { exportType: "stream" }, operation())).rejects.toBe(failure);
  expect(events).toEqual([1, 2]);
  await engine.dispose();
});

it("registers an incremental-only exporter without a mandatory buffered implementation", async () => {
  const engine = createEngine({ codecs: [{ id: "only-stream", description: "incremental only", extensions: [],
    async *writeStream() { yield Uint8Array.of(42); }
  }] });
  expect(engine.listServices("write").map(codec => codec.id)).toEqual(["only-stream"]);
  const book = await engine.adoptWorkbook(workbook, operation());
  const sink = { write: vi.fn(async () => {}) };
  await engine.writeWorkbook(book, { kind: "stream", sink }, { exportType: "only-stream" }, operation());
  expect(sink.write).toHaveBeenCalledWith(Uint8Array.of(42));
  await engine.dispose();
});
