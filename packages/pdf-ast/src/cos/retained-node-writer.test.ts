import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosString, type PdfCosNode } from "../ast.js";
import { appendStoredRecord } from "../content/stored-record.js";
import { serializeCosNodeBytes } from "./writer.js";
import { serializeRetainedCosNodeChunks } from "./retained-node-writer.js";
import { PdfMutableObjectStore } from "./mutable-object-store.js";

it.each(["literal", "hex"] as const)("serializes backed containers and %s strings with byte parity", async format => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const backing = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal: new AbortController().signal }, 4), store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  const bytes = Uint8Array.from({ length: 32768 }, (_, i) => i % 256), position = backing.allocate(bytes.length); await backing.write(position, bytes);
  const string: PdfCosNode = { kind: "string", format, bytes: new Uint8Array(), storedBytes: { storage: backing, position, byteLength: bytes.length } };
  const arrayPosition = await appendStoredRecord(backing, string, -1);
  const array: PdfCosNode = { kind: "array", items: [], storedItems: { storage: backing, position: arrayPosition, length: 1 } };
  const dictPosition = await appendStoredRecord(backing, { key: cosName("Value"), value: array }, -1);
  const dict: PdfCosNode = { kind: "dict", entries: [], storedEntries: { storage: backing, position: dictPosition, length: 1 } };
  const expected = serializeCosNodeBytes(cosDict({ Value: cosArray([{ kind: "string", format, bytes }]) }));
  try {
    const parts = []; for await (const part of serializeRetainedCosNodeChunks(dict, { chunkBytes: 127 })) { expect(part.buffer.byteLength).toBeLessThanOrEqual(127); parts.push(part); await Promise.resolve(); }
    expect(Buffer.concat(parts)).toEqual(Buffer.from(expected));
    const ref = await store.allocate(dict); expect(serializeCosNodeBytes((await store.get(ref.objectNumber))!.value)).toEqual(expected);
    await store.set({ objectNumber: ref.objectNumber, generationNumber: 0, value: dict, stream: { length: 2, chunks: [Uint8Array.of(1, 2)] } });
    const output = []; for await (const object of store.outputObjects()) { for await (const chunk of object.body.chunks) output.push(chunk); }
    expect(Buffer.concat(output)).toEqual(Buffer.from(serializeCosNodeBytes({ kind: "stream", dict: cosDict({ Value: cosArray([{ kind: "string", format, bytes }]), Length: cosNumber(2) }), rawBytes: Uint8Array.of(1, 2) })));
  } finally { await store.close(); await backing.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("rejects limits before reading backing and preserves cancellation", async () => {
  let reads = 0;
  const storage = { allocate: () => 0, write: async () => {}, read: async (_position: number, length: number) => { reads++; return new Uint8Array(length); } };
  const node: PdfCosNode = { kind: "string", bytes: new Uint8Array(), storedBytes: { storage, position: 0, byteLength: 4096 } };
  const consume = async (options: Parameters<typeof serializeRetainedCosNodeChunks>[1]) => { for await (const bytes of serializeRetainedCosNodeChunks(node, options)) void bytes; };
  await expect(consume({ maxOutputBytes: 1 })).rejects.toMatchObject({ code: "E_LIMIT" }); expect(reads).toBe(0);
  const controller = new AbortController(), reason = new Error("stop"); controller.abort(reason);
  await expect(consume({ signal: controller.signal })).rejects.toBe(reason); expect(reads).toBe(0);
  await expect((async () => { for await (const part of serializeRetainedCosNodeChunks(cosArray([cosArray([cosString("x")])]), { maxRecursionDepth: 1 })) void part; })()).rejects.toMatchObject({ code: "E_LIMIT" });
});

it("keeps the old mutable value when a borrowed backing read fails", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  const reason = new Error("backing read failed");
  const storage = { allocate: () => 0, write: async () => {}, read: async () => { throw reason; } };
  try {
    const ref = await store.allocate(cosNumber(7));
    await expect(store.set({ objectNumber: ref.objectNumber, generationNumber: 0, value: { kind: "string", bytes: new Uint8Array(), storedBytes: { storage, position: 0, byteLength: 4096 } } })).rejects.toBe(reason);
    expect((await store.get(ref.objectNumber))!.value).toMatchObject({ kind: "number", value: 7 });
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([262144, 524288])("streams %i generated borrowed bytes with bounded reads and owned output", async length => {
  const scratch = new Uint8Array(4096).fill(42); let reads = 0;
  const storage = { allocate: () => 0, write: async () => {}, read: async (_position: number, size: number) => { expect(size).toBeLessThanOrEqual(4096); reads++; return scratch.subarray(0, size); } };
  const node: PdfCosNode = { kind: "string", bytes: new Uint8Array(), storedBytes: { storage, position: 0, byteLength: length } };
  let total = 0; const held: Uint8Array[] = [];
  for await (const bytes of serializeRetainedCosNodeChunks(node, { chunkBytes: 1024 })) {
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024);
    if (!total) { expect(bytes[0]).toBe(40); expect(reads).toBe(1); held.push(bytes); }
    total += bytes.length; await Promise.resolve();
  }
  expect(total).toBe(length + 2); expect(held[0]![0]).toBe(40); expect(held[0]![1]).toBe(42); expect(reads).toBe(length / 4096);
});

it("observes cancellation between emitted chunks of an ordinary stream", async () => {
  const controller = new AbortController(), reason = new Error("cancel output");
  const node: PdfCosNode = { kind: "stream", dict: cosDict({}), rawBytes: new Uint8Array(65536) };
  const iterator = serializeRetainedCosNodeChunks(node, { chunkBytes: 128, signal: controller.signal });
  expect((await iterator.next()).done).toBe(false); controller.abort(reason);
  await expect(iterator.next()).rejects.toBe(reason);
});
