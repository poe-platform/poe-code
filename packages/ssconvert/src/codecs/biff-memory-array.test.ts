import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff } from "./biff.js";
import { Binary } from "./biff-binary.js";
import { biffFormulaExtras } from "./biff-formula-extras.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
// MS-XLS 2.5.198.61: PtgExtraMem is a uint16 count followed by Ref8U entries.
// https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/0a225048-f0a1-4093-8b0b-6d8f8497f8ce
const memory = [1, 0, 1, 0, 2, 0, 0, 0, 0, 0]; // Cached A2:A3 area.
const array = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 240, 63]; // {1}.
const sumMemory = [0x26, 0, 0, 0, 0, 11, 0, 0x24, 1, 0, 0, 0, 0x24, 2, 0, 0, 0, 0x10, 0x22, 1, 4, 0];
const sumArray = [0x40, 0, 0, 0, 0, 0, 0, 0, 0x22, 1, 4, 0];

function workbook(tokens: readonly number[], parts: readonly (readonly number[])[]): Uint8Array {
  const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];
  const header = new Uint8Array(22); new DataView(header.buffer).setFloat64(6, 999, true); header[20] = tokens.length;
  const numbers = [20, 22].flatMap((value, index) => {
    const data = new Uint8Array(14); data[0] = index + 1; new DataView(data.buffer).setFloat64(6, value, true);
    return record(0x203, [...data]);
  });
  return new Uint8Array([...record(0x809, [0, 6, 16, 0]), ...record(6, [...header, ...tokens, ...(parts[0] ?? [])]),
    ...parts.slice(1).flatMap(part => record(0x3c, part)), ...numbers, ...record(10, [])]);
}

for (const first of ["memory", "array"]) for (const continued of [false, true])
it(`consumes ${first} auxiliary data first across ${continued ? "continued" : "single"} BIFF records`, async () => {
  const tokens = first === "memory" ? [...sumMemory, ...sumArray, 3] : [...sumArray, ...sumMemory, 3];
  const extra = first === "memory" ? [...memory, ...array] : [...array, ...memory];
  const book = await readBiff(workbook(tokens, continued ? [extra.slice(0, 5), extra.slice(5)] : [extra]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe(first === "memory" ? "=SUM($A$2,$A$3)+SUM({1})" : "=SUM({1})+SUM($A$2,$A$3)");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 43 });
});

it.each([[], [1], memory.slice(0, -1)].map(extra => ({ extra })))("refuses truncated memory-area extras $extra", async ({ extra }) => {
  await expect(readBiff(workbook(sumMemory, [extra]), context)).rejects.toThrow("Invalid Excel BIFF");
});

it("admits empty cached areas without changing formula references", async () => {
  const book = await readBiff(workbook(sumMemory, [[0, 0]]), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});

it("bounds declared memory areas before reading their payload", async () => {
  await expect(readBiff(workbook(sumMemory, [[255, 255]]), { ...context,
    limits: { ...context.limits, workbookWork: 1000 } })).rejects.toThrow("work limit");
});

it.each([0x26, 0x46, 0x66])("consumes repeated memory tokens of class %i alongside repeated arrays", async token => {
  const cached = [token, ...sumMemory.slice(1)];
  const book = await readBiff(workbook([...cached, ...sumArray, 3, ...cached, 3, ...sumArray, 3],
    [[...memory, ...array, ...memory, ...array]]), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 86 });
});

it("checks cancellation inside cached-area traversal", () => {
  let checks = 0;
  const signal = { throwIfAborted() { if (++checks === 5) throw new Error("cancel cached areas"); } } as AbortSignal;
  const extra = new Uint8Array(2 + 20 * 8); extra[0] = 20;
  const reader = biffFormulaExtras([new Binary(extra)], 8, 1252, { ...context, signal });
  expect(reader.readMemory).toThrow("cancel cached areas");
});
