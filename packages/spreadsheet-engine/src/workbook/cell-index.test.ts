import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine } from "../engine.js";
import type { CellIndex } from "../contracts.js";

it("indexes unordered and duplicate cells through bounded caller-owned storage", async () => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let persisted = 0, maximum = 0, closed = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, position, options) => {
      persisted += bytes.length; maximum = Math.max(maximum, bytes.length); return write(bytes, position, options);
    });
    vi.spyOn(handle, "close").mockImplementation(async options => { closed++; await close(options); });
    return handle;
  });
  let saved!: CellIndex;
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 32768 }, codecs: [{
    id: "index", description: "fixture", extensions: [], async *writeStream(book, _options, context) {
      const index = saved = await context.createCellIndex!(book.sheets[0]!.cells);
      for (const row of [0, 7999, 127, 1700]) expect(await index.get(row, 0)).toEqual(book.sheets[0]!.cells[7999 - row]);
      expect(await index.get(0, 1)).toBeUndefined();
      await index.close();
      await expect(index.get(0, 0)).rejects.toThrow("closed");
      const last = { ...book.sheets[0]!.cells[0]!, value: { kind: "number" as const, value: 42 } };
      const duplicate = await context.createCellIndex!([book.sheets[0]!.cells[0]!, last]);
      expect(await duplicate.get(last.row, last.column)).toBe(last);
      await duplicate.close();
      yield Uint8Array.of(42);
    }
  }] });
  const operation = { signal: new AbortController().signal };
  const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: Array.from({ length: 8000 }, (_, i) =>
    ({ row: 7999 - i, column: 0, value: { kind: "number" as const, value: i } })) }] }, operation);
  await engine.writeWorkbook(book, { kind: "stream", sink: { async write() {} } }, { exportType: "index" }, operation);
  expect(persisted).toBeGreaterThan(32768); expect(maximum).toBeLessThanOrEqual(16384); expect(closed).toBe(1);
  expect(await fs.readdir("/")).toEqual([]);
  await expect(saved.get(0, 0)).rejects.toThrow("closed");
  await engine.dispose();
});

it.each(["write", "cancel"] as const)("retires index storage after %s failure", async failure => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  const reason = new Error("index spill failed");
  let closed = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async () => {
      if (failure === "cancel") controller.abort(reason);
      throw reason;
    });
    vi.spyOn(handle, "close").mockImplementation(async options => { closed++; await close(options); });
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{
    id: "index", description: "fixture", extensions: [], async *writeStream(book, _options, context) {
      await context.createCellIndex!(book.sheets[0]!.cells);
      yield Uint8Array.of(42);
    }
  }] });
  const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: Array.from({ length: 3000 }, (_, row) =>
    ({ row, column: 0, value: { kind: "number" as const, value: row } })) }] }, { signal: controller.signal });
  await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { throw new Error("unexpected output"); } } },
    { exportType: "index" }, { signal: controller.signal })).rejects.toBe(reason);
  expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});
