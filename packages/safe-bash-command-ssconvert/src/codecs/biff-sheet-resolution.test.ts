import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 1000 } };

const cases = [
  { formula: "='sOuRcE'!$A$1", expected: 7 },
  { formula: "='Source'!$A$1", expected: 7 },
  { formula: "=SUM('sOuRcE'!$A$1:'lAsT'!$A$1)", expected: 20 },
  { formula: "='sOuRcE'!Rate", expected: 17 },
  { formula: "='Source'!Rate", expected: 17 },
  { formula: "=Rate", expected: 5 },
  { formula: "=[]Rate", expected: 3 },
  { formula: "='STRASSE'!$A$1", expected: 23 },
  { formula: "='STRASSE'!Rate", expected: 29 }
];

for (const { formula, expected } of cases) it.each([7, 8, "dsf"] as const)(
  `preserves display-name resolution for ${formula} through %s export`, async profile => {
    const book: Workbook = {
      names: [{ name: "Rate", expression: "=3" }, { name: "Rate", sheet: "home", expression: "=5" },
        { name: "Rate", sheet: "target", expression: "=17" }, { name: "Rate", sheet: "unicode", expression: "=29" }],
      sheets: [
        { id: "Source", name: "Decoy", cells: [{ row: 0, column: 0, value: { kind: "number", value: 99 } }] },
        { id: "home", name: "Here", cells: [{ row: 0, column: 0, formula, value: { kind: "number", value: 999 } }] },
        { id: "target", name: "Source", cells: [{ row: 0, column: 0, value: { kind: "number", value: 7 } }] },
        { id: "last", name: "Last", cells: [{ row: 0, column: 0, value: { kind: "number", value: 13 } }] },
        { id: "unicode", name: "Straße", cells: [{ row: 0, column: 0, value: { kind: "number", value: 23 } }] }
      ]
    };
    const original = structuredClone(book);
    expect(recalculateWorkbook(book, context, true).sheets[1]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
    const bytes = await createBiffWriter(profile)(book, [], context);
    for (const stream of readCfb(bytes, context).values()) {
      const reopened = await readBiff(stream, context);
      expect(recalculateWorkbook(reopened, context, true).sheets[1]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
    }
    expect(book).toEqual(original);
  });
