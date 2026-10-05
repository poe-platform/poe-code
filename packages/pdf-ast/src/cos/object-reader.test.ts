import { describe, expect, it, vi } from "vitest";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { dictGet, type PdfXRefEntry } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { openPdfCrossReference } from "./cross-reference.js";
import { PdfObjectIndex } from "./object-index.js";
import { PdfObjectReader, openPdfObjectReader } from "./object-reader.js";
import { readFileSync } from "node:fs";
import { decodeStreamObject } from "./filters.js";

const encode = (s: string) => new TextEncoder().encode(s);
async function fixture(text: string, entries: PdfXRefEntry[], options = {}) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch"); await fs.writeFile("/input", encode(text));
  const readFile = vi.fn(async () => { throw new Error("whole read forbidden"); });
  const bytes = encode(text);
  const scratch = new Uint8Array(7);
  const input = { capabilities: { retainedRead: true }, readFile, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }), close: async () => {},
    read: async (offset: number, length: number) => { const part = bytes.subarray(offset, offset + length); scratch.set(part); return scratch.subarray(0, part.length); },
  }) } as unknown as FileSystem;
  const source = await PdfFileSource.open(input, "/input", { chunkBytes: 7, cacheBytes: 14 });
  const storage = { fs, directory: "/scratch" };
  const index = await PdfObjectIndex.build(entries, storage, { chunkBytes: 32, cacheBytes: 32, runEntries: 2 });
  const reader = new PdfObjectReader(source, index, storage, { chunkBytes: 16, cacheBytes: 32, ...options });
  return { fs, source, index, reader, readFile, async close() { await reader.close(); await index.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}
const plain = (objectNumber: number, offset = 0): PdfXRefEntry => ({ objectNumber, type: "uncompressed", offset });
const compressed = (objectNumber: number, indexInStream: number): PdfXRefEntry => ({ objectNumber, type: "compressed", objectStreamNumber: 10, indexInStream });
function objectStream(body = "1 0 2 5 <<>> [1 0 R]", count = 2, first = 8) {
  return `10 0 obj << /Type /ObjStm /N ${count} /First ${first} /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj`;
}

describe("range-backed PDF object reader", () => {
  it("selects native image payloads per call without changing subsequent decoding", async () => {
    const f = await fixture("1 0 obj << /Filter [/ASCIIHexDecode /DCTDecode /Unsupported] /Length 13 >>\nstream\nFFD81117FFD9>\nendstream\nendobj", [plain(1)]);
    const result: number[] = [];
    for await (const chunk of f.reader.decodeStream(1, 0, { stopBeforeImageCodec: true })) result.push(...chunk);
    expect(result).toEqual([255, 216, 17, 23, 255, 217]);
    await expect(f.reader.decodeStream(1).next()).rejects.toThrow("Unsupported");
    expect(f.readFile).not.toHaveBeenCalled();
    await f.close();
  });
  it.each(["decode", "compressed", "length", "filter"])("preserves selected value backing during %s stream lookup", async mode => {
    const bytes = new Uint8Array(2_000_000);
    let end = 0, largest = 0;
    const backing = {
      allocate(length: number) { const position = end; end += length; return position; },
      async read(position: number, length: number) { return bytes.subarray(position, position + length); },
      async write(position: number, chunk: Uint8Array) { largest = Math.max(largest, chunk.length); bytes.set(chunk, position); }
    };
    const resources = "/Resources << /Font << /F << /Widths [" + "500 ".repeat(1024) + "] >> >> >> /ActualText (" + "text ".repeat(1024) + ")";
    const body = "1 0 <<>>", payload = mode === "filter" ? "68656c6c6f>" : "hello";
    const first = mode === "compressed"
      ? `10 0 obj << /Type /ObjStm /N 1 /First 4 /Length ${body.length} ${resources} >>\nstream\n${body}\nendstream\nendobj`
      : `1 0 obj << /Length ${mode === "length" ? "2 0 R" : payload.length} ${mode === "filter" ? "/Filter [/ASCIIHexDecode]" : ""} ${mode === "length" ? "" : resources} >>\nstream\n${payload}\nendstream\nendobj\n`;
    // An invalid stream-valued Length is still parsed before the parent's
    // endstream fallback; its resources must not bypass the backing policy.
    const text = first + (mode === "length" ? `2 0 obj << /Length 1 ${resources} >>\nstream\nx\nendstream\nendobj` : "");
    const f = await fixture(text, mode === "compressed" ? [compressed(1, 0), plain(10)] : [plain(1), ...(mode === "length" ? [plain(2, first.length)] : [])],
      { valueArrays: { arrayStorage: backing, storedArrayKeys: ["Widths", "Filter"], stringStorage: backing, storedStringKeys: ["ActualText"] } });
    try {
      if (mode === "compressed") expect((await f.reader.get(1))?.value.kind).toBe("dict");
      else {
        let result = "";
        for await (const chunk of f.reader.decodeStream(1)) result += new TextDecoder().decode(chunk);
        expect(result).toBe("hello");
      }
      expect(end).toBeGreaterThan(5120);
      expect(largest).toBeLessThanOrEqual(4096);
    } finally { await f.close(); }
  });

  it("preserves a nested backing failure through outer stream recovery and allows a later read", async () => {
    const first = "1 0 obj << /Length 2 0 R >>\nstream\nhello\nendstream\nendobj\n";
    const text = first + "2 0 obj << /Length 1 /Widths [500] >>\nstream\nx\nendstream\nendobj";
    const failure = new PdfError("E_PARSE", "caller backing failed");
    let fail = true, end = 0;
    const bytes = new Uint8Array(4096), backing = {
      allocate(length: number) { const position = end; end += length; return position; },
      async read(position: number, length: number) { return bytes.subarray(position, position + length); },
      async write(position: number, chunk: Uint8Array) { if (fail) { fail = false; throw failure; } bytes.set(chunk, position); }
    };
    const f = await fixture(text, [plain(1), plain(2, first.length)], { recovery: "repair", valueArrays: { arrayStorage: backing, storedArrayKeys: ["Widths"] } });
    try {
      await expect(f.reader.decodeStream(1).next()).rejects.toBe(failure);
      let result = "";
      for await (const chunk of f.reader.decodeStream(1)) result += new TextDecoder().decode(chunk);
      expect(result).toBe("hello");
    } finally { await f.close(); }
  });

  it.each(["catalog", "trailer"])("preserves caller backing failures during %s bootstrap recovery", async location => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    const objects = [
      `1 0 obj << /Type /Catalog /Pages 2 0 R ${location === "catalog" ? "/Widths [500]" : ""} >> endobj\n`,
      "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n"
    ];
    let text = "%PDF-1.7\n";
    const offsets = objects.map(object => { const offset = text.length; text += object; return offset; });
    const xref = text.length;
    text += `xref\n0 3\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 3 /Root 1 0 R ${location === "trailer" ? "/Widths [500]" : ""} >>\nstartxref\n${xref}\n%%EOF`;
    await fs.writeFile("/input", encode(text));
    const source = await PdfFileSource.open(fs, "/input");
    const failure = new PdfError("E_PARSE", "caller metadata backing unavailable");
    let failed = false, end = 0;
    const bytes = new Uint8Array(4096);
    const backing = {
      allocate(length: number) { const position = end; end += length; return position; },
      async read(position: number, length: number) { return bytes.slice(position, position + length); },
      async write(position: number, chunk: Uint8Array) {
        if (!failed) { failed = true; throw failure; }
        bytes.set(chunk, position);
      }
    };
    const arrays = { arrayStorage: backing, storedArrayKeys: ["Widths"] };
    const options = { recovery: "repair" as const, valueArrays: arrays, xref: arrays };
    try {
      let opened: Awaited<ReturnType<typeof openPdfObjectReader>> | undefined;
      try {
        await expect(openPdfObjectReader(source, { fs, directory: "/scratch" }, options).then(value => { opened = value; })).rejects.toBe(failure);
      } finally { await opened?.close(); }
      expect(await fs.readdir("/scratch")).toEqual([]);
      // A separate caller retry can succeed; recovery must not retry a failed capability itself.
      opened = await openPdfObjectReader(source, { fs, directory: "/scratch" }, options);
      await opened.close();
      expect(await fs.readdir("/scratch")).toEqual([]);
    } finally { await source.close(); }
  });

  it("loads only requested objects and retains stream ranges", async () => {
    const first = "1 0 obj << /Length 3 0 R >>\nstream\nhello\nendstream\nendobj\n";
    const f = await fixture(first + "3 0 obj 5 endobj", [plain(1), plain(3, first.length)]);
    expect(await f.reader.get(2)).toBeUndefined();
    const object = await f.reader.get(1);
    expect(object?.value.kind).toBe("dict");
    expect(object?.stream && object.stream.end - object.stream.start).toBe(5);
    expect(f.readFile).not.toHaveBeenCalled();
    await f.reader.close();
    expect((await f.source.read(0, 1))[0]).toBe(49);
    await expect(f.reader.get(1)).rejects.toThrow("closed");
    await f.close();
  });

  it("validates xref identities and generations", async () => {
    const f = await fixture("2 0 obj null endobj", [plain(1), plain(2)]);
    await expect(f.reader.get(1)).rejects.toThrow("identity");
    expect(await f.reader.get(2, 1)).toBeUndefined();
    await f.close();
  });

  it("reads compressed objects by ordinal from caller-backed header records", async () => {
    const f = await fixture(objectStream(), [plain(10), compressed(1, 0), compressed(2, 1), compressed(3, 1)]);
    const second = await f.reader.get(2);
    expect(second?.value).toMatchObject({ kind: "array", items: [{ kind: "ref", objectNumber: 1 }] });
    expect((await f.reader.get(1))?.value).toMatchObject({ kind: "dict", entries: [] });
    await expect(f.reader.get(3)).rejects.toThrow("identity");
    expect(f.readFile).not.toHaveBeenCalled();
    await f.close();
  });

  it("preserves generated compressed document values", async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("lazy objects", { x: 20, y: 30 });
    const bytes = doc.save({ objectStreams: "generate" });
    const expected = PdfDocument.load(bytes).cos;
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
    const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 31, cacheBytes: 62 });
    const storage = { fs, directory: "/scratch" };
    const xref = await openPdfCrossReference(source, storage);
    const reader = new PdfObjectReader(source, xref.index, storage);
    const root = await reader.get(xref.rootRef.objectNumber);
    expect(root?.value.kind).toBe("dict");
    if (root?.value.kind === "dict") expect(dictGet(root.value, "Type")).toMatchObject({ decoded: "Catalog" });
    for (const entry of expected.revisions[0]!.entries.values()) {
      if (entry.type === "compressed") expect((await reader.get(entry.objectNumber))?.objectNumber).toBe(entry.objectNumber);
    }
    await reader.close(); await xref.index.close(); await source.close();
    expect(await fs.readdir("/scratch")).toEqual([]);
  });

  it.each([
    ["1 0 2 0 <<>>", 2, 8],
    ["1 0 2 99 <<>>", 2, 9],
    ["1 0 <<>>", 2, 4],
  ])("cleans malformed object-stream header staging (%s)", async (body, count, first) => {
    const f = await fixture(objectStream(body, count, first), [plain(10), compressed(1, 0)]);
    const before = await f.fs.readdir("/scratch");
    await expect(f.reader.get(1)).rejects.toBeDefined();
    expect(await f.fs.readdir("/scratch")).toEqual(before);
    await f.close();
  });

  it("does not parse a compressed value past its next member", async () => {
    const f = await fixture(objectStream("1 0 2 2 [ 42 ]"), [plain(10), compressed(1, 0)]);
    await expect(f.reader.get(1)).rejects.toThrow();
    await f.close();
  });

  it("charges combined decoded data and header storage before writes", async () => {
    const f = await fixture(objectStream(), [plain(10), compressed(1, 0)], { maxStagingBytes: 40 });
    const before = await f.fs.readdir("/scratch");
    await expect(f.reader.get(1)).rejects.toThrow("limit");
    expect(await f.fs.readdir("/scratch")).toEqual(before);
    await f.close();
  });

  it("bounds indirect length cycles", async () => {
    const f = await fixture("1 0 obj << /Length 1 0 R >>\nstream\na\nendstream\nendobj", [plain(1)]);
    await expect(f.reader.get(1)).rejects.toThrow("cycle");
    await f.close();
  });

  it("honors cancellation and parser admission", async () => {
    const abort = new AbortController();
    const f = await fixture("1 0 obj (oversized) endobj", [plain(1)], { maxTokenBytes: 3, signal: abort.signal });
    await expect(f.reader.get(1)).rejects.toThrow();
    abort.abort(new Error("cancelled"));
    await expect(f.reader.get(1)).rejects.toThrow("cancelled");
    await f.close();
  });
  it("evicts decoded object streams and does not retain caller-mutated ASTs", async () => {
    const first = objectStream();
    const second = objectStream("3 0 <<>>", 1, 4).replace("10 0 obj", "20 0 obj");
    const f = await fixture(first + "\n" + second, [plain(10), plain(20, first.length + 1), compressed(1, 0),
      { objectNumber: 3, type: "compressed", objectStreamNumber: 20, indexInStream: 0 }], { objectStreamCacheEntries: 1 });
    const one = await f.reader.get(1);
    if (one?.value.kind === "dict") one.value.entries.push({ key: { kind: "name", decoded: "Mutated", rawBytes: encode("Mutated") }, value: { kind: "null" } });
    expect((await f.reader.get(1))?.value).toMatchObject({ entries: [] });
    const before = await f.fs.readdir("/scratch");
    await f.reader.get(3);
    const after = await f.fs.readdir("/scratch");
    expect(after).toHaveLength(before.length);
    expect(after.filter(entry => before.some(previous => previous.name === entry.name))).toHaveLength(1); // Caller-owned xref only.
    expect((await f.reader.get(1))?.value).toMatchObject({ entries: [] });
    await f.close();
  });

  it("cleans partial header writes while preserving the storage error", async () => {
    const f = await fixture(objectStream(), [plain(10), compressed(1, 0)]);
    const before = await f.fs.readdir("/scratch");
    const create = f.fs.createStagedFile!.bind(f.fs);
    const failure = new Error("write failed");
    let calls = 0;
    vi.spyOn(f.fs, "createStagedFile").mockImplementation(async (...args) => {
      const staged = await create(...args);
      return ++calls === 2 ? { ...staged, writer: { ...staged.writer!, write: async () => { throw failure; } } } : staged;
    });
    await expect(f.reader.get(1)).rejects.toBe(failure);
    expect(await f.fs.readdir("/scratch")).toEqual(before);
    await f.close();
  });

  it.each([65, 513])("reads %i compressed members with generated external storage and bounded writes", async count => {
    const scope = {};
    const first = count * 20;
    const dataSize = first + count * 5;
    const head = `${count + 1} 0 obj << /Type /ObjStm /N ${count} /First ${first} /Length ${dataSize} >>\nstream\n`;
    const tail = "\nendstream\nendobj";
    const size = head.length + dataSize + tail.length;
    const dataByte = (offset: number) => {
      if (offset >= first) return "null ".charCodeAt((offset - first) % 5);
      const ordinal = Math.floor(offset / 20);
      const row = `${String(ordinal + 1).padStart(9, "0")} ${String(ordinal * 5).padStart(9, "0")} `;
      return row.charCodeAt(offset % 20);
    };
    const tapeByte = (offset: number) => {
      const ordinal = Math.floor(offset / 16);
      const row = new Uint8Array(16); const view = new DataView(row.buffer);
      view.setFloat64(0, ordinal + 1); view.setFloat64(8, ordinal * 5);
      return row[offset % 16]!;
    };
    const live = new Map<string, { size: number; revision: number; tape: boolean; identity: string }>();
    const stat = (state: { size: number; revision: number; identity: string }): FileStat => ({
      type: "file", size: state.size, identityScope: scope, opaqueIdentity: state.identity, revision: state.revision,
      mode: 0o600, mtimeMs: state.revision, ctimeMs: state.revision, atimeMs: 0,
    });
    let created = 0;
    let outstanding = 0;
    let peakWrite = 0;
    const fs = {
      capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
      stat: async () => ({ type: "directory", size: 0 }),
      async createStagedFile(path: string) {
        const state = { size: 0, revision: 0, tape: created++ % 2 === 1, identity: path };
        live.set(path, state);
        return { file: { path, stat: stat(state) }, cleanup: { remove: async () => { live.delete(path); }, close: async () => {} },
          writer: { async write(bytes: Uint8Array) {
            outstanding += bytes.byteLength;
            peakWrite = Math.max(peakWrite, outstanding);
            expect(bytes.buffer.byteLength).toBeLessThanOrEqual(64);
            await Promise.resolve(); // A pending sink must prevent the next write.
            for (let i = 0; i < bytes.length; i++) expect(bytes[i]).toBe((state.tape ? tapeByte : dataByte)(state.size + i));
            state.size += bytes.length; state.revision++;
            outstanding -= bytes.byteLength;
          }, finish: async () => stat(state) } };
      },
      async openReadFile(path: string) {
        const state = live.get(path);
        return { stat: async () => state ? stat(state) : { type: "file", size }, close: async () => {},
          async read(position: number, length: number) {
            expect(length).toBeLessThanOrEqual(64);
            const bytes = new Uint8Array(Math.min(length, (state?.size ?? size) - position));
            for (let i = 0; i < bytes.length; i++) {
              const at = position + i;
              bytes[i] = state ? (state.tape ? tapeByte : dataByte)(at) : at < head.length ? head.charCodeAt(at) : at < head.length + dataSize ? dataByte(at - head.length) : tail.charCodeAt(at - head.length - dataSize);
            }
            return bytes;
          } };
      },
      readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
    } as unknown as FileSystem;
    const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 64, cacheBytes: 128 });
    const index = { async get(number: number): Promise<PdfXRefEntry | undefined> {
      return number === count + 1 ? plain(number) : number > 0 && number <= count ? { objectNumber: number, type: "compressed", objectStreamNumber: count + 1, indexInStream: number - 1 } : undefined;
    } };
    const reader = new PdfObjectReader(source, index, { fs, directory: "/authorized" }, { chunkBytes: 64, cacheBytes: 128 });
    for (const number of [count, 1, Math.ceil(count / 2)]) expect((await reader.get(number))?.value).toMatchObject({ kind: "null" });
    expect(created).toBe(2); expect(live.size).toBe(2); expect(peakWrite).toBeLessThanOrEqual(64);
    await reader.close(); expect(live.size).toBe(0); await source.close();
  });

  it("resolves compressed indirect lengths and indirect filter names", async () => {
    const payload = "1 0 2 5 <<>> 5";
    const hex = Array.from(encode(payload), byte => byte.toString(16).padStart(2, "0")).join("") + ">";
    const container = `10 0 obj << /Type /ObjStm /N 2 /First 8 /Length ${hex.length} /Filter 4 0 R >>\nstream\n${hex}\nendstream\nendobj\n`;
    const filter = "4 0 obj /ASCIIHexDecode endobj\n";
    const stream = "5 0 obj << /Length 2 0 R >>\nstream\nhello\nendstream\nendobj";
    const f = await fixture(container + filter + stream, [plain(10), compressed(1, 0), compressed(2, 1), plain(4, container.length), plain(5, container.length + filter.length)]);
    expect((await f.reader.get(1))?.value).toMatchObject({ kind: "dict" });
    const result = await f.reader.get(5);
    expect(result?.stream && result.stream.end - result.stream.start).toBe(5);
    await f.close();
  });

  it("cancels staged decoding and closes accepted concurrent reads before cleanup", async () => {
    const abort = new AbortController();
    const f = await fixture(objectStream(), [plain(10), compressed(1, 0), compressed(2, 1)], { signal: abort.signal });
    const before = await f.fs.readdir("/scratch");
    const create = f.fs.createStagedFile!.bind(f.fs);
    const failure = new Error("cancel staged decode");
    vi.spyOn(f.fs, "createStagedFile").mockImplementation(async (...args) => {
      const staged = await create(...args);
      return { ...staged, writer: { ...staged.writer!, write: async (bytes, options) => { await staged.writer!.write(bytes, options); abort.abort(failure); } } };
    });
    const results = Promise.allSettled([f.reader.get(1), f.reader.get(2)]);
    await f.reader.close();
    for (const result of await results) expect(result).toMatchObject({ status: "rejected", reason: failure });
    expect(await f.fs.readdir("/scratch")).toEqual(before);
    await f.close();
  });

  it.each([3, 6] as const)("authenticates and lazily decodes revision %i encrypted documents", async revision => {
    const doc = PdfDocument.create(); doc.addPage().drawText("retained encrypted document", { x: 20, y: 30 });
    const bytes = doc.save({ objectStreams: "generate", encrypt: { userPassword: "secret", revision } });
    const expected = PdfDocument.load(bytes, { password: "secret" }).cos;
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
    const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 31, cacheBytes: 62 });
    const opened = await openPdfObjectReader(source, { fs, directory: "/scratch" }, { password: "secret", chunkBytes: 31, cacheBytes: 62 });
    expect(opened.encryption?.revision).toBe(revision);
    for (const object of expected.objects.values()) {
      if (object.value.kind !== "stream") continue;
      const actual: number[] = [];
      for await (const chunk of opened.reader.decodeStream(object.objectNumber, object.generationNumber)) { expect(chunk.length).toBeLessThanOrEqual(31); actual.push(...chunk); }
      expect(new Uint8Array(actual)).toEqual(decodeStreamObject(object.value, Infinity, node => expected.resolve(node)));
    }
    const info = await opened.reader.get(opened.crossReference.infoRef!.objectNumber);
    expect(info?.value).toMatchObject({ kind: "dict" });
    if (info?.value.kind === "dict") expect(dictGet(info.value, "Producer")).toMatchObject({ bytes: new TextEncoder().encode("@poe-code/pdf-ast") });
    await opened.close(); expect(await fs.readdir("/scratch")).toEqual([]);
    expect((await source.read(0, 1))[0]).toBe(37); await source.close();
  });

  it.each([
    ["pdfjs-issue6010_1.pdf", "abc"], ["pdfjs-issue6010_2.pdf", "æøå"],
    ["pdfjs-saslprep-r6.pdf", "SªSL\u00adprep"], ["pypdf-r5-saslprep.pdf", "SaSLprep"],
  ])("matches buffered decryption of independent fixture %s", async (file, password) => {
    const bytes = new Uint8Array(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
    const expected = PdfDocument.load(bytes, { password }).cos;
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
    const source = await PdfFileSource.open(fs, "/input");
    const opened = await openPdfObjectReader(source, { fs, directory: "/scratch" }, { password });
    for await (const entry of opened.crossReference.index.entries()) {
      if (entry.type === "free") continue;
      const object = expected.objects.get(entry.objectNumber);
      if (object?.value.kind !== "stream") continue;
      const actual: number[] = [];
      for await (const chunk of opened.reader.decodeStream(entry.objectNumber, entry.generationNumber ?? 0)) for (const byte of chunk) actual.push(byte);
      expect(new Uint8Array(actual)).toEqual(decodeStreamObject(object.value, Infinity, node => expected.resolve(node)));
    }
    await opened.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]);
  });

  it("removes the owned index on authentication failure", async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
    await fs.writeFile("/input", doc.save({ encrypt: { userPassword: "secret", revision: 3 } }));
    const source = await PdfFileSource.open(fs, "/input");
    await expect(openPdfObjectReader(source, { fs, directory: "/scratch" }, { password: "wrong" })).rejects.toThrow();
    expect(await fs.readdir("/scratch")).toEqual([]); await source.close();
  });

  it("finishes accepted reads before closing its owned index", async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", doc.save());
    const source = await PdfFileSource.open(fs, "/input");
    const opened = await openPdfObjectReader(source, { fs, directory: "/scratch" });
    const pending = opened.reader.get(opened.crossReference.rootRef.objectNumber);
    const closing = opened.close();
    expect((await pending)?.value).toMatchObject({ kind: "dict" });
    await closing; expect(await fs.readdir("/scratch")).toEqual([]); await source.close();
  });

  it("cleans discovered indexes when reader configuration is invalid", async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", doc.save());
    const source = await PdfFileSource.open(fs, "/input");
    await expect(openPdfObjectReader(source, { fs, directory: "/scratch" }, { objectStreamCacheEntries: 0 })).rejects.toThrow();
    expect(await fs.readdir("/scratch")).toEqual([]); await source.close();
  });

});

it("repairs an intact xref whose trailer root resolves to an Info dictionary", async () => {
  const bytes = new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue9418.pdf", import.meta.url)));
  const expected = PdfDocument.load(bytes).cos.rootRef;
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  const source = await PdfFileSource.open(fs, "/input");
  const opened = await openPdfObjectReader(source, { fs, directory: "/scratch" }, { recovery: "repair" });
  try {
    expect(opened.crossReference.rootRef.objectNumber).toBe(expected.objectNumber);
    const root = await opened.reader.get(expected.objectNumber, expected.generationNumber);
    expect(root?.value.kind === "dict" && dictGet(root.value, "Pages")?.kind).toBe("ref");
  } finally { await opened.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
