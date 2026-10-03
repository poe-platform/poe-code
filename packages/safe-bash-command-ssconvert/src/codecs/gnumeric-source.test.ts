import { expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "@poe-code/spreadsheet-format-csv";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import provider from "./providers/xml.js";

it.each([false, true])("converts replayable text to Gnumeric without cell arrays, gzip=%s", async gzip => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let largestWrite = 0, persisted = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...args) => {
      largestWrite = Math.max(largestWrite, bytes.length); persisted += bytes.length;
      return write(bytes, ...args);
    });
    return handle;
  });
  const array = vi.fn(() => { throw new Error("array path called"); });
  const formats = [{ ...csvFormat, services: csvFormat.services.map(codec => codec.readSource ?
    { ...codec, read: array, readSource: array } : codec) },
  { ...provider, services: provider.services.map(codec => codec.direction === "write" ?
    { ...codec, write: array, writeStream: array } : codec) }];
  const reference = createEngine({ formats: [{ ...csvFormat, services: csvFormat.services.map(codec => {
    const { readWorkbookSource, ...rest } = codec; void readWorkbookSource; return rest;
  }) }, provider] });
  const engine = createEngine({ formats, workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const input = new TextEncoder().encode("Title,Value,Date\n" + "a<&🦀,1.25,01/02/2020\n".repeat(1200));
  const reused = new Uint8Array(127);
  async function* source() {
    for (let offset = 0; offset < input.length; offset += reused.length) {
      const length = Math.min(reused.length, input.length - offset);
      reused.set(input.subarray(offset, offset + length)); yield reused.subarray(0, length);
    }
  }
  const expected: Uint8Array[] = [], actual: Uint8Array[] = [];
  let outstanding = 0, maximum = 0;
  const operation = { signal: new AbortController().signal };
  try {
    await reference.convert({ input: { kind: "range", source: { size: input.length, async read(position, maximum) { return input.subarray(position, position + maximum); } }, filename: "data.csv" },
      exportType: "Gnumeric_XmlIO:sax:0", destination: { kind: "stream", sink: { async write(bytes) { expected.push(bytes.slice()); } } } }, operation);
    await engine.convert({ input: { kind: "stream", source: source(), filename: "data.csv" },
      exportType: gzip ? "Gnumeric_XmlIO:sax" : "Gnumeric_XmlIO:sax:0", destination: { kind: "stream", sink: { async write(bytes) {
        outstanding += bytes.length; maximum = Math.max(maximum, outstanding);
        await Promise.resolve(); actual.push(bytes.slice()); outstanding -= bytes.length;
      } } } }, operation);
    expect(gzip ? gunzipSync(Buffer.concat(actual)) : Buffer.concat(actual)).toEqual(Buffer.concat(expected));
    expect(array).not.toHaveBeenCalled(); expect(maximum).toBeLessThanOrEqual(65536);
    expect(actual.length).toBeGreaterThan(1); expect(persisted).toBeGreaterThan(16384);
    expect(largestWrite).toBeLessThanOrEqual(16384); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); await reference.dispose(); }
});

it.each([false, true])("preserves replay errors and releases iterators, gzip=%s", async gzip => {
  const { defaultSsconvertLimits } = await import("@poe-code/spreadsheet-engine");
  const { writeGnumericStream, writeCompressedGnumericStream } = await import("./gnumeric.js");
  const reason = new Error("replay failed"), cleanups: (() => void | Promise<void>)[] = [];
  let opened = 0, closed = 0;
  const source = { metadata: { sheets: [{ id: "s", name: "Data", cells: [] }] },
    async *cells() {
      const pass = ++opened;
      try {
        yield { row: 0, column: 0, value: { kind: "string" as const, value: "first" } };
        if (pass === 3) throw reason;
      } finally { closed++; }
    } };
  const write = gzip ? writeCompressedGnumericStream : writeGnumericStream;
  try {
    await expect(async () => {
      for await (const chunk of write(source, [], { limits: defaultSsconvertLimits, signal: new AbortController().signal,
        environment: { env: {}, locale: "C", timezone: "UTC" }, own(cleanup) { cleanups.push(cleanup); } })) void chunk;
    }).rejects.toBe(reason);
    expect(opened).toBe(3); expect(closed).toBe(opened);
  } finally { for (const cleanup of cleanups) await cleanup(); }
});

it.each(["return", "cancel"])("stops a paused XML cell replay on %s", async mode => {
  const { defaultSsconvertLimits } = await import("@poe-code/spreadsheet-engine");
  const { writeGnumericStream } = await import("./gnumeric.js");
  const controller = new AbortController(), reason = new Error("cancelled");
  let opened = 0, closed = 0, pulled = 0;
  const source = { metadata: { sheets: [{ id: "s", name: "Data", cells: [] }] },
    async *cells() {
      const pass = ++opened;
      try {
        for (let row = 0; row < 1000; row++) {
          if (pass === 3) pulled++;
          yield { row, column: 0, value: { kind: "string" as const, value: "a".repeat(128) } };
        }
      } finally { closed++; }
    } };
  const stream = writeGnumericStream(source, [], { limits: defaultSsconvertLimits, signal: controller.signal,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  expect((await stream.next()).done).toBe(false);
  expect(opened).toBe(3); expect(closed).toBe(2);
  expect(pulled).toBeGreaterThan(0); expect(pulled).toBeLessThan(1000);
  const paused = pulled; await Promise.resolve(); expect(pulled).toBe(paused);
  if (mode === "cancel") { controller.abort(reason); await expect(stream.next()).rejects.toBe(reason); }
  else await stream.return(undefined);
  expect(closed).toBe(3);
});

it("preserves sparse sheets, blank-cell styles and workbook metadata on replay", async () => {
  const { defaultSsconvertLimits } = await import("@poe-code/spreadsheet-engine");
  const { writeGnumeric, writeGnumericStream } = await import("./gnumeric.js");
  const book: import("../workbook.js").Workbook = { properties: { title: "A&B" }, dateSystem: "1904", activeSheet: "s2", sheets: [
    { id: "s1", name: "Empty", cells: [] },
    { id: "s2", name: "Sparse", cells: [
      { row: 2, column: 3, value: { kind: "blank" }, format: "0.00" },
      { row: 7, column: 5, value: { kind: "string", value: "<🦀>" } },
      { row: 19, column: 10, value: { kind: "boolean", value: true } }
    ], columns: [{ index: 5, hidden: true }], merges: [{ startRow: 7, endRow: 7, startColumn: 5, endColumn: 6 }] }
  ] };
  const options = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
  const source = { metadata: { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [] })) },
    async *cells(id: string) { yield* book.sheets.find(sheet => sheet.id === id)!.cells; } };
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeGnumericStream(source, [], options)) chunks.push(chunk.slice());
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(await writeGnumeric(book, [], options)));
});

it.each([false, true])("publishes replayable Gnumeric files through the CLI, gzip=%s", async gzip => {
  const { createCommandArguments } = await import("safe-bash-contracts/command");
  const { toByteSource } = await import("safe-bash-contracts/io");
  const { createSsconvertCommand } = await import("../commands.js");
  const backend = createMemoryFileSystem();
  await backend.writeFile("/input.csv", new TextEncoder().encode("Name,Value\na,1.25\n"));
  const readFile = backend.readFile.bind(backend);
  vi.spyOn(backend, "readFile").mockRejectedValue(new Error("whole file read"));
  const array = vi.fn(() => { throw new Error("array path called"); });
  const formats = [{ ...csvFormat, services: csvFormat.services.map(codec => codec.readSource ?
    { ...codec, read: array, readSource: array } : codec) },
  { ...provider, services: provider.services.map(codec => codec.direction === "write" ?
    { ...codec, write: array, writeStream: array } : codec) }];
  const args = createCommandArguments(["-I", "Gnumeric_stf:stf_csvtab", "-T", gzip ? "Gnumeric_XmlIO:sax" : "Gnumeric_XmlIO:sax:0", "/input.csv", "/output.gnumeric"]);
  const cleanups: (() => void | Promise<void>)[] = [], errors: string[] = [];
  try {
    const result = await createSsconvertCommand({ formats }).execute({ command: "ssconvert", args: args.args, argumentValues: args,
      cwd: "/", env: {}, fs: backend, signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); } });
    expect(result, errors.join("")).toMatchObject({ exitCode: 0 });
    const bytes = await readFile("/output.gnumeric"), xml = new TextDecoder().decode(gzip ? gunzipSync(bytes) : bytes);
    expect(xml).toContain('<gnm:Cell Row="1" Col="1" ValueType="40">1.25</gnm:Cell>');
    expect(array).not.toHaveBeenCalled();
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  expect((await backend.readdir("/")).map(entry => entry.name).sort()).toEqual(["input.csv", "output.gnumeric"]);
});

it.each([false, true])("cleans injected staging on replay and publication failures, gzip=%s", async gzip => {
  for (const mode of ["source", "sink", "cancel"] as const) {
    const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
    const reason = new Error(mode); let closed = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args), close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async options => { closed++; await close(options); });
      if (mode === "source") vi.spyOn(handle, "read").mockRejectedValue(reason);
      return handle;
    });
    const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [csvFormat, provider] });
    const sink = vi.fn(async () => { if (mode === "cancel") controller.abort(reason); else throw reason; });
    const chunk = new TextEncoder().encode("a,1.25\n".repeat(1000));
    async function* input() { for (let i = 0; i < 3; i++) yield chunk; }
    try {
      await expect(engine.convert({ input: { kind: "stream", filename: "data.csv", source: input() },
        exportType: gzip ? "Gnumeric_XmlIO:sax" : "Gnumeric_XmlIO:sax:0", destination: { kind: "stream", sink: { write: sink } } },
      { signal: controller.signal })).rejects.toBe(reason);
      if (mode === "source") expect(sink).not.toHaveBeenCalled();
      expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
    } finally { await engine.dispose(); }
  }
});
