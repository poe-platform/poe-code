import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosDict, cosNumber, cosString, decodePdfString, dictGet, dictSet } from "../ast.js";
import { PdfMutableObjectStore } from "./mutable-object-store.js";

it("reserves cyclic references, replaces objects and replays sorted owned values", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    const first = await store.allocate(), second = await store.allocate();
    const value = cosDict({ Next: second, Value: cosString("saved") });
    await store.set({ objectNumber: first.objectNumber, generationNumber: 0, value });
    await store.set({ objectNumber: second.objectNumber, generationNumber: 0, value: cosDict({ Next: first }) });
    dictSet(value, "Value", cosString("mutated"));
    const loaded = (await store.get(first.objectNumber))!;
    const saved = loaded.value.kind === "dict" ? dictGet(loaded.value, "Value") : undefined;
    expect(saved?.kind === "string" && decodePdfString(saved)).toBe("saved");
    if (loaded.value.kind === "dict") dictSet(loaded.value, "Next", cosNumber(0));
    const again = (await store.get(first.objectNumber))!;
    expect(again.value.kind === "dict" && dictGet(again.value, "Next")).toMatchObject({ kind: "ref", objectNumber: second.objectNumber, generationNumber: 0 });
    expect(await store.get(100)).toBeUndefined();
    const numbers = []; for await (const object of store.objects()) numbers.push(object.objectNumber);
    expect(numbers).toEqual([1, 2]);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("retains reused stream chunks and leaves the old value intact after a bad replacement", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    await store.set({ objectNumber: 9, generationNumber: 3, value: cosDict({}), stream: { length: 70000, chunks: (async function* () {
      const scratch = new Uint8Array(1000); for (let i = 0; i < 70; i++) { scratch.fill(i); yield scratch; }
    })() } });
    await expect(store.set({ objectNumber: 9, generationNumber: 0, value: cosDict({}), stream: { length: 4, chunks: [new Uint8Array(3)] } })).rejects.toThrow();
    const object = (await store.get(9))!; expect(object.generationNumber).toBe(3); expect(object.stream?.length).toBe(70000);
    let total = 0; for await (const bytes of object.stream!.chunks) { expect(bytes.length).toBeLessThanOrEqual(16384);
      expect(bytes.every((value, i) => value === Math.floor((total + i) / 1000))).toBe(true); total += bytes.length; bytes.fill(255); }
    expect(total).toBe(70000);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("admits backing before consuming a stream and preserves cancellation", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let consumed = false;
  const controller = new AbortController(), reason = new Error("stop edits");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { maxStagingBytes: 16, signal: controller.signal });
  try {
    await expect(store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 100,
      chunks: (async function* () { consumed = true; yield new Uint8Array(100); })() } })).rejects.toThrow();
    expect(consumed).toBe(false); controller.abort(reason); await expect(store.get(1)).rejects.toBe(reason);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("yields to timer cancellation while accepting reused payload chunks", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel append");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { signal: controller.signal }); let consumed = 0;
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect(store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 2000 * 1024,
      chunks: (async function* () { const bytes = new Uint8Array(1024); for (let i = 0; i < 2000; i++) { consumed++; yield bytes; } })() } })).rejects.toBe(reason);
    expect(consumed).toBeLessThan(2000);
  } finally { clearTimeout(timer); await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("preserves explicit hexadecimal string serialization through replacement snapshots", async () => {
  const { serializeCosNodeBytes } = await import("./writer.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  const value = cosDict({ Hex: { kind: "string", format: "hex", bytes: Uint8Array.of(0, 65, 255) }, Literal: cosString("text") });
  try { const ref = await store.allocate(value); expect(serializeCosNodeBytes((await store.get(ref.objectNumber))!.value)).toEqual(serializeCosNodeBytes(value)); }
  finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("serializes stored structural values and stream dictionaries without reparsing them", async () => {
  const { serializeRetainedCosDocumentChunks } = await import("./retained-writer.js");
  const { cosArray, cosRef } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const storage = { fs, directory: "/scratch" }, store = new PdfMutableObjectStore(storage, { maxNodes: 1 });
  const objects = [
    { objectNumber: 1, generationNumber: 0, value: cosArray(Array.from({ length: 40000 }, (_, i) => cosNumber(i))) },
    { objectNumber: 2, generationNumber: 3, value: cosDict({ Length: cosNumber(99), Names: cosArray([cosString("a"), cosString("b")]) }), stream: { length: 3, chunks: [Uint8Array.of(1, 2, 3)] } },
  ];
  async function collect(input: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of input) { expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(bytes); } return Buffer.concat(chunks); }
  try {
    for (const object of objects) await store.set(object);
    await expect(store.get(1)).rejects.toThrow();
    const expected = await collect(serializeRetainedCosDocumentChunks({ objects, rootRef: cosRef(1), chunkBytes: 16384 }, storage));
    const actual = await collect(serializeRetainedCosDocumentChunks({ objects: store.outputObjects(), rootRef: cosRef(1), chunkBytes: 16384 }, storage));
    expect(actual).toEqual(expected);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("preserves output snapshots and cancels traversal of many small records", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel output traversal");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { signal: controller.signal });
  try {
    await store.allocate(cosString("before"));
    const iterator = store.outputObjects(), saved = (await iterator.next()).value!;
    await iterator.return(); await store.set({ objectNumber: 1, generationNumber: 0, value: cosString("after") });
    const chunks = []; for await (const chunk of saved.body.chunks) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("(before)");
    for (let i = 0; i < 1000; i++) await store.allocate(cosNumber(i));
    const timer = setTimeout(() => controller.abort(reason), 0); let visited = 0;
    try { await expect((async () => { for await (const ignored of store.outputObjects()) { void ignored; visited++; } })()).rejects.toBe(reason); }
    finally { clearTimeout(timer); }
    expect(visited).toBeLessThan(1001);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("replays a captured stream snapshot after replacing its object", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    await store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 3, chunks: [Uint8Array.of(1, 2, 3)] } });
    const snapshot = (await store.get(1))!.stream!;
    await store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 1, chunks: [Uint8Array.of(9)] } });
    for (let replay = 0; replay < 2; replay++) { const chunks = []; for await (const bytes of snapshot.chunks) chunks.push(bytes); expect(new Uint8Array(Buffer.concat(chunks))).toEqual(Uint8Array.of(1, 2, 3)); }
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("stores serialized structural values without materializing their members", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { maxNodes: 1 });
  const encoder = new TextEncoder(), count = 40000;
  async function* chunks() { yield encoder.encode("[ "); const value = encoder.encode("1 "); for (let i = 0; i < count; i++) yield value; yield encoder.encode("]"); }
  try {
    await store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: 3 + 2 * count, chunks: chunks() } });
    await expect(store.get(1)).rejects.toThrow();
    const objects = store.outputObjects(), first = await objects.next(); expect(first.done).toBe(false);
    let length = 0; for await (const bytes of first.value!.body.chunks) { expect(bytes.length).toBeLessThanOrEqual(16384); length += bytes.length; }
    expect(length).toBe(3 + 2 * count); await objects.return();
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("admits serialized values before consumption and leaves failed replacements uncommitted", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { maxStagingBytes: 8192 });
  try {
    await store.set({ objectNumber: 1, generationNumber: 0, value: cosNumber(7) }); let consumed = false;
    await expect(store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: 8192, chunks: (async function* () { consumed = true; yield new Uint8Array(8192); })() } })).rejects.toThrow();
    expect(consumed).toBe(false);
    await expect(store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: 2, chunks: [Uint8Array.of(49)] } })).rejects.toThrow("Incomplete");
    expect((await store.get(1))!.value).toMatchObject({ kind: "number", value: 7 });
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});


it("records completed decoding without marking a replacement of the same identity", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  const object = { objectNumber: 1, generationNumber: 0, value: cosDict(), stream: { length: 1, chunks: [Uint8Array.of(1)] } };
  try {
    await store.set(object); const old = (await store.get(1))!;
    await store.markDecoded(old); expect((await store.get(1))!.stream?.decoded).toBe(true);
    await store.set(object); await store.markDecoded(old);
    expect((await store.get(1))!.stream?.decoded).toBe(false);
    await store.markDecoded((await store.get(1))!); expect((await store.get(1))!.stream?.decoded).toBe(true);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("deletes live identities without reading their values and never reuses an allocated identity", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { maxNodes: 1 });
  try {
    await store.set({ objectNumber: 7, generationNumber: 2, value: cosDict({ A: cosNumber(1), B: cosNumber(2) }) });
    await expect(store.get(7)).rejects.toThrow();
    expect(await store.delete(7)).toBe(true);
    expect(await store.get(7)).toBeUndefined();
    expect(await store.delete(7)).toBe(false);
    expect(await store.delete(1000000)).toBe(false);
    expect((await store.allocate()).objectNumber).toBe(8);
    const identities = []; for await (const identity of store.identities()) identities.push(identity);
    expect(identities).toEqual([{ objectNumber: 8, generationNumber: 0 }]);
    const objects = []; for await (const object of store.objects()) objects.push(object.objectNumber);
    expect(objects).toEqual([8]);
    const output = []; for await (const object of store.outputObjects()) output.push(object.objectNumber);
    expect(output).toEqual([8]);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("keeps stream and serialized snapshots readable across deletion and reinsertion", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    await store.set({ objectNumber: 3, generationNumber: 2, value: cosDict({}), stream: { length: 3, chunks: [Uint8Array.of(1, 2, 3)] } });
    const before = (await store.get(3))!, outputs = store.outputObjects(), serialized = (await outputs.next()).value!;
    await outputs.return();
    expect(await store.delete(3)).toBe(true);
    await store.markDecoded(before);
    await store.set({ objectNumber: 3, generationNumber: 4, value: cosDict({}), stream: { length: 2, chunks: [Uint8Array.of(8, 9)] } });
    await store.markDecoded(before); expect((await store.get(3))!.stream!.decoded).toBe(false);
    const bytes = []; for await (const chunk of before.stream!.chunks) bytes.push(...chunk);
    expect(bytes).toEqual([1, 2, 3]);
    const saved = []; for await (const chunk of serialized.body.chunks) saved.push(chunk);
    expect(Buffer.concat(saved).toString("latin1")).toContain("\nstream\n\x01\x02\x03\nendstream");
    expect((await store.get(3))!.generationNumber).toBe(4);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("queues deletion after an outstanding stream replacement", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const replacing = store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 1, chunks: (async function* () { await gate; yield Uint8Array.of(4); })() } });
    const deleting = store.delete(1), reading = store.get(1); release();
    await replacing; expect(await deleting).toBe(true); expect(await reading).toBeUndefined();
  } finally { release(); await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const method of ["objects", "identities", "outputObjects"] as const) it(`cancels ${method} traversal of deleted identities`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel deleted traversal");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { signal: controller.signal });
  try {
    for (let i = 1; i <= 64; i++) { await store.set({ objectNumber: i, generationNumber: 0, value: cosNumber(i) }); await store.delete(i); }
    const timer = setTimeout(() => controller.abort(reason), 0);
    try { await expect(store[method]().next()).rejects.toBe(reason); } finally { clearTimeout(timer); }
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("validates deletion identities and preserves cancellation", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController();
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { signal: controller.signal });
  try {
    for (const number of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await expect(store.delete(number)).rejects.toThrow(RangeError);
    const reason = new Error("cancel deletion"); controller.abort(reason); await expect(store.delete(1)).rejects.toBe(reason);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("persists deletion markers beyond the identity cache and restores sparse objects", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    // IntegerTable retains at most 4096 identities. Both live and deleted keys
    // below must be replayed from caller backing after cache eviction.
    for (let i = 1; i <= 4100; i++) { await store.set({ objectNumber: i, generationNumber: 0, value: cosNumber(i) }); await store.delete(i); }
    for (const number of [1, 2048, 4100]) expect(await store.get(number)).toBeUndefined();
    await store.set({ objectNumber: 1, generationNumber: 3, value: cosString("restored") });
    const identities = []; for await (const identity of store.identities()) identities.push(identity);
    expect(identities).toEqual([{ objectNumber: 1, generationNumber: 3 }]);
    expect((await store.allocate()).objectNumber).toBe(4101);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("serializes deletion holes exactly like a document containing only surviving objects", async () => {
  const { serializeRetainedCosDocumentChunks } = await import("./retained-writer.js");
  const { cosArray, cosName, cosRef } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, store = new PdfMutableObjectStore(storage);
  const survivors = [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(3) }) },
    { objectNumber: 3, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Kids: cosArray([]), Count: cosNumber(0) }) }
  ];
  async function collect(input: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of input) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes); } return Buffer.concat(chunks); }
  try {
    for (const object of survivors) await store.set(object);
    await store.set({ objectNumber: 2, generationNumber: 5, value: cosString("removed") });
    await store.set({ objectNumber: 4, generationNumber: 0, value: cosString("removed highest") });
    await store.delete(2); await store.delete(4);
    const expected = await collect(serializeRetainedCosDocumentChunks({ objects: survivors, rootRef: cosRef(1), chunkBytes: 16384 }, storage));
    const actual = await collect(serializeRetainedCosDocumentChunks({ objects: store.outputObjects(), rootRef: cosRef(1), chunkBytes: 16384 }, storage));
    expect(actual).toEqual(expected);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
