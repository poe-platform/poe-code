import type { Cell } from "@poe-code/spreadsheet-ast";
import { expect, test } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createBiffWriter, readBiff, readBiffWorkbookSource } from "./biff.js";
import { xlsFormat } from "./index.js";

const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 2000, sheets: 10, operations: 100 } };

test.each([7, 8] as const)("replays BIFF%s scalar cells with metadata parity and no resident cell arrays", async revision => {
  const cells = Array.from({ length: 200 }, (_, row) => ({ row, column: 0, value: row % 2 ? { kind: "string" as const, value: `row ${row}` } : { kind: "number" as const, value: row }, format: "0.00" }));
  const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "Data", cells, view: { marginLeft: 40 } }] }, [], context);
  const expected = await readBiff(bytes, context), fs = createMemoryFileSystem();
  let inspecting = false;
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{ id: "fixture", description: "fixture", extensions: [],
    async readSource(range, ctx) {
      const source = await readBiffWorkbookSource(range, ctx); expect(source).toBeDefined();
      expect(source!.metadata).toEqual({ ...expected, sheets: expected.sheets.map(sheet => ({ ...sheet, cells: [] })) });
      for (let pass = 0; pass < 2; pass++) for (const sheet of expected.sheets) {
        let at = 0;
        for await (const cell of source!.cells(sheet.id)) { inspecting = true; try { expect(cell).toEqual(sheet.cells[at++]); } finally { inspecting = false; } }
        expect(at).toBe(sheet.cells.length);
      }
      return source!.metadata;
    }
  }] });
  const push = Array.prototype.push;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (!inspecting && items.some(item => item && typeof item === "object" && ("cell" in item && "xf" in item || "row" in item && "column" in item && "value" in item)))
      throw new Error("resident BIFF cell array");
    return push.apply(this, items);
  };
  try { await engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: "fixture" }, { signal: context.signal }); }
  finally { Array.prototype.push = push; await engine.dispose(); }
  expect(await fs.readdir("/")).toEqual([]);
});

test("registers BIFF replay and declines formula workbooks", async () => {
  expect(xlsFormat.services.find(service => service.direction === "read")!.readWorkbookSource).toBeTypeOf("function");
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [{ row: 0, column: 0, formula: "=1+1", value: { kind: "number", value: 2 } }] }] }, [], context);
  const fs = createMemoryFileSystem(), engine = createEngine({ workingFiles: { fs, directory: "/" }, codecs: [{ id: "fixture", description: "fixture", extensions: [],
    async readSource(range, ctx) { expect(await readBiffWorkbookSource(range, ctx)).toBeUndefined(); return readBiff(range, ctx); }
  }] });
  const result = await engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: "fixture" }, { signal: context.signal });
  expect(result.sheets[0]!.cells[0]!.formula).toBe("=1+1");
  expect(await fs.readdir("/")).toEqual([]); await engine.dispose();
});

test("stages unordered sheet cells independently and preserves negative zero and replay ownership", async () => {
  const { createBiffCellSource } = await import("./biff-cell-source.js");
  const fs = createMemoryFileSystem(); let saved: ReturnType<typeof createBiffCellSource> | undefined;
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{ id: "fixture", description: "fixture", extensions: [],
    async readSource(_range, ctx) {
      const source = saved = createBiffCellSource(ctx);
      for (let row = 19; row >= 0; row--) for (const sheet of [1, 0]) await source.append(sheet, { xf: 0, revision: 8, codepage: 1252,
        cell: { row, column: 0, value: { kind: "number", value: row ? sheet * 100 + row : -0 } } });
      await expect(source.append(0, { xf: 0, revision: 8, codepage: 1252, cell: { row: 0, column: 0, value: { kind: "blank" } } })).rejects.toThrow("Duplicate");
      for (let pass = 0; pass < 2; pass++) for (const sheet of [1, 0]) {
        let row = 0;
        for await (const value of source.cells(sheet)) {
          expect(value.cell.row).toBe(row); expect(value.cell.value).toEqual({ kind: "number", value: row ? sheet * 100 + row : -0 });
          value.cell = { row: 999, column: 999, value: { kind: "blank" } }; row++;
        }
        expect(row).toBe(20);
      }
      return { sheets: [] };
    }
  }] });
  await engine.readWorkbook({ kind: "range", source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: "fixture" }, { signal: context.signal });
  await expect(saved!.cells(0).next()).rejects.toThrow("closed");
  expect(await fs.readdir("/")).toEqual([]); await engine.dispose();
});

test("converts scalar BIFF to a slow CSV sink through replay rather than array readers", async () => {
  const { csvFormat } = await import("@poe-code/spreadsheet-format-csv");
  const cells = Array.from({ length: 500 }, (_, row) => ({ row, column: 0, value: { kind: "number" as const, value: row } }));
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells }] }, [], context);
  const fs = createMemoryFileSystem(), engine = createEngine({ codecs: [], workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [csvFormat,
    { ...xlsFormat, services: xlsFormat.services.map(service => service.direction === "read" ? { ...service, readSource() { throw new Error("array input"); }, read() { throw new Error("buffered input"); } } : service) }
  ] });
  let output = "", pending = 0;
  await engine.convert({ input: { kind: "range", source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + Math.min(length, 257)); } } },
    importType: "Gnumeric_Excel:excel", exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(chunk) {
      expect(++pending).toBe(1); expect(chunk.length).toBeLessThanOrEqual(16384); await Promise.resolve(); output += new TextDecoder().decode(chunk); pending--;
    } } } }, { signal: context.signal });
  expect(output).toBe(cells.map(cell => cell.value.value + "\n").join(""));
  expect(await fs.readdir("/")).toEqual([]); await engine.dispose();
});

test.each([2, 3, 4])("replays raw BIFF%i worksheets", async revision => {
  const body = new Uint8Array(revision === 2 ? 9 : 14);
  if (revision === 2) new DataView(body.buffer).setUint16(7, 42, true); else new DataView(body.buffer).setFloat64(6, 42, true);
  const bof = revision === 2 ? 9 : revision === 3 ? 0x209 : 0x409, number = revision === 2 ? 2 : 0x203;
  const bytes = Uint8Array.from([bof & 255, bof >> 8, 4, 0, 0, 0, 16, 0, number & 255, number >> 8, body.length, 0, ...body, 10, 0, 0, 0]);
  const expected = await readBiff(bytes, context), fs = createMemoryFileSystem();
  const engine = createEngine({ workingFiles: { fs, directory: "/" }, codecs: [{ id: "fixture", description: "fixture", extensions: [], async readSource(range, ctx) {
    const source = (await readBiffWorkbookSource(range, ctx))!;
    const cells: Cell[] = []; for await (const cell of source.cells(source.metadata.sheets[0]!.id)) cells.push(cell);
    expect({ ...source.metadata, sheets: source.metadata.sheets.map(sheet => ({ ...sheet, cells })) }).toEqual(expected);
    return source.metadata;
  } }] });
  await engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: "fixture" }, { signal: context.signal });
  expect(await fs.readdir("/")).toEqual([]); await engine.dispose();
});

test.each(["xor", "rc4", "rc4-cryptoapi-128-properties"])("replays encrypted %s scalar cells with properties", async encryption => {
  const ctx = { ...context, password: { async read() { return encryption === "xor" ? new Uint8Array([112, 97, 115, 115]) : "password"; } },
    entropy: { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const bytes = await createBiffWriter(8)({ properties: { title: "private" }, sheets: [{ id: "s", name: "Data", cells: [{ row: 0, column: 0, value: { kind: "string", value: "private text" } }] }] }, [`encryption=${encryption}`], ctx);
  const expected = await readBiff(bytes, ctx), fs = createMemoryFileSystem();
  const engine = createEngine({ password: ctx.password, workingFiles: { fs, directory: "/" }, codecs: [{ id: "fixture", description: "fixture", extensions: [], async readSource(range, ctx) {
    const source = (await readBiffWorkbookSource(range, ctx))!;
    expect(source.metadata.properties).toEqual(expected.properties);
    for await (const cell of source.cells(source.metadata.sheets[0]!.id)) expect(cell).toEqual(expected.sheets[0]!.cells[0]);
    return source.metadata;
  } }] });
  await engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: "fixture" }, { signal: context.signal });
  expect(await fs.readdir("/")).toEqual([]); await engine.dispose();
});

test.each(["read", "sink", "cancel"])("retires staged replay after %s failure", async mode => {
  const { csvFormat } = await import("@poe-code/spreadsheet-format-csv");
  const cells = Array.from({ length: 100 }, (_, row) => ({ row, column: 0, value: { kind: "number" as const, value: row } }));
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells }] }, [], context);
  const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new Error("replay failure");
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [xlsFormat, csvFormat] });
  await expect(engine.convert({ input: { kind: "range", source: { size: bytes.length, async read(position, length) {
    if (mode === "read" && position > 1024) throw reason; return bytes.subarray(position, position + length);
  } } }, importType: "Gnumeric_Excel:excel", exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write() {
    if (mode === "cancel") controller.abort(reason); else throw reason;
  } } } }, { signal: controller.signal })).rejects.toBe(reason);
  expect(await fs.readdir("/")).toEqual([]); await engine.dispose();
});
