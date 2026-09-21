import { expect, it } from "vitest";
import { readBiff } from "./biff.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };
function r(opcode: number, data: readonly number[] | Uint8Array = []): number[] { return [opcode & 255, opcode >> 8, data.length & 255, data.length >> 8, ...data]; }
function formula(row: number, tokens: readonly number[] = [1, 0, 0, 0, 0]): number[] {
  const data = new Uint8Array(22 + tokens.length), view = new DataView(data.buffer);
  view.setUint16(0, row, true); view.setFloat64(6, row + 10, true); view.setUint16(20, tokens.length, true); data.set(tokens, 22); return r(6, data);
}
function group(kind: "shared" | "array", tokens: readonly number[], start = 0, end = 1): number[] {
  const offset = kind === "array" ? 14 : 10, data = new Uint8Array(offset + tokens.length), view = new DataView(data.buffer);
  view.setUint16(0, start, true); view.setUint16(2, end, true); view.setUint16(offset - 2, tokens.length, true);
  data.set(tokens, offset); return r(kind === "array" ? 0x221 : 0x4bc, data);
}
function workbook(...records: number[][]): Uint8Array {
  return new Uint8Array([...r(0x809, [0, 6, 16, 0]), ...records.flat(), ...r(10)]);
}
it("bounds formula-group allocation by the invocation operation limit", async () => {
  await expect(readBiff(workbook(formula(0), group("shared", [0x1e, 1, 0])),
    { ...context, limits: { ...context.limits, operations: 0 } })).rejects.toThrow("formula group limit");
});
it("rejects a group whose key formula lies outside the group range", async () => {
  await expect(readBiff(workbook(formula(0, [0x1e, 1, 0]), group("shared", [0x1e, 1, 0], 1, 2)), context))
    .rejects.toThrow("formula group");
});
it("rejects trailing bytes after a ptgExp instead of silently discarding tokens", async () => {
  await expect(readBiff(workbook(formula(0, [1, 0, 0, 0, 0, 0x1e, 2, 0]), group("shared", [0x1e, 1, 0])), context))
    .rejects.toThrow("ptgExp");
});
it("keeps unsupported group tokens and caches without dangling public group IDs", async () => {
  const book = await readBiff(workbook(formula(0), group("array", [0x20, 0, 0, 0, 0, 0, 0, 0]), formula(1)), context);
  expect(book.sheets[0]!.formulaGroups).toBeUndefined();
  expect(book.sheets[0]!.cells.map(cell => cell.formulaGroup)).toEqual([undefined, undefined]);
  expect(book.sheets[0]!.cells.map(cell => cell.cachedResult)).toEqual([{ kind: "number", value: 10 }, { kind: "number", value: 11 }]);
  expect(book.sheets[0]!.unsupportedRecords?.some(record => record.kind === "untranslated-formula")).toBe(true);
});
it("uses the array anchor for relative tokens while preserving each cached result", async () => {
  const book = await readBiff(workbook(formula(0), group("array", [0x2c, 0, 0, 0, 0xc0]), formula(1)), context);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["=A1", "=A1"]);
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ expression: "=A1" }]);
  expect(book.sheets[0]!.cells.map(cell => cell.cachedResult)).toEqual([{ kind: "number", value: 10 }, { kind: "number", value: 11 }]);
});
it("reads a string cache after the group definition consumed by the anchor FORMULA", async () => {
  const anchor = formula(0); anchor[4 + 6] = 0; anchor[4 + 12] = 255; anchor[4 + 13] = 255;
  const book = await readBiff(workbook(anchor, group("shared", [0x17, 0, 0]), r(0x207, [0, 0])), context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: '=""', cachedResult: { kind: "string", value: "" } });
});
