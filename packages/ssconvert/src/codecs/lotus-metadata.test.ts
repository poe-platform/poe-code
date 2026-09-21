import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 4, operations: 1000 } };
function record(id: number, data: number[] = []): number[] { return [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data]; }
function file(...records: number[][]): Uint8Array { return Uint8Array.from([...record(0, [5, 16, ...Array<number>(14).fill(0), 1, 0, 0]), ...records.flat(), ...record(1)]); }
it("imports Lotus selection and viewport without synthesizing cells", async () => {
  const book = await readLotus(file(record(5, [0, 0, 0, 0, 9, 0, 3, 2, 7, 0, 0, 0, 0, 0, 0, 0])), context);
  expect(book.sheets[0]?.view).toEqual({ selection: "D10", initialTopLeft: "C8" });
  expect(book.sheets[0]?.cells).toEqual([]);
});
it("accepts source-ignored named-sheet and text-style records", async () => {
  const book = await readLotus(file(record(0x23), record(0x1b, [0xa1, 15, ...Array<number>(22).fill(0)]), record(20, [0, 0, 0, 0])), context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "error", value: "#VALUE!" });
});
it("STYLE 0x36b0 names its indexed sheet with source byte semantics", async () => {
  const book = await readLotus(file(record(0x1b, [0xb0, 0x36, 1, 0, 88, 89, 0])), context);
  expect(book.sheets.map(s => s.name)).toEqual(["Sheet1", "XY"]);
});
it("imports Lotus row format runs before values and duplicates row formats", async () => {
  const book = await readLotus(file(record(0x13, [0, 0, 3, 0, 0x32, 0, 0, 0x80, 1]), record(0x13, [0, 2, 4, 0, 0, 0, 3, 0]), record(20, [3, 0, 0, 1]), record(20, [4, 0, 0, 1])), context);
  expect(book.sheets[0]?.cells.filter(c => c.column === 1).map(c => c.format)).toEqual(["0.00%", "0.00%"]);
});
it("retains a source-supported Lotus comment with its cell anchor", async () => {
  const book = await readLotus(file(record(0x26, [2, 0, 0, 1, 0, 104, 105, 0])), context);
  expect(book.sheets[0]?.unsupportedRecords).toEqual([{ source: "lotus", kind: "CellComment", disposition: "retained", data: { ObjectBound: "B3", Text: "hi" } }]);
});
function dword(value: number): number[] { return [value & 255, value >> 8 & 255, value >> 16 & 255, value >>> 24]; }
it("applies SS98 RLDB column widths with registered run reuse and hidden flags", async () => {
  const book = await readLotus(file(record(20, [0, 0, 0, 0]), record(0x295), record(0x804, [0, 0, 2, 0, ...dword(2), ...dword(1)]), record(0x800, dword(1)), record(0x802, [1, 0]), record(0x800, dword(1)), record(0x801, [0, 0, 3, 0, ...dword(1740)]), record(0x803, [1, 0]), record(0x295)), context);
  expect(book.sheets[0]?.columns).toEqual([{ index: 0, sizePoints: (174000 + 880) / 1740, hidden: true }, { index: 1, sizePoints: (174000 + 880) / 1740, hidden: true }]);
});
it("applies RLDB three-dimensional format ranges only to imported cells", async () => {
  const book = await readLotus(file(record(20, [0, 0, 0, 0]), record(0x293), record(0x804, [0, 0, 3, 0, ...dword(2), ...dword(1), ...dword(1)]), record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(2)), record(0x801, dword(0x32)), record(0x293)), context);
  expect(book.sheets[0]?.cells).toEqual([{ row: 0, column: 0, value: { kind: "error", value: "#VALUE!" }, format: "0.00%" }]);
});
it("applies a Lotus font-name style pool through three-dimensional RLDB", async () => {
  const book = await readLotus(file(record(0x1b, [0xdc, 15, 7, 0, 0, 0, 0, 0, 0, 0, 84, 101, 115, 116, 0]), record(20, [0, 0, 0, 0]), record(0x284), record(0x804, [0, 0, 3, 0, ...dword(1), ...dword(1), ...dword(1)]), record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(1)), record(0x801, [7, 0]), record(0x284)), context);
  expect(book.sheets[0]?.cells[0]?.style).toEqual({ fontName: "Test" });
});
it("applies cell style font size and explicit font face masks", async () => {
  const style = [0xd2, 15, 7, 0, 0, 0, 0, 0, 0, 0, 0x40, 1, 0xff, 0xff, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff];
  const book = await readLotus(file(record(0x1b, style), record(20, [0, 0, 0, 0]), record(0x293), record(0x804, [0, 0, 3, 0, ...dword(1), ...dword(1), ...dword(1)]), record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(1)), record(0x801, [...dword(0x832), 7, 0]), record(0x293)), context);
  expect(book.sheets[0]?.cells[0]?.style).toMatchObject({ fontSize: 12.5, bold: true, italic: false });
});
it.each([[0x800, "RLDB_NODE", dword(1)], [0x801, "RLDB_DATANODE", []], [0x802, "RLDB_REGISTERID", [1, 0]], [0x803, "RLDB_USEID", [1, 0]]] as const)("warns for stray Lotus RLDB opcode %x", async (id, name, payload) => {
  const warnings: string[] = [];
  await readLotus(file(record(id, [...payload]), record(20, [0, 0, 0, 0])), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual([`Ignoring stray ${name}`]);
});
it("rejects an undefined registered RLDB subtree without allocating cells", async () => {
  await expect(readLotus(file(record(0x804, [0, 0, 2, 0, ...dword(1), ...dword(1)]), record(0x803, [1, 0])), context)).rejects.toThrow("Error while reading lotus workbook.");
});
it("bounds RLDB subtree construction by the shared operation budget", async () => {
  await expect(readLotus(file(record(0x804, [0, 0, 2, 0, ...dword(1), ...dword(1)]), record(0x800, dword(1))), { ...context, limits: { ...context.limits, operations: 1 } })).rejects.toThrow("operations limit exceeded");
});
it("rejects unknown zero run lengths without loops", async () => {
  await expect(readLotus(file(record(0x804, [0, 0, 2, 0, ...dword(1), ...dword(1)]), record(0x800, dword(0))), context)).rejects.toThrow("Error while reading lotus workbook.");
});
it("preserves cancellation raised by RLDB clipping diagnostics", async () => {
  const controller = new AbortController(), reason = new Error("clip cancellation");
  await expect(readLotus(file(record(0x804, [0, 0, 2, 0, ...dword(1), ...dword(1)]), record(0x800, dword(2))), { ...context, signal: controller.signal, async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});
it("retains empty formatted ranges without manufacturing blank cells", async () => {
  const book = await readLotus(file(record(0x13, [0, 0, 3, 0, 0x32, 0, 0, 0x80, 1])), context);
  expect(book.sheets[0]?.cells).toEqual([]);
  expect(book.sheets[0]?.unsupportedRecords).toEqual([{ source: "lotus", kind: "FormatRange", disposition: "retained", data: { startRow: 3, endRow: 3, startColumn: 0, endColumn: 1, format: "0.00%" } }]);
});
it("preserves RLDB formats on cells that appear after the database close", async () => {
  const book = await readLotus(file(record(5, Array<number>(16).fill(0)), record(0x293), record(0x804, [0, 0, 3, 0, ...dword(1), ...dword(1), ...dword(1)]), record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(1)), record(0x801, dword(0x32)), record(0x293), record(20, [0, 0, 0, 0])), context);
  expect(book.sheets[0]?.cells[0]?.format).toBe("0.00%");
});
it("DUPFMT copies imported font attributes along with number formats", async () => {
  const book = await readLotus(file(record(0x1b, [0xdc, 15, 7, 0, 0, 0, 0, 0, 0, 0, 84, 101, 115, 116, 0]), record(20, [0, 0, 0, 0]), record(0x284), record(0x804, [0, 0, 3, 0, ...dword(1), ...dword(1), ...dword(1)]), record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(1)), record(0x801, [7, 0]), record(0x284), record(0x13, [0, 2, 1, 0, 0, 0, 0, 0]), record(20, [1, 0, 0, 0])), context);
  expect(book.sheets[0]?.cells.find(c => c.row === 1)?.style).toEqual({ fontName: "Test" });
});
