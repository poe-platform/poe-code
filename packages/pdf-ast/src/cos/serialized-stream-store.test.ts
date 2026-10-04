import { expect, it } from "vitest";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosNumber, dictGet } from "../ast.js";
import { PdfMutableObjectStore } from "./mutable-object-store.js";

const encoder = new TextEncoder();
const dictionary = encoder.encode("<< /Length 3 /Label <4142> >>");
async function collect(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
  const parts = []; for await (const bytes of chunks) { expect(bytes.length).toBeLessThanOrEqual(16384); parts.push(bytes); }
  return Buffer.concat(parts);
}

it("stores serialized dictionaries and stream bytes as independently readable snapshots", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    const value = { objectNumber: 7, generationNumber: 2, body: { length: dictionary.length, chunks: [dictionary] }, stream: { length: 3, chunks: [Uint8Array.of(1, 2, 3)] } };
    await store.setSerializedValue(value);
    const saved = (await store.get(7))!;
    expect(saved.stream?.length).toBe(3); expect(saved.stream?.decoded).toBe(false);
    expect(saved.value.kind === "dict" && dictGet(saved.value, "Label")).toMatchObject({ kind: "string", format: "hex" });
    const outputs = store.outputObjects(), snapshot = (await outputs.next()).value!; await outputs.return();
    await store.markDecoded(saved); expect((await store.get(7))!.stream?.decoded).toBe(true);
    await store.delete(7); await store.setSerializedValue({ ...value, generationNumber: 4, stream: { length: 3, chunks: [Uint8Array.of(9, 8, 7)], decoded: true } });
    expect((await store.get(7))!.generationNumber).toBe(4);
    expect(await collect(saved.stream!.chunks)).toEqual(Buffer.from([1, 2, 3]));
    expect(await collect(snapshot.body.chunks)).toEqual(Buffer.concat([dictionary, encoder.encode("\nstream\n"), Buffer.from([1, 2, 3]), encoder.encode("\nendstream")]));
    expect(snapshot.body.length).toBe(dictionary.length + 3 + 18);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("streams wide dictionary syntax without parsing and retains reused producer buffers", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { maxNodes: 1 });
  const prefix = encoder.encode("<< /Length 70000 /Values [ "), item = encoder.encode("1 "), suffix = encoder.encode("] >>");
  let returned = false;
  try {
    await store.setSerializedValue({ objectNumber: 1, generationNumber: 0,
      body: { length: prefix.length + 40000 * item.length + suffix.length, chunks: (async function* () { yield prefix; for (let i = 0; i < 40000; i++) yield item; yield suffix; })() },
      stream: { length: 70000, chunks: (async function* () { try { const bytes = new Uint8Array(1000); for (let i = 0; i < 70; i++) { bytes.fill(i); yield bytes; } bytes.fill(255); } finally { returned = true; } })() }
    });
    expect(returned).toBe(true); await expect(store.get(1)).rejects.toThrow();
    const outputs = store.outputObjects(), object = (await outputs.next()).value!; await outputs.return();
    const bytes = await collect(object.body.chunks);
    const start = prefix.length + 80000 + suffix.length + 8;
    expect(bytes.subarray(start, start + 70000).every((byte, i) => byte === Math.floor(i / 1000))).toBe(true);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("checks both declared lengths before consuming either input", async () => {
  const fs = createMemoryFileSystem(); const store = new PdfMutableObjectStore({ fs, directory: "/" }, { maxStagingBytes: 100 });
  let reads = 0;
  const chunks = { *[Symbol.iterator]() { reads++; yield dictionary; } };
  try {
    for (const length of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      await expect(store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: dictionary.length, chunks }, stream: { length, chunks } })).rejects.toThrow();
    }
    await expect(store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: dictionary.length, chunks }, stream: { length: 100, chunks } })).rejects.toThrow("limit");
    expect(reads).toBe(0);
  } finally { await store.close(); }
});

it("leaves failed dictionary and stream replacements uncommitted and closes producers", async () => {
  const fs = createMemoryFileSystem(); const store = new PdfMutableObjectStore({ fs, directory: "/" });
  try {
    await store.set({ objectNumber: 1, generationNumber: 3, value: cosNumber(7) });
    for (const length of [2, 4]) {
      let closed = false;
      await expect(store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: dictionary.length, chunks: [dictionary] }, stream: { length,
        chunks: (async function* () { try { yield Uint8Array.of(1, 2, 3); } finally { closed = true; } })() }
      })).rejects.toThrow(length === 2 ? "Excess" : "Incomplete");
      expect(closed).toBe(true); expect((await store.get(1))!).toMatchObject({ generationNumber: 3, value: { kind: "number", value: 7 } });
    }
    let streamRead = false;
    await expect(store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: dictionary.length + 1, chunks: [dictionary] }, stream: { length: 3, chunks: (async function* () { streamRead = true; yield Uint8Array.of(1, 2, 3); })() } })).rejects.toThrow("Incomplete");
    expect(streamRead).toBe(false); expect((await store.get(1))!.generationNumber).toBe(3);
  } finally { await store.close(); }
});

it("preserves empty streams and yields to cancellation during stream ingestion", async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new Error("cancel serialized stream");
  const store = new PdfMutableObjectStore({ fs, directory: "/" }, { signal: controller.signal });
  try {
    const empty = encoder.encode("<< /Length 0 >>");
    await store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: empty.length, chunks: [empty] }, stream: { length: 0, chunks: [], decoded: true } });
    expect((await store.get(1))!.stream).toMatchObject({ length: 0, decoded: true });
    let consumed = 0, closed = false;
    const timer = setTimeout(() => controller.abort(reason), 0);
    try {
      await expect(store.setSerializedValue({ objectNumber: 2, generationNumber: 0, body: { length: dictionary.length, chunks: [dictionary] }, stream: { length: 2000 * 1024,
        chunks: (async function* () { try { const bytes = new Uint8Array(1024); for (let i = 0; i < 2000; i++) { consumed++; yield bytes; } } finally { closed = true; } })() }
      })).rejects.toBe(reason);
      expect(consumed).toBeLessThan(2000); expect(closed).toBe(true);
    } finally { clearTimeout(timer); }
  } finally { await store.close(); }
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([128 * 1024, 2 * 1024 * 1024])("backs %i stream bytes with bounded writes and no payload-holding test spool", async length => {
  // Only nonzero metadata pages persist. Zero payload pages are regenerated;
  // this oracle cannot hide the generated stream in a memory filesystem.
  const pages = new Map<number, Uint8Array>();
  let opened = 0, closed = 0, outstanding = 0, peak = 0, writes = 0, reads = 0;
  const fs = {
    stat: async () => ({ type: "directory", size: 0 }),
    removeFileConditional: async () => {},
    async open() {
      opened++;
      return {
        capabilities: { positionedRead: true, positionedWrite: true }, stat: async () => ({ type: "file", size: 0 }),
        async write(bytes: Uint8Array, position: number) {
          expect(outstanding).toBe(0); outstanding += bytes.length; peak = Math.max(peak, outstanding);
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384); expect(position % 16384).toBe(0); expect(bytes.length).toBe(16384);
          const before = bytes.slice(); await Promise.resolve(); expect(bytes.every((byte, i) => byte === before[i])).toBe(true);
          if (bytes.some(byte => byte !== 0)) pages.set(position, bytes.slice()); else pages.delete(position);
          expect(pages.size).toBeLessThanOrEqual(4);
          outstanding -= bytes.length; writes++; return bytes.length;
        },
        async read(bytes: Uint8Array, position: number) {
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384); expect(position % 16384).toBe(0);
          bytes.fill(0); const page = pages.get(position); if (page) bytes.set(page); reads++; return bytes.length;
        },
        async close() { closed++; pages.clear(); }
      };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); }
  } as unknown as FileSystem;
  const store = new PdfMutableObjectStore({ fs, directory: "/" });
  const dict = encoder.encode(`<< /Length ${length} >>`);
  try {
    await store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: dict.length, chunks: [dict] }, stream: { length,
      chunks: (async function* () { const bytes = new Uint8Array(1024); for (let offset = 0; offset < length; offset += bytes.length) yield bytes; })() } });
    const value = (await store.get(1))!; let received = 0;
    for await (const bytes of value.stream!.chunks) { expect(bytes.length).toBeLessThanOrEqual(16384); expect(bytes.every(byte => byte === 0)).toBe(true); received += bytes.length; bytes.fill(255); await Promise.resolve(); }
    expect(received).toBe(length); expect(opened).toBe(1); expect(writes).toBeGreaterThan(4); expect(reads).toBeGreaterThan(0); expect(peak).toBeLessThanOrEqual(16384);
  } finally { await store.close(); }
  expect(closed).toBe(opened); expect(pages.size).toBe(0);
});

it("keeps the previous identity after a backing write fails and closes the stream producer", async () => {
  const base = createMemoryFileSystem(), reason = new Error("write failed"); let fail = false, closed = 0, opened = 0;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const handle = await target.open!(...args); opened++;
      return new Proxy(handle, { get(owner, field) {
        if (field === "write") return async (...write: Parameters<typeof handle.write>) => { if (fail) throw reason; return owner.write(...write); };
        if (field === "close") return async () => { closed++; await owner.close(); };
        const value = Reflect.get(owner, field); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const store = new PdfMutableObjectStore({ fs, directory: "/" }); let producerClosed = false;
  try {
    await store.set({ objectNumber: 1, generationNumber: 5, value: cosNumber(9) }); fail = true;
    await expect(store.setSerializedValue({ objectNumber: 1, generationNumber: 0, body: { length: dictionary.length, chunks: [dictionary] }, stream: { length: 1024 * 1024,
      chunks: (async function* () { try { const bytes = new Uint8Array(1024); for (let i = 0; i < 1024; i++) yield bytes; } finally { producerClosed = true; } })() }
    })).rejects.toBe(reason);
    fail = false;
    expect(producerClosed).toBe(true); expect((await store.get(1))!).toMatchObject({ generationNumber: 5, value: { kind: "number", value: 9 } });
  } finally { await store.close(); }
  expect(opened).toBeGreaterThan(0); expect(closed).toBe(opened); expect(await base.readdir("/")).toEqual([]);
});

it("borrows raw streams without parsing wide dictionaries and retains deleted snapshots", async () => {
  const fs = createMemoryFileSystem(), store = new PdfMutableObjectStore({fs,directory:"/"},{maxNodes:1});
  const body=encoder.encode("<< /Length 3 /Values [1 2 3] >>");
  try {
    await store.setSerializedValue({objectNumber:1,generationNumber:0,body:{length:body.length,chunks:[body]},stream:{length:3,chunks:[Uint8Array.of(1,2,3)]}});
    await expect(store.get(1)).rejects.toThrow();
    const snapshot=(await store.getStream(1))!; await store.delete(1);
    expect(await store.getStream(1)).toBeUndefined(); expect(await collect(snapshot.chunks)).toEqual(Buffer.from([1,2,3]));
    await store.setSerializedValue({objectNumber:2,generationNumber:0,body:{length:1,chunks:[encoder.encode("1")]}});
    expect(await store.getStream(2)).toBeUndefined(); expect(await store.getStream(999)).toBeUndefined();
  }finally{await store.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
