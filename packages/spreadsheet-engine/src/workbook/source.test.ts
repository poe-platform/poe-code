import { expect, it, vi } from "vitest";
import { snapshotWorkbook, type Cell, type Workbook } from "@poe-code/spreadsheet-ast";
import { defaultSsconvertLimits } from "../engine.js";
import { ownWorkbookSource } from "./source.js";

const cells: Cell[] = [
  { row: 0, column: 0, value: { kind: "string", value: "😀é" } },
  { row: 1, column: 0, value: { kind: "number", value: 1.25 }, format: "0.00" },
  { row: 2, column: 1, value: { kind: "boolean", value: true } }
];
const metadata: Workbook = { sheets: [{ id: "s", name: "Data", cells: [] }] };
const book: Workbook = { sheets: [{ ...metadata.sheets[0]!, cells }] };
const source = { metadata, async *cells() { yield* cells; } };

it("applies aggregate cell, node, text, and depth admission identically to array workbooks", async () => {
  for (const key of ["cells", "workbookNodes", "workbookTextBytes", "workbookDepth"] as const) {
    for (let limit = 0; limit < 130; limit++) {
      const limits = { ...defaultSsconvertLimits, [key]: limit };
      let expected: string | undefined;
      try { snapshotWorkbook(book, limits); } catch (error) { expected = (error as Error).message; }
      if (expected) await expect(ownWorkbookSource(source, limits, () => {}), `${key}=${limit}`).rejects.toThrow(expected);
      else {
        const owned = await ownWorkbookSource(source, limits, () => {}), result = [];
        for await (const cell of owned.cells("s")) result.push(cell);
        expect(result).toEqual(cells);
      }
    }
  }
});

it("owns each yielded cell before the producer reuses its object and checks revocation", async () => {
  const value = { kind: "string" as const, value: "first" };
  const reused = { row: 0, column: 0, value };
  const controller = new AbortController(), reason = new Error("closed");
  const owned = await ownWorkbookSource({ metadata, async *cells() {
    reused.row = 0; value.value = "first"; yield reused;
    reused.row = 1; value.value = "second"; yield reused;
  } }, defaultSsconvertLimits, () => controller.signal.throwIfAborted());
  const iterator = owned.cells("s")[Symbol.asyncIterator]();
  const first = (await iterator.next()).value;
  await iterator.next();
  expect(first).toEqual({ row: 0, column: 0, value: { kind: "string", value: "first" } });
  expect(Object.isFrozen(first.value)).toBe(true);
  controller.abort(reason);
  await expect(iterator.next()).rejects.toBe(reason);
});

it.each(["duplicate", "unordered", "formula"])("rejects %s source cells before export", async mode => {
  const second = mode === "formula" ? { ...cells[1]!, formula: "=1" } :
    { ...cells[0]!, row: mode === "duplicate" ? 1 : 0 };
  await expect(ownWorkbookSource({ metadata, async *cells() {
    yield { ...cells[0]!, row: 1 }; yield second;
  } }, defaultSsconvertLimits, () => {})).rejects.toThrow(mode === "formula" ? "scalar" : "row-major");
});

it("keeps byte-string export work admission aggregate before opening output", async () => {
  const { createEngine } = await import("../engine.js");
  let opened = false;
  const engine = createEngine({ limits: { workbookWork: 2 }, codecs: [{
    id: "source", description: "fixture", extensions: [],
    async readSource() { return book; }, async readWorkbookSource() { return source; },
    async *writeStream() { yield Uint8Array.of(1); }, async *writeWorkbookSource() { yield Uint8Array.of(1); }
  }], filesystem: { async read() { return []; }, async write() {}, async openOutput() { opened = true; return undefined; } } });
  await expect(engine.convert({ input: { kind: "range", source: { size: 0, async read() { return new Uint8Array(); } } },
    importType: "source", exportType: "source", destination: { kind: "resource", uri: "/output" } },
  { signal: new AbortController().signal })).rejects.toThrow("byte-string export work limit");
  expect(opened).toBe(false); await engine.dispose();
});

it("does not copy the whole sheet metadata for each streamed cell or replay", async () => {
  const count = 160;
  const metadata: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], rows: Array.from({ length: count }, (_, index) => ({ index, sizePoints: 17 })) }] };
  const original = Object.getOwnPropertyDescriptor;
  let axesCopied = 0;
  const spy = vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((object, key) => {
    if (key === "index" && original(object, "sizePoints")?.value === 17) axesCopied++;
    return original(object, key);
  });
  try {
    const source = await ownWorkbookSource({ metadata, async *cells() {
      for (let row = 0; row < count; row++) yield { row, column: 0, value: { kind: "number", value: row } };
    } }, defaultSsconvertLimits, () => {});
    for (let replay = 0; replay < 8; replay++) {
      let seen = 0; for await (const cell of source.cells("s")) { expect(cell.row).toBe(seen++); }
      expect(seen).toBe(count);
    }
    expect(axesCopied).toBeLessThanOrEqual(count * 2);
  } finally { spy.mockRestore(); }
});

it("shares byte-string and metadata work admission across all source cells", async () => {
  const metadata: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], merges: [
    { startRow: 10, endRow: 10, startColumn: 0, endColumn: 1 },
    { startRow: 11, endRow: 11, startColumn: 0, endColumn: 1 }
  ] }] };
  const values: Cell[] = [0, 1].map(row => ({ row, column: 0, value: { kind: "byte-string", value: "ff" } }));
  for (let workbookWork = 0; workbookWork < 16; workbookWork++) {
    const limits = { ...defaultSsconvertLimits, workbookWork };
    let expected: string | undefined;
    try { snapshotWorkbook({ ...metadata, sheets: [{ ...metadata.sheets[0]!, cells: values }] }, limits); }
    catch (error) { expected = (error as Error).message; }
    const supplied = { metadata, async *cells() { yield* values; } };
    if (expected) await expect(ownWorkbookSource(supplied, limits, () => {}), "work=" + workbookWork).rejects.toThrow(expected);
    else {
      const source = await ownWorkbookSource(supplied, limits, () => {}), actual = [];
      for await (const cell of source.cells("s")) actual.push(cell);
      expect(actual).toEqual(values);
    }
  }
});


it("aggregates byte-string work across sheets and closes rejected producers", async () => {
  const sheets = ["first", "second"].map(id => ({ id, name: id, cells: [] }));
  const value: Cell = { row: 0, column: 0, value: { kind: "byte-string", value: "ff" },
    cachedResult: { kind: "byte-string", value: "fe" } };
  for (let workbookWork = 0; workbookWork < 20; workbookWork++) {
    const limits = { ...defaultSsconvertLimits, workbookWork };
    let expected: string | undefined, started = 0, closed = 0;
    try { snapshotWorkbook({ sheets: sheets.map(sheet => ({ ...sheet, cells: [value] })) }, limits); }
    catch (error) { expected = (error as Error).message; }
    const supplied = { metadata: { sheets }, async *cells() {
      started++;
      try { yield value; } finally { closed++; }
    } };
    if (expected) await expect(ownWorkbookSource(supplied, limits, () => {})).rejects.toThrow(expected);
    else {
      const owned = await ownWorkbookSource(supplied, limits, () => {});
      for (const sheet of sheets) {
        const values = []; for await (const cell of owned.cells(sheet.id)) values.push(cell);
        expect(values).toEqual([value]);
      }
    }
    expect(closed).toBe(started);
  }
});

it("rechecks the work budget and closes a changed replay producer", async () => {
  let pass = 0, closed = 0;
  const owned = await ownWorkbookSource({ metadata, async *cells() {
    pass++;
    try {
      yield { row: 0, column: 0, value: { kind: "byte-string", value: pass === 1 ? "ff" : "ffffffff" } };
    } finally { closed++; }
  } }, { ...defaultSsconvertLimits, workbookWork: 4 }, () => {});
  const iterator = owned.cells("s")[Symbol.asyncIterator]();
  await expect(iterator.next()).rejects.toThrow("work limit exceeded");
  expect(closed).toBe(2);
});

it("owns replayable axes with aggregate array-workbook budgets", async () => {
  const rows = [{ index: 4, sizePoints: 17, hidden: true }, { index: 0, sizePoints: 23 }];
  const columns = [{ index: 1, outlineLevel: 2 }];
  const supplied = { metadata: { sheets: [{ ...metadata.sheets[0]!, rows: [], columns: [] }] },
    async *cells() { yield* cells; },
    async *axes(_sheet: string, kind: "rows" | "columns") { yield* kind === "rows" ? rows : columns; }
  };
  for (const key of ["workbookNodes", "workbookTextBytes", "workbookDepth"] as const) {
    for (let budget = 0; budget < 160; budget++) {
      const limits = { ...defaultSsconvertLimits, [key]: budget };
      let failure: string | undefined;
      try { snapshotWorkbook({ sheets: [{ ...metadata.sheets[0]!, cells, rows, columns }] }, limits); }
      catch (error) { failure = (error as Error).message; }
      if (failure) await expect(ownWorkbookSource(supplied, limits, () => {})).rejects.toThrow(failure);
      else {
        const owned = await ownWorkbookSource(supplied, limits, () => {});
        expect(owned.metadata.sheets[0]!.rows).toEqual([]);
        const actual = []; for await (const axis of owned.axes!("s", "rows")) actual.push(axis);
        expect(actual).toEqual(rows); expect(Object.isFrozen(actual[0])).toBe(true);
      }
    }
  }
});

it("rejects duplicate or invalid streamed axis metadata and closes its producer", async () => {
  for (const second of [{ index: 3 }, { index: -1 }, { index: 4, sizePoints: -1 }]) {
    let closed = false;
    const supplied = { metadata: { sheets: [{ ...metadata.sheets[0]!, rows: [], columns: [] }] },
      async *cells() { yield* cells; }, async *axes() {
        try { yield { index: 3 }; yield second; } finally { closed = true; }
      } };
    await expect(ownWorkbookSource(supplied, defaultSsconvertLimits, () => {})).rejects.toThrow();
    expect(closed).toBe(true);
  }
});

it("uses bounded caller storage for axis duplicate admission and retires every replay", async () => {
  const { createEngine } = await import("../engine.js");
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs/core");
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384);
  let acquired = 0, closed = 0, reads = 0, writes = 0;
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{
    id: "fixture", description: "", extensions: [], async readSource(_input, context) {
      const owned = await ownWorkbookSource({ metadata: { sheets: [{ ...metadata.sheets[0]!, rows: [], columns: [] }] },
        async *cells() { yield* cells; }, async *axes(_id, kind) {
          if (kind === "rows") for (let index = 299; index >= 0; index--) yield { index, sizePoints: 17 };
        }
      }, context.limits, () => context.signal.throwIfAborted(), () => {
        acquired++; const storage = context.createWorkingStorage!();
        return { ...storage, async read(at, count) {
          expect(count).toBeLessThanOrEqual(16384); reads++;
          const bytes = await storage.read(at, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length);
        }, async write(at, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); writes++; await storage.write(at, bytes); },
        async close() { closed++; await storage.close(); } };
      });
      expect(closed).toBe(acquired);
      const iterator = owned.axes!("s", "rows")[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toEqual({ index: 299, sizePoints: 17 });
      await iterator.return!(); expect(closed).toBe(acquired);
      let count = 0; for await (const axis of owned.axes!("s", "rows")) expect(axis.index).toBe(299 - count++);
      expect(count).toBe(300); expect(closed).toBe(acquired);
      return { sheets: [] };
    }
  }] });
  try { await engine.readWorkbook({ kind: "range", source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: "fixture" }, { signal: new AbortController().signal }); }
  finally { await engine.dispose(); }
  expect(acquired).toBe(4); expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["acquire", "write", "read", "producer", "cancel", "close", "combined"])("retires axis validation after %s failure", async mode => {
  const controller = new AbortController(), reason = Error("axis failure"), cleanup = Error("axis cleanup");
  let closed = 0, producerClosed = 0;
  const supplied = { metadata: { sheets: [{ ...metadata.sheets[0]!, rows: [], columns: [] }] },
    async *cells() { yield* cells; }, async *axes() {
      try {
        for (let index = 0; index < 300; index++) {
          if (index === 1 && (mode === "producer" || mode === "combined")) throw reason;
          if (index === 1 && mode === "cancel") controller.abort(reason);
          yield { index };
        }
      } finally { producerClosed++; }
    } };
  const result = ownWorkbookSource(supplied, defaultSsconvertLimits, () => controller.signal.throwIfAborted(), () => {
    if (mode === "acquire") throw reason;
    const bytes = new Uint8Array(2 * 1024 * 1024); let end = 8;
    return {
      allocate(length) { const at = end; end += length; expect(end).toBeLessThanOrEqual(bytes.length); return at; },
      async read(at, length) { if (mode === "read") throw reason; return bytes.subarray(at, at + length); },
      async write(at, value) { if (mode === "write") throw reason; bytes.set(value, at); },
      async close() { closed++; if (mode === "close") throw reason; if (mode === "combined") throw cleanup; }
    };
  });
  if (mode === "combined") await expect(result).rejects.toMatchObject({ errors: [reason, cleanup] });
  else await expect(result).rejects.toBe(reason);
  expect(closed).toBe(mode === "acquire" ? 0 : 1);
  expect(producerClosed).toBe(mode === "acquire" ? 0 : 1);
});
