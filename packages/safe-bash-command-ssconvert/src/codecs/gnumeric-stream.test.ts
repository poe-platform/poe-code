import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createEngine, defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { writeGnumeric, writeGnumericStream, writeCompressedGnumericStream } from "./gnumeric.js";
import provider from "./providers/xml.js";

const context = (signal = new AbortController().signal): CapabilityContext => ({
  signal, own() {}, limits: defaultSsconvertLimits, environment: { env: {}, locale: "C", timezone: "UTC" }
});
const workbook = (): Workbook => ({ sheets: [{ id: "s1", name: "Résumé", cells: Array.from({ length: 1200 }, (_, row) => ({
  row, column: 0, value: { kind: "string" as const, value: `a<&🦀${row}` }
})) }] });

it("publishes Gnumeric XML before serializing the final cells with bounded chunks", async () => {
  const book = workbook(), options = context();
  const expected = await writeGnumeric(book, [], options);
  // Captured from the pre-streaming serializer, including native XML whitespace.
  expect(createHash("sha256").update(expected).digest("hex")).toBe("b2e741c4e554ea43c8a1ac35b54cc3c6c800a3b555ce1286ab6991ad3f5519f1");
  const last = book.sheets[0]!.cells.at(-1)!, value = last.value;
  let pulled = false;
  Object.defineProperty(last, "value", { get() { expect(pulled).toBe(true); return value; } });
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeGnumericStream(book, [], options)) {
    expect(chunk.length).toBeLessThanOrEqual(65536);
    pulled = true; await Promise.resolve(); chunks.push(chunk.slice());
  }
  expect(chunks.length).toBeGreaterThan(1);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
});

it("registers both XML stream exporters and preserves gzip content and the UNIX header", async () => {
  for (const codec of provider.services.filter(codec => codec.direction === "write")) expect(codec.writeStream).toBeTypeOf("function");
  const book = workbook(), options = context(), chunks: Uint8Array[] = [];
  for await (const chunk of writeCompressedGnumericStream(book, [], options)) { await Promise.resolve(); chunks.push(chunk.slice()); }
  const bytes = Buffer.concat(chunks);
  expect(bytes[9]).toBe(3);
  expect(gunzipSync(bytes)).toEqual(Buffer.from(await writeGnumeric(book, [], options)));
});

it.each([false, true])("preserves cancellation and output limits for gzip=%s", async gzip => {
  const write = gzip ? writeCompressedGnumericStream : writeGnumericStream;
  const controller = new AbortController(), reason = new Error("cancelled stream");
  const stream = write(workbook(), [], context(controller.signal));
  expect((await stream.next()).done).toBe(false);
  controller.abort(reason);
  await expect(stream.next()).rejects.toBe(reason);
  const options = context();
  await expect(async () => { for await (const chunk of write(workbook(), [], { ...options, limits: { ...options.limits, outputBytes: 10 } })) void chunk; }).rejects.toMatchObject({ code: "resource-limit" });
});


it("keeps compression writes bounded and drains them on early consumer return", async () => {
  const NativeCompression = CompressionStream;
  let pending = 0, maximumPending = 0, maximumBytes = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  vi.stubGlobal("CompressionStream", class extends NativeCompression {
    constructor(format: CompressionFormat) {
      super(format);
      const acquire = this.writable.getWriter.bind(this.writable);
      vi.spyOn(this.writable, "getWriter").mockImplementation(() => {
        const writer = acquire(), write = writer.write.bind(writer);
        vi.spyOn(writer, "write").mockImplementation(async bytes => {
          maximumPending = Math.max(maximumPending, ++pending);
          maximumBytes = Math.max(maximumBytes, (bytes as Uint8Array).byteLength);
          try { await Promise.resolve(); await write(bytes); } finally { pending--; }
        });
        return writer;
      });
    }
  });
  try {
    const stream = writeCompressedGnumericStream(workbook(), [], { ...context(), own(cleanup) { cleanups.push(cleanup); } });
    expect((await stream.next()).done).toBe(false);
    await stream.return(undefined);
    expect(pending).toBe(0); expect(maximumPending).toBe(1); expect(maximumBytes).toBeLessThanOrEqual(65536);
    for (const cleanup of cleanups) await cleanup();
    expect(pending).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

it.each([false, true])("uses the engine stream publication path and preserves sink failure for gzip=%s", async gzip => {
  const failure = new Error("sink failed");
  const engine = createEngine({ formats: [{ ...provider, services: provider.services.map(codec => codec.direction === "write" ?
    { ...codec, write: async () => { throw new Error("buffered writer called"); } } : codec) }] });
  let writes = 0;
  try {
    const book = await engine.adoptWorkbook(workbook(), { signal: new AbortController().signal });
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { writes++; await Promise.resolve(); throw failure; } } },
      { exportType: gzip ? "Gnumeric_XmlIO:sax" : "Gnumeric_XmlIO:sax:0" }, { signal: new AbortController().signal })).rejects.toBe(failure);
    expect(writes).toBe(1);
  } finally { await engine.dispose(); }
});

it("preserves a serialization failure while gzip is consuming XML", async () => {
  const book = workbook(), reason = new Error("serialization failed");
  Object.defineProperty(book.sheets[0]!.cells.at(-1), "value", { get() { throw reason; } });
  await expect(async () => { for await (const chunk of writeCompressedGnumericStream(book, [], context())) void chunk; }).rejects.toBe(reason);
});


it("sorts Gnumeric cells through injected storage with bounded in-memory runs", async () => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let persisted = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...args) => { persisted += bytes.length; return write(bytes, ...args); });
    return handle;
  });
  const original = workbook();
  const raw = { ...original, sheets: [{ ...original.sheets[0]!, cells: [...original.sheets[0]!.cells].reverse() }] };
  const expected = await writeGnumeric(raw, [], context());
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [provider] });
  const operation = { signal: new AbortController().signal };
  try {
    const book = await engine.adoptWorkbook(raw, operation), chunks: Uint8Array[] = [];
    const nativeSort = Array.prototype.sort;
    const sorting = vi.spyOn(Array.prototype, "sort").mockImplementation(function(this: unknown[], compare) {
      expect(this.length).toBeLessThanOrEqual(1024); return nativeSort.call(this, compare);
    });
    try {
      await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { await Promise.resolve(); chunks.push(bytes.slice()); } } },
        { exportType: "Gnumeric_XmlIO:sax:0" }, operation);
    } finally { sorting.mockRestore(); }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
    expect(persisted).toBeGreaterThan(0); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});
