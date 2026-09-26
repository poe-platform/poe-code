import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readLotus } from "./lotus.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 100 }
};
const record = (id: number, data: number[] = []) => [id, 0, data.length & 255, data.length >>> 8, ...data];

it.each([
  { encoded: [0x14, 0xf6, 0x01], text: "Ā" },
  { encoded: [0x14, 0xf6, 0x4e], text: "一" },
  { encoded: [0x14, 0xf6, 0xe0], text: "\ue000" },
  { encoded: [0x14, 0xe0, 0x01], text: "\ue001" },
  { encoded: [0x14, 0xd8, 0x3d, 0x14, 0xf6, 0xde], text: "😀" },
  { encoded: [0x14, 0x20, 0xac], text: "€" }
])("decodes LMBCS Unicode compatibility bytes in labels and formulas %#", async ({ encoded, text }) => {
  // ICU GetUniFromLMBCSUni swaps F6/xx to xx/00; other code units, including
  // private-use characters and surrogate pairs, retain their UTF-16 values.
  const warnings: string[] = [];
  const bytes = Uint8Array.from([
    ...record(0, [2, 16, 4, 0, ...Array<number>(22).fill(0)]),
    ...record(22, [0, 0, 0, 0, 39, 65, ...encoded, 90, 0]),
    ...record(25, [0, 0, 0, 1, ...Array<number>(10).fill(0), 6, 65, ...encoded, 90, 0, 3]),
    ...record(1)
  ]);
  const book = await readLotus(bytes, { ...context, async diagnostic(d) { warnings.push(d.message); } });
  const calculated = recalculateWorkbook(book, context, true);
  expect(calculated.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: `A${text}Z` }, { kind: "string", value: `A${text}Z` }
  ]);
  expect(warnings).toEqual([]);
});
