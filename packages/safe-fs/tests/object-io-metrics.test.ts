import { expect, it } from "vitest";
import { ObjectIoMetrics, delayObjectIoBackend, createObjectIoReadbackStream } from "../src/testing/object-io-metrics.js";

it("attributes overlapping operations to their admission phase and counts failures", async () => {
  let clock = 0;
  const metrics = new ObjectIoMetrics(() => clock);
  metrics.phase("write");
  let release!: () => void;
  const pending = metrics.measure("backend", "put", () => new Promise<void>(resolve => { release = resolve; }));
  clock = 3;
  metrics.phase("publish");
  clock = 7;
  release();
  await pending;
  const reason = new Error("failed read");
  await expect(metrics.measure("syscall", "read", async () => { clock = 9; throw reason; })).rejects.toBe(reason);
  const snapshot = metrics.snapshot();
  expect(snapshot.write).toEqual({ elapsedMs: 3, operations: { "backend.put": { count: 1, failed: 0, elapsedMs: 7 } } });
  expect(snapshot.publish).toEqual({ elapsedMs: 6, operations: { "syscall.read": { count: 1, failed: 1, elapsedMs: 2 } } });
  snapshot.write!.operations["backend.put"]!.count = 99;
  expect(metrics.snapshot().write!.operations["backend.put"]!.count).toBe(1);
});

it("delays and counts only backend requests, preserving receiver and streams", async () => {
  const metrics = new ObjectIoMetrics();
  metrics.phase("publication");
  const sleeps: number[] = [];
  const stream = new ReadableStream();
  const backend = { value: stream, async put(_key: string, source: unknown) { expect(source).toBe(this.value); return this.value; } };
  const delayed = delayObjectIoBackend(backend, metrics, 5, async duration => { sleeps.push(duration); });
  expect(await delayed.put("key", stream)).toBe(stream);
  expect(sleeps).toEqual([5]);
  expect(metrics.snapshot().publication!.operations["backend.put"]!.count).toBe(1);
  expect(() => delayObjectIoBackend(backend, metrics, -1)).toThrow(RangeError);
});

it("emits bounded byte records and final metrics only after EOF and awaited cleanup", async () => {
  const metrics = new ObjectIoMetrics();
  let disposed = 0;
  const body = new ReadableStream<Uint8Array>({ type: "bytes", start(controller) {
    controller.enqueue(new Uint8Array(131073).fill(42));
    controller.close();
  } });
  const stream = createObjectIoReadbackStream({ body, size: 131073, metrics,
    async dispose() { await metrics.measure("backend", "delete", async () => { disposed++; }); },
    summary: () => ({ disposed }),
  });
  const records = [];
  for await (const bytes of stream) records.push(JSON.parse(new TextDecoder().decode(bytes)));
  expect(records.map(record => record.type)).toEqual(["chunk", "chunk", "chunk", "summary"]);
  expect(records.slice(0, 3).map(record => atob(record.base64).length)).toEqual([65536, 65536, 1]);
  expect(records[3]).toMatchObject({ disposed: 1, canonicalBytes: 131073, completed: true,
    phases: { fixtureCleanup: { operations: { "backend.delete": { count: 1 } } },
      canonicalStream: { operations: { "stream.read": { count: 4 } } } } });
});

it("cancellation closes the canonical reader and awaits cleanup exactly once", async () => {
  let disposed = 0;
  const stream = createObjectIoReadbackStream({ body: new ReadableStream({ type: "bytes" }), size: 1,
    metrics: new ObjectIoMetrics(), async dispose() { disposed++; }, summary: () => ({}) });
  await stream.cancel();
  expect(disposed).toBe(1);
});

it("a short canonical stream fails without emitting a success summary but still cleans up", async () => {
  let disposed = 0;
  const stream = createObjectIoReadbackStream({ body: new ReadableStream({ type: "bytes", start(controller) { controller.close(); } }),
    size: 1, metrics: new ObjectIoMetrics(), async dispose() { disposed++; }, summary: () => ({}) });
  await expect(stream.getReader().read()).rejects.toThrow("Canonical readback size mismatch");
  expect(disposed).toBe(1);
});

it("backend read failures still dispose even when cancelling the errored reader rejects", async () => {
  const reason = new Error("canonical backend read failed");
  let disposed = 0;
  const stream = createObjectIoReadbackStream({ body: new ReadableStream({ type: "bytes", start(controller) { controller.error(reason); } }),
    size: 1, metrics: new ObjectIoMetrics(), async dispose() { disposed++; }, summary: () => ({}) });
  await expect(stream.getReader().read()).rejects.toBe(reason);
  expect(disposed).toBe(1);
});
