import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosDict, cosName, cosNumber, cosRef, cosStream, cosString } from "../ast.js";
import { serializeCosDocument } from "./writer.js";
import { serializeRetainedCosDocumentChunks } from "./retained-writer.js";

it("preserves ordinary serializer bytes with sparse generations and borrowed stream chunks", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const payload = new TextEncoder().encode("stream payload"), dict = cosDict({ Length: cosNumber(999), Custom: cosString("value") });
  dict.entries.push({ key: cosName("Length"), value: cosNumber(1) });
  const objects = [{ objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog") }) },
    { objectNumber: 4, generationNumber: 2, value: cosStream(payload, { dict, compress: false }) }];
  async function* input() {
    yield objects[0]!;
    yield { objectNumber: 4, generationNumber: 2, value: dict, stream: { length: payload.length, chunks: (async function* () {
      const scratch = new Uint8Array(3);
      for (let at = 0; at < payload.length; at += 3) { const count = Math.min(3, payload.length - at); scratch.set(payload.subarray(at, at + count)); yield scratch.subarray(0, count); }
    })() } };
  }
  const chunks = [];
  for await (const bytes of serializeRetainedCosDocumentChunks({ objects: input(), rootRef: cosRef(1), chunkBytes: 7 }, { fs, directory: "/scratch" })) {
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(7); chunks.push(bytes.slice()); bytes.fill(0); await Promise.resolve();
  }
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(serializeCosDocument({ objects, rootRef: cosRef(1) }));
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("does not pull objects or payloads ahead of the consumer and closes on return", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let pulled = 0, closed = false;
  async function* objects() { try { pulled++; yield { objectNumber: 1, generationNumber: 0, value: cosNumber(3) }; pulled++; } finally { closed = true; } }
  const output = serializeRetainedCosDocumentChunks({ objects: objects(), rootRef: cosRef(1), chunkBytes: 4 }, { fs, directory: "/scratch" });
  await output.next(); await Promise.resolve(); expect(pulled).toBe(0);
  for (let i = 0; i < 20 && !pulled; i++) await output.next();
  expect(pulled).toBe(1); await output.return(); expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["short", "long", "order", "budget", "cancel"])("rejects %s output and releases backing", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel writer");
  async function* objects() {
    yield { objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 4, chunks: (async function* () {
      if (mode === "cancel") controller.abort(reason);
      yield new Uint8Array(mode === "short" ? 3 : mode === "long" ? 5 : 4);
    })() } };
    if (mode === "order") yield { objectNumber: 1, generationNumber: 0, value: cosNumber(0) };
  }
  await expect((async () => { for await (const ignored of serializeRetainedCosDocumentChunks({ objects: objects(), rootRef: cosRef(1), signal: controller.signal,
    ...(mode === "budget" ? { maxOutputBytes: 1 } : {}) }, { fs, directory: "/scratch" })) void ignored; })()).rejects.toThrow();
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([4097, 8193])("writes %i objects with scalar external xref backing and fixed ranges", async count => {
  const header = new TextEncoder().encode("%PDF-1.7\n%\x81\x81\x81\x81\n\n").length;
  const fixed = " 0 obj\nnull\nendobj\n\n".length;
  function position(number: number) {
    let result = header + (number - 1) * fixed;
    for (let digits = 1, first = 1; first < number; digits++, first *= 10) result += Math.min(number - first, first * 9) * digits;
    return result;
  }
  function expected(at: number, length: number) {
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length; offset++) {
      const absolute = at + offset - 8, number = Math.floor(absolute / 16), local = absolute % 16;
      if (number < 1 || number > count || local >= 8) continue;
      const record = new Uint8Array(8); new DataView(record.buffer).setFloat64(0, position(number)); bytes[offset] = record[local]!;
    }
    return bytes;
  }
  let opens = 0, closes = 0, size = 0, peak = 0, active = false;
  const fs = {
    async stat() { return { type: "directory", size: 0 }; }, async removeFileConditional() {},
    async open() {
      opens++;
      return { capabilities: { positionedRead: true, positionedWrite: true }, async stat() { return { type: "file", size }; }, async close() { closes++; },
        async write(bytes: Uint8Array, at: number) { expect(active).toBe(false); active = true; peak = Math.max(peak, bytes.length); expect(bytes).toEqual(expected(at, bytes.length)); await Promise.resolve(); size = Math.max(size, at + bytes.length); active = false; return bytes.length; },
        async read(bytes: Uint8Array, at: number) { expect(active).toBe(false); peak = Math.max(peak, bytes.length); bytes.set(expected(at, bytes.length)); return bytes.length; },
      };
    },
    readFile() { throw new Error("whole read"); }, writeFile() { throw new Error("whole write"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  async function* objects() { for (let number = 1; number <= count; number++) yield { objectNumber: number, generationNumber: 0, ...(number % 2 ? { value: { kind: "null" as const } } : { body: { length: 4, chunks: [new TextEncoder().encode("null")] } }) }; }
  let total = 0;
  for await (const bytes of serializeRetainedCosDocumentChunks({ objects: objects(), rootRef: cosRef(1), chunkBytes: 64 }, { fs, directory: "/external" })) {
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(64); total += bytes.length; await Promise.resolve();
  }
  expect(total).toBeGreaterThan(count * 20); expect(opens).toBe(1); expect(closes).toBe(1); expect(peak).toBeLessThanOrEqual(16384);
});

it.each(["short", "long", "limit", "cancel", "failure"])("owns serialized body cleanup after %s", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController(), reason = new Error("body failed"); let closed = false, pulled = false;
  async function* chunks() {
    try {
      pulled = true;
      if (mode === "failure") throw reason;
      if (mode === "cancel") controller.abort(reason);
      yield new Uint8Array(mode === "short" ? 3 : mode === "long" ? 5 : 4);
    } finally { closed = true; }
  }
  const objects = [{ objectNumber: 1, generationNumber: 0, body: { length: 4, chunks: chunks() } }];
  await expect((async () => { for await (const ignored of serializeRetainedCosDocumentChunks({ objects, rootRef: cosRef(1), signal: controller.signal,
    ...(mode === "limit" ? { maxOutputBytes: 31 } : {}) }, { fs, directory: "/scratch" })) void ignored; })()).rejects.toThrow();
  expect(pulled).toBe(mode !== "limit"); expect(closed).toBe(mode !== "limit"); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("yields to timer cancellation while splitting one large serialized body chunk", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel body"); let closed = false;
  async function* chunks() { try { yield new Uint8Array(1024 * 1024); } finally { closed = true; } }
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect((async () => { for await (const ignored of serializeRetainedCosDocumentChunks({ objects: [{ objectNumber: 1, generationNumber: 0, body: { length: 1024 * 1024, chunks: chunks() } }],
      rootRef: cosRef(1), chunkBytes: 1024, signal: controller.signal }, { fs, directory: "/scratch" })) void ignored; })()).rejects.toBe(reason);
  } finally { clearTimeout(timer); }
  expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});
