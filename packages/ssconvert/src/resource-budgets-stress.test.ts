import { expect, it, vi } from "vitest";
import { createEngine, type Codec, type Cleanup } from "./index.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 10, operations: 20 };
const book = { sheets: [{ id: "a", name: "A", cells: [] }] };
const environment = { env: {}, locale: "C", timezone: "UTC" };
const codec: Codec = { id: "fixture", description: "Original in-memory fixture", extensions: ["csv"],
  probeContent: () => true, async read() { return book; } };
it("starts cooperative cleanup before waiting for admitted execution", async () => {
  let cleanup: Cleanup | undefined;
  let release!: () => void;
  let entered!: () => void;
  const acquired = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let closed = false;
  const engine = createEngine({ limits, environment, codecs: [{ ...codec, async read(_bytes, context) {
    context.own(async () => { closed = true; release(); });
    entered(); await released; return book;
  } }] });
  const execution = engine.readWorkbook({ kind: "stream", source: [new Uint8Array([1])] }, {}, {
    signal: new AbortController().signal, registerCleanup(value) { cleanup = value; }
  });
  await acquired;
  const closing = Promise.resolve(cleanup!());
  try { await Promise.resolve(); expect(closed).toBe(true); }
  finally { release(); await expect(execution).rejects.toMatchObject({ code: "invalid-request" }); await closing; await engine.dispose(); }
});
it("aborts a cooperative pending source read and awaits its iterator cleanup", async () => {
  const controller = new AbortController();
  let release!: (value: IteratorResult<Uint8Array>) => void;
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let returned = false;
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    next() { entered(); return new Promise<IteratorResult<Uint8Array>>(resolve => { release = resolve; }); },
    async return() { returned = true; release({ done: true, value: undefined }); return { done: true as const, value: undefined }; }
  }; } };
  const engine = createEngine({ limits, environment, codecs: [codec] });
  const execution = engine.readWorkbook({ kind: "stream", source }, {}, { signal: controller.signal });
  await reading; const reason = new Error("original abort"); controller.abort(reason);
  try { await Promise.resolve(); expect(returned).toBe(true); }
  finally { release({ done: true, value: undefined }); await expect(execution).rejects.toBe(reason); await engine.dispose(); }
});
it("copies reusable producer chunks before advancing and finalizing", async () => {
  const reusable = new Uint8Array([1]);
  const source = { *[Symbol.iterator]() { yield reusable; reusable[0] = 2; yield reusable; reusable[0] = 9; } };
  let received: number[] = [];
  const engine = createEngine({ limits, environment, codecs: [{ ...codec, async read(bytes) { received = [...bytes]; return book; } }] });
  await engine.readWorkbook({ kind: "stream", source }, {}, { signal: new AbortController().signal });
  expect(received).toEqual([1, 2]); await engine.dispose();
});
it("refuses terminal output bytes before writing help", async () => {
  const { runCommand } = await import("./cli.js");
  const engine = createEngine({ limits: { ...limits, commandOutputBytes: 1 }, environment, codecs: [codec] });
  const errors: string[] = [];
  const result = await runCommand(["--help"], engine, { signal: new AbortController().signal,
    stdout: { async write() { throw new Error("help sink must not be reached"); } },
    stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
  });
  expect(result).toEqual({ exitCode: 1 });
  expect(errors).toEqual(["ssconvert output bytes limit exceeded\n"]); await engine.dispose();
});
it("reports forbidden entity declarations as a host capability denial", async () => {
  const { readGnumeric } = await import("./codecs/gnumeric.js");
  const engine = createEngine({ limits, environment, codecs: [{ ...codec, read: readGnumeric }] });
  await expect(engine.readWorkbook({ kind: "stream", source: [new TextEncoder().encode(
    '<!DOCTYPE Workbook [<!ENTITY a "x">]><gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Sheets/></gnm:Workbook>')]
  }, { importType: "fixture" }, { signal: new AbortController().signal })).rejects.toMatchObject({
    code: "capability-denied", message: "ssconvert host denies XML DTD and entity declarations"
  }); await engine.dispose();
});
it("admits a gzip declared inflated size before acquiring a decompressor", async () => {
  const { gzipSync } = await import("node:zlib");
  const { readGnumeric } = await import("./codecs/gnumeric.js");
  let acquisitions = 0;
  await expect(readGnumeric(new Uint8Array(gzipSync('<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Sheets/></gnm:Workbook>')), {
    signal: new AbortController().signal, environment, limits: { ...limits, inflatedBytes: 16 }, own() { acquisitions++; }
  })).rejects.toMatchObject({ code: "resource-limit" });
  expect(acquisitions).toBe(0);
});
it.each(["xlsx", "odf"] as const)("refuses %s ZIP ratios before decoding a corrupted deflate payload", async format => {
  const { createZipCodec } = await import("@poe-code/office-package");
  const { readXlsx } = await import("./codecs/xlsx.js");
  const { readOdf } = await import("./codecs/odf.js");
  const zip = createZipCodec();
  const bounds = { maxArchiveBytes: 10000, maxEntryBytes: 10000, maxTotalBytes: 10000, maxMembers: 10,
    maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 10000, chunkSize: 512 };
  const signal = new AbortController().signal;
  const entry = await zip.makeZipEntry(format === "xlsx" ? "xl/workbook.xml" : "content.xml", new TextEncoder().encode("x".repeat(1024)),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, bounds, signal);
  const bytes = await zip.writeZipArchive({ entries: [entry], comment: new Uint8Array() }, bounds, signal);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes[30 + view.getUint16(26, true) + view.getUint16(28, true)] = 255;
  const reader = format === "xlsx" ? readXlsx : readOdf;
  await expect(reader(bytes, { signal, environment, own() {}, limits: { ...limits, zipRatio: 2 } })).rejects.toMatchObject({
    code: "resource-limit", message: expect.stringContaining("ZIP ratio")
  });
});
it("cancellation releases cooperative codec work before awaiting execution", async () => {
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const acquired = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let closed = false;
  const engine = createEngine({ limits, environment, codecs: [{ ...codec, async read(_bytes, context) {
    context.own(async () => { closed = true; release(); }); entered(); await released; return book;
  } }] });
  const execution = engine.readWorkbook({ kind: "stream", source: [new Uint8Array([1])] }, {}, { signal: controller.signal });
  await acquired; const reason = new Error("codec cancellation"); controller.abort(reason);
  try { await Promise.resolve(); expect(closed).toBe(true); }
  finally { release(); await expect(execution).rejects.toBe(reason); await engine.dispose(); }
});
it("resource I/O forwards cooperative iterator return while next is pending", async () => {
  const { createResourceIO } = await import("./io/index.js");
  let release!: (value: IteratorResult<Uint8Array>) => void;
  let returned = false;
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    next() { return new Promise<IteratorResult<Uint8Array>>(resolve => { release = resolve; }); },
    async return() { returned = true; release({ done: true, value: undefined }); return { done: true as const, value: undefined }; }
  }; } };
  const io = createResourceIO({ cwd: "/", filesystem: { async read() { return source; }, async write() {} } });
  const wrapped = await io.read("/in.csv", new AbortController().signal);
  const iterator = (wrapped as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  const next = iterator.next();
  await Promise.resolve();
  const closing = Promise.resolve(iterator.return!());
  try { await Promise.resolve(); expect(returned).toBe(true); }
  finally { release({ done: true, value: undefined }); await Promise.all([closing, next]); }
});
it("public abort settlement awaits the cooperative source return promise", async () => {
  const controller = new AbortController();
  let releaseRead!: (value: IteratorResult<Uint8Array>) => void;
  let releaseCleanup!: () => void;
  let reading!: () => void;
  let returned!: () => void;
  const enteredRead = new Promise<void>(resolve => { reading = resolve; });
  const enteredCleanup = new Promise<void>(resolve => { returned = resolve; });
  const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    next() { reading(); return new Promise<IteratorResult<Uint8Array>>(resolve => { releaseRead = resolve; }); },
    async return() { returned(); releaseRead({ done: true, value: undefined }); await cleanup; return { done: true as const, value: undefined }; }
  }; } };
  const engine = createEngine({ limits, environment, codecs: [codec] });
  let settled = false;
  const execution = engine.readWorkbook({ kind: "stream", source }, {}, { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  await enteredRead; const reason = new Error("settlement abort"); controller.abort(reason);
  await enteredCleanup; await Promise.resolve();
  expect(settled).toBe(false); releaseCleanup();
  await expect(execution).rejects.toBe(reason); await engine.dispose();
});
it("refuses excessive empty arguments before parsing", async () => {
  const { runCommand } = await import("./cli.js");
  const engine = createEngine({ limits: { ...limits, argumentBytes: 1 }, environment, codecs: [codec] });
  const errors: string[] = [];
  const result = await runCommand(["", ""], engine, { signal: new AbortController().signal,
    stdout: { async write() { throw new Error("stdout must not be reached"); } },
    stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
  });
  expect(result).toEqual({ exitCode: 1 });
  expect(errors).toEqual(["ssconvert arguments limit exceeded\n"]); await engine.dispose();
});
it("admits each BIFF record separately at the exact record bound", async () => {
  const { readBiffRecords } = await import("./codecs/biff-binary.js");
  const context = { signal: new AbortController().signal, environment, own() {}, limits: { ...limits, workbookNodes: 1 } };
  expect(readBiffRecords(new Uint8Array([1, 0, 0, 0]), context)).toHaveLength(1);
  expect(() => readBiffRecords(new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]), context)).toThrowError(
    expect.objectContaining({ code: "resource-limit", message: "ssconvert BIFF record limit exceeded" }));
});
it("keeps declaration-looking comments and predefined entities valid in SpreadsheetML", async () => {
  const { readSpreadsheetML } = await import("./codecs/spreadsheetml.js");
  const workbook = await readSpreadsheetML(new TextEncoder().encode(
    '<!-- <!DOCTYPE Workbook [<!ENTITY x "value">]> --><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="A&amp;B"><Table/></Worksheet></Workbook>'), {
    signal: new AbortController().signal, environment, own() {}, limits
  });
  expect(workbook.sheets.map(sheet => sheet.name)).toEqual(["A&B"]);
});

it("admits listing padding before allocating it", async () => {
  const { runCommand } = await import("./cli.js");
  const engine = createEngine({ limits: { ...limits, commandOutputBytes: 10 }, environment,
    codecs: [{ ...codec, id: "x".repeat(1000) }] });
  const repeat = vi.spyOn(String.prototype, "repeat").mockImplementation(function(this: string) {
    if (String(this) === " ") throw new Error("listing padding allocated before admission");
    return String(this);
  });
  const errors: string[] = [];
  try {
    const result = await runCommand(["--list-importers"], engine, { signal: new AbortController().signal,
      stdout: { async write() { throw new Error("stdout must not be reached"); } },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
    });
    expect(result).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["ssconvert output bytes limit exceeded\n"]);
  } finally { repeat.mockRestore(); await engine.dispose(); }
});
it("preserves a source failure when iterator cleanup rethrows that same failure", async () => {
  const reason = new Error("original producer failure");
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    async next() { throw reason; }, async return() { throw reason; }
  }; } };
  const engine = createEngine({ limits, environment, codecs: [codec] });
  await expect(engine.readWorkbook({ kind: "stream", source }, {}, { signal: new AbortController().signal })).rejects.toBe(reason);
  await engine.dispose();
});
it("retains a distinct iterator cleanup failure beside its source failure", async () => {
  const reason = new Error("producer failure"); const cleanup = new Error("distinct cleanup failure");
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    async next() { throw reason; }, async return() { throw cleanup; }
  }; } };
  const engine = createEngine({ limits, environment, codecs: [codec] });
  await expect(engine.readWorkbook({ kind: "stream", source }, {}, { signal: new AbortController().signal })).rejects.toMatchObject({
    errors: [expect.objectContaining({ errors: [reason, cleanup] }), expect.any(AggregateError)]
  });
  await engine.dispose();
});
it("translates delayed typed VFS read failure after cooperative cleanup", async () => {
  let returned = false;
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    async next() { throw Object.assign(new Error("original VFS missing resource"), { code: "ENOENT", path: "/missing.fixture" }); },
    async return() { returned = true; return { done: true as const, value: undefined }; }
  }; } };
  const engine = createEngine({ limits, environment, codecs: [codec], filesystem: {
    async read() { return source; }, async write() { throw new Error("publication forbidden"); }
  } });
  await expect(engine.readWorkbook({ kind: "resource", uri: "/missing.fixture" }, {}, { signal: new AbortController().signal })).rejects.toMatchObject({
    code: "io", message: "E /missing.fixture: No such file or directory"
  });
  expect(returned).toBe(true); await engine.dispose();
});

it("admits terminal raw diagnostics before their sink write", async () => {
  const { runCommand } = await import("./cli.js");
  const engine = createEngine({ limits: { ...limits, commandOutputBytes: 1 }, environment, codecs: [codec] });
  const errors: string[] = [];
  const result = await runCommand([new Uint8Array([45, 255])], engine, { signal: new AbortController().signal,
    stdout: { async write() { throw new Error("stdout must not be reached"); } },
    stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
  });
  expect(result).toEqual({ exitCode: 1 }); expect(errors).toEqual(["ssconvert output bytes limit exceeded\n"]);
  await engine.dispose();
});
it("executes owned cleanup once when it synchronously reenters registered cleanup", async () => {
  let close!: Cleanup;
  let calls = 0;
  let reentrant: Promise<void> | undefined;
  const engine = createEngine({ limits, environment, codecs: [{ ...codec, async read(_bytes, context) {
    context.own(() => {
      calls++;
      if (calls === 1) reentrant = Promise.resolve(close());
    });
    return book;
  } }] });
  const execution = engine.readWorkbook({ kind: "stream", source: [new Uint8Array([1])] }, {}, {
    signal: new AbortController().signal, registerCleanup(value) { close = value; }
  });
  await expect(execution).resolves.toMatchObject(book);
  await reentrant;
  expect(reentrant).toBe(close());
  expect(calls).toBe(1); await engine.dispose();
});
it("shares resource iterator return completion across synchronous reentrancy", async () => {
  const { createResourceIO } = await import("./io/index.js");
  let calls = 0;
  let reentrant: Promise<IteratorResult<Uint8Array>> | undefined;
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: new Uint8Array([1]) }; },
    return() {
      calls++;
      if (calls === 1) reentrant = Promise.resolve(iterator.return!());
      return Promise.resolve({ done: true as const, value: undefined });
    }
  }; } };
  const io = createResourceIO({ cwd: "/", filesystem: { async read() { return source; }, async write() {} } });
  const iterator = (await io.read("/in.csv", new AbortController().signal) as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  const closing = iterator.return!();
  await closing;
  expect(reentrant).toBe(closing);
  expect(calls).toBe(1);
});
