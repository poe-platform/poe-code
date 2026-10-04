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
