import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import type { Workbook } from "../workbook.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };

it.each([
  ["First", "Last", 6], ["First", "Middle", 3], ["Middle", "Last", 5],
  ["Last", "First", 6], ["Middle", "First", 3], ["Last", "Middle", 5]
] as const)("preserves BIFF7 span %s:%s and its recalculation across export/reopen", async (first, last, expected) => {
  const book: Workbook = { sheets: ["First", "Middle", "Last"].map((name, index) => ({ id: name, name,
    cells: [{ row: 0, column: 0, value: { kind: "number" as const, value: index + 1 } },
      ...(index === 1 ? [{ row: 2, column: 1, formula: `=SUM('${first}':'${last}'!$A$1)`,
        value: { kind: "number" as const, value: 999 } }] : [])] })) };
  const reopened = await readBiff(await createBiffWriter(7)(book, [], context), context);
  expect(reopened.sheets[1]!.cells.find(cell => cell.row === 2)!.formula)
    .toBe(`=SUM('${first}':'${last}'!$A$1:$A$1)`);
  expect(recalculateWorkbook(reopened, context, true).sheets[1]!.cells.find(cell => cell.row === 2)!.value)
    .toEqual({ kind: "number", value: expected });
});

it("reads an original zero-based legacy sheet-span payload using the independently bound workbook order", () => {
  const bytes = new Uint8Array(18), view = new DataView(bytes.buffer);
  bytes[0] = 0x3a; view.setInt16(1, -1, true); view.setUint16(13, 2, true);
  expect(translateBiffFormula(bytes, { revision: 7, codepage: 1252, row: 0, column: 0, names: [],
    externalSheets: ["First", "Middle", "Last"], localSheets: ["First", "Middle", "Last"], limit: 100 }))
    .toBe("='First':'Last'!$A$1");
});
