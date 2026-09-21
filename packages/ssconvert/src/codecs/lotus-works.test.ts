import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { probeLotus, readLotus } from "./lotus.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 10000 } };
function record(id: number, data: number[] = []): number[] { return [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data]; }
function file(...records: number[][]): Uint8Array { return Uint8Array.from([...record(255, [4, 4]), ...records.flat(), ...record(1)]); }
function double(n: number): number[] { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, n, true); return [...bytes]; }
it("dispatches the source-supported WorksV3 Lotus service branch from content", async () => {
  const bytes = file(record(14, [0, 0, 0, 0, 0, 0, ...double(42)]), record(15, [1, 0, 0, 0, 0, 0, 233, 0]));
  expect(probeLotus(bytes, context)).toBe(true);
  const book = await readLotus(bytes, context);
  expect(book.sheets[0]?.name).toBe("A");
  expect(book.sheets[0]?.cells.map(c => c.value)).toEqual([{ kind: "number", value: 42 }, { kind: "string", value: "é" }]);
});
it("applies Works style/font records with native fallthrough warning", async () => {
  const font = [0x63, 0, ...Array.from("Arial", c => c.charCodeAt(0)), ...Array<number>(29).fill(0), 24, 0];
  const warnings: string[] = [];
  const book = await readLotus(file(record(0x5456, font), record(0x545a, [0x43, 0x68, 0, 0, 0, 0, 0, 0, 0, 0]), record(14, [0, 0, 0, 0, 0, 0, ...double(42)])), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual(["Unknown record 0x545a of length 10."]);
  expect(book.sheets[0]?.cells[0]?.format).toBe("0.00%");
  expect(book.sheets[0]?.cells[0]?.style).toMatchObject({ fontName: "Arial", fontSize: 12, bold: true, italic: true, fontColor: "#FF0000", horizontalAlignment: "center", verticalAlignment: "center", wrapText: true });
});
it("imports Works cached formulas through its separate function opcode table", async () => {
  const tokens = [5, 2, 0, 0x22, 3];
  const book = await readLotus(file(record(16, [0, 0, 0, 0, 0, 0, ...double(2), tokens.length, 0, ...tokens])), context);
  expect(book.sheets[0]?.cells[0]).toMatchObject({ formula: "=TRUNC(2)", cachedResult: { kind: "number", value: 2 } });
});
it("imports source small-float packing with the hundredths flag", async () => {
  const bytes = new Uint8Array(4), view = new DataView(bytes.buffer); view.setFloat32(0, 12.5, true);
  const bits = view.getUint32(0, true), raw = (bits & 0xfc000000) | (bits >>> 3 & 0x3fffffe) | 1;
  const book = await readLotus(file(record(0x545b, [0, 0, 0, 0, 0, 0, raw & 255, raw >>> 8 & 255, raw >>> 16 & 255, raw >>> 24])), context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 0.125 });
});
it("imports Works blank records and multiple BOF sheets", async () => {
  const book = await readLotus(file(record(12, [0, 0, 0, 0, 0, 0]), record(1), record(255, [4, 4]), record(14, [0, 0, 0, 0, 0, 0, ...double(1)])), context);
  expect(book.sheets.map(s => s.name)).toEqual(["A", "B"]);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "blank" });
});
it("warns for source-ignored Works integer records without inventing cells", async () => {
  const warnings: string[] = [];
  const book = await readLotus(file(record(13, Array<number>(7).fill(0))), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual(["Unknown record 0xd of length 7."]);
  expect(book.sheets[0]?.cells).toEqual([]);
});
it("bounds Works record operations and sheet/cell admission", async () => {
  const bytes = file(record(14, [0, 0, 0, 0, 0, 0, ...double(42)]));
  for (const [budget, message] of [["operations", "operations"], ["sheets", "sheets"], ["cells", "cells"]] as const) await expect(readLotus(bytes, { ...context, limits: { ...context.limits, [budget]: 0 } })).rejects.toThrow(`${message} limit exceeded`);
});
it("rejects cancellation triggered by the last Works style warning", async () => {
  const controller = new AbortController(), reason = new Error("Works warning cancellation");
  await expect(readLotus(file(record(0x545a, Array<number>(10).fill(0))), { ...context, signal: controller.signal, async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});
