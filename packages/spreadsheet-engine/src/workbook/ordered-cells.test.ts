import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine } from "../engine.js";
import type { CapabilityContext, Cleanup, WorkingStorage } from "../contracts.js";
import type { Cell } from "@poe-code/spreadsheet-ast";
import { orderedCells } from "./ordered-cells.js";

const cells = (count: number): Cell[] => Array.from({ length: count }, (_, i) => ({
  row: (count - i - 1) % 701, column: Math.floor((count - i - 1) / 701), value: { kind: "number", value: i }
}));

it("orders cells through bounded caller-backed runs without a full sorting copy", async () => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let written = 0, maximum = 0, handlesClosed = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...args) => {
      written += bytes.length; maximum = Math.max(maximum, bytes.length); return write(bytes, ...args);
    });
    vi.spyOn(handle, "close").mockImplementation(async (...args) => { handlesClosed++; return close(...args); });
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{
    id: "order", description: "fixture", extensions: [], async *writeStream(book, _options, context) {
      const original = [...book.sheets[0]!.cells, { ...book.sheets[0]!.cells[0]!, value: { kind: "number" as const, value: -1 } }];
      const expected = [...original].sort((a, b) => a.row - b.row || a.column - b.column);
      const nativeSort = Array.prototype.sort;
      const sorting = vi.spyOn(Array.prototype, "sort").mockImplementation(function(this: unknown[], compare) {
        expect(this.length).toBeLessThanOrEqual(1024); return nativeSort.call(this, compare);
      });
      try {
        let index = 0;
        for await (const cell of orderedCells(original, context)) {
          expect(cell).toBe(expected[index++]);
          await Promise.resolve();
        }
        expect(index).toBe(original.length);
      } finally { sorting.mockRestore(); }
      yield Uint8Array.of(42);
    }
  }] });
  const operation = { signal: new AbortController().signal };
  try {
    const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: cells(4099) }] }, operation);
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write() {} } }, { exportType: "order" }, operation);
    expect(written).toBeGreaterThan(32768); expect(maximum).toBeLessThanOrEqual(16384);
    expect(handlesClosed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});

it.each(["write", "read", "cancel"])("retires caller storage and preserves %s failures", async mode => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  const reason = new Error("sort backing failed"); let closed = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    if (mode === "read") vi.spyOn(handle, "read").mockRejectedValue(reason);
    else vi.spyOn(handle, "write").mockImplementation(async () => { if (mode === "cancel") controller.abort(reason); throw reason; });
    vi.spyOn(handle, "close").mockImplementation(async (...args) => { closed++; return close(...args); });
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{
    id: "order", description: "fixture", extensions: [], async *writeStream(book, _options, context) {
      for await (const cell of orderedCells(book.sheets[0]!.cells, context)) yield Uint8Array.of(cell.row % 256);
    }
  }] });
  const operation = { signal: controller.signal };
  try {
    const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: cells(4099) }] }, operation);
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { throw new Error("unexpected output"); } } },
      { exportType: "order" }, operation)).rejects.toBe(reason);
    expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});


function fixture(count: number) {
  const bytes = new Uint8Array(8 + count * 16), borrowed = new Uint8Array(8192);
  let position = 8, closed = false, pendingBytes = 0, maximumPendingBytes = 0;
  const cleanups: Cleanup[] = [];
  const storage: WorkingStorage = {
    allocate(length) { const start = position; position += length; return start; },
    async read(offset, length) { expect(closed).toBe(false); expect(length).toBeLessThanOrEqual(8192); borrowed.set(bytes.subarray(offset, offset + length)); return borrowed.subarray(0, length); },
    async write(offset, chunk) {
      expect(closed).toBe(false); expect(chunk.length).toBeLessThanOrEqual(8192);
      pendingBytes += chunk.length; maximumPendingBytes = Math.max(maximumPendingBytes, pendingBytes);
      try { await Promise.resolve(); bytes.set(chunk, offset); } finally { pendingBytes -= chunk.length; }
    },
    close: vi.fn(async () => { closed = true; })
  };
  const context: CapabilityContext = { signal: new AbortController().signal,
    limits: { inputBytes: 1e6, outputBytes: 1e6, cells: count, sheets: 10, operations: 1e6 },
    environment: { env: {}, locale: "C", timezone: "UTC" }, own(cleanup) { cleanups.push(cleanup); }, createWorkingStorage: vi.fn(() => storage) };
  return { context, storage, cleanups, get pendingBytes() { return pendingBytes; }, get maximumPendingBytes() { return maximumPendingBytes; } };
}

it("owns borrowed merge reads, preserves duplicate order and pauses backing reads between pulls", async () => {
  const supplied = cells(2051);
  supplied.push({ ...supplied[0]!, value: { kind: "number", value: -1 } });
  const expected = [...supplied].sort((a, b) => a.row - b.row || a.column - b.column);
  const backing = fixture(supplied.length), { context, storage } = backing, read = vi.spyOn(storage, "read");
  const source = orderedCells(supplied, context);
  for (const cell of expected) {
    expect(await source.next()).toEqual({ done: false, value: cell });
    const reads = read.mock.calls.length; await Promise.resolve(); expect(read).toHaveBeenCalledTimes(reads);
  }
  expect((await source.next()).done).toBe(true); expect(storage.close).toHaveBeenCalledTimes(1);
  expect(backing.maximumPendingBytes).toBe(8192); expect(backing.pendingBytes).toBe(0);
});

it.each(["return", "cleanup", "cancel"])("retires ordering on %s while traversal is suspended", async mode => {
  const { context, storage, cleanups } = fixture(2051), controller = new AbortController();
  const source = orderedCells(cells(2051), { ...context, signal: controller.signal });
  expect((await source.next()).done).toBe(false);
  if (mode === "return") await source.return(undefined);
  else if (mode === "cleanup") {
    await cleanups[0]!();
    await expect(source.next()).rejects.toMatchObject({ code: "invalid-request" });
  } else {
    const reason = new Error("cancel ordering"); controller.abort(reason);
    await expect(source.next()).rejects.toBe(reason);
  }
  for (const cleanup of cleanups) await cleanup();
  expect(storage.close).toHaveBeenCalledTimes(1);
});

it("reports both backing and cleanup failures without losing either cause", async () => {
  const { context, storage } = fixture(2051), primary = new Error("write"), cleanup = new Error("close");
  vi.spyOn(storage, "write").mockRejectedValue(primary);
  vi.mocked(storage.close).mockRejectedValue(cleanup);
  await expect(orderedCells(cells(2051), context).next()).rejects.toMatchObject({ errors: [primary, cleanup] });
});

it("does not acquire backing storage for already ordered cells or a bounded small run", async () => {
  const { context } = fixture(2051);
  vi.mocked(context.createWorkingStorage!).mockImplementation(() => { throw new Error("unnecessary backing store"); });
  for (const supplied of [[], cells(1), cells(20), cells(2051).sort((a, b) => a.row - b.row || a.column - b.column)]) {
    const result = [];
    for await (const cell of orderedCells(supplied, context)) result.push(cell);
    expect(result).toEqual([...supplied].sort((a, b) => a.row - b.row || a.column - b.column));
  }
  expect(context.createWorkingStorage).not.toHaveBeenCalled();
});
