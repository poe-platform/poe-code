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
  { group: 0x10, encoded: [0x93, 0xfa], text: "日" },
  { group: 0x11, encoded: [0xc7, 0xd1], text: "한" },
  { group: 0x12, encoded: [0xa4, 0xa4], text: "中" },
  { group: 0x13, encoded: [0xd6, 0xd0], text: "中" },
  { group: 0x10, encoded: [0xb6], text: "ｶ" }
])("decodes explicit and implicit LMBCS national group $group %#", async ({ group, encoded, text }) => {
  // ICU maps groups 10/11/12/13 to Windows 932/949/950/936. Single bytes
  // in a double-byte group use a repeated group prefix when explicit.
  const explicit = [group, ...(encoded.length === 1 ? [group] : []), ...encoded];
  const raw = [65, ...encoded, 90, ...explicit, 81, 0];
  const warnings: string[] = [];
  const bytes = Uint8Array.from([
    ...record(0, [2, 16, 4, 0, ...Array<number>(12).fill(0), group, ...Array<number>(9).fill(0)]),
    ...record(22, [0, 0, 0, 0, 39, ...raw]),
    ...record(25, [0, 0, 0, 1, ...Array<number>(10).fill(0), 6, ...raw, 3]), ...record(1)
  ]);
  const book = await readLotus(bytes, { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: `A${text}Z${text}Q` }, { kind: "string", value: `A${text}Z${text}Q` }
  ]);
  expect(warnings).toEqual([]);
});

it.each([
  { encoded: [0x14, 0xf6, 0x01], text: "Ā" },
  { encoded: [0x14, 0xf6, 0x4e], text: "一" },
  { encoded: [0x14, 0xf6, 0xe0], text: "\ue000" },
  { encoded: [0x14, 0xe0, 0x01], text: "\ue001" },
  { encoded: [0x14, 0xd8, 0x3d, 0x14, 0xf6, 0xde], text: "😀" },
  { encoded: [0x14, 0x20, 0xac], text: "€" },
  { encoded: [0x0f, 0x20], text: "\u0000" },
  { encoded: [0x0f, 0x21], text: "\u0001" },
  { encoded: [0x0f, 0x80], text: "\u0080" },
  { encoded: [0x0f, 0x9f], text: "\u009f" },
  { encoded: [0x19], text: "\u0019" },
  { encoded: [0x09], text: "\t" }
])("decodes LMBCS code units in labels and formulas %#", async ({ encoded, text }) => {
  // ICU GetUniFromLMBCSUni swaps F6/xx to xx/00; other code units, including
  // private-use characters and surrogate pairs, retain their UTF-16 values.
  // Group 0F encodes C0/C1 values; 19 and tab are literal single-byte controls.
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
