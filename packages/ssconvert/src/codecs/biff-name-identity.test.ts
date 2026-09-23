import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 1000 } };

for (const collision of [false, true]) it.each([7, 8, "dsf"] as const)(
  `preserves distinct name spelling and scope through %s export (ID collision: ${collision})`, async profile => {
    const book: Workbook = {
      names: [{ name: "Rate", expression: "=11" }, { name: "rate", expression: "=13" },
        { name: "Rate", sheet: "target", expression: "=2" }, { name: "rate", sheet: "target", expression: "=3" },
        { name: "Bridge", sheet: "target", expression: "=Rate+rate+[]Rate+[]rate" }],
      sheets: [
        { id: "decoy", name: collision ? "target" : "Decoy", cells: [{ row: 0, column: 0, value: { kind: "number", value: 99 } }] },
        { id: "target", name: "Data", cells: ["=Rate", "=rate", "=[]Rate", "=[]rate", "=Bridge", "='dAtA'!rate", "=RATE"]
          .map((formula, row) => ({ row, column: 0, formula, value: { kind: "number", value: 999 } })) }
      ]
    };
    const original = structuredClone(book);
    const expected: CellValue[] = [...[2, 3, 11, 13, 29, 3].map(value => ({ kind: "number" as const, value })),
      { kind: "error", value: "#NAME?" }];
    expect(recalculateWorkbook(book, context, true).sheets[1]!.cells.map(cell => cell.value)).toEqual(expected);
    const bytes = await createBiffWriter(profile)(book, [], context);
    for (const stream of readCfb(bytes, context).values()) {
      const reopened = await readBiff(stream, context);
      expect(reopened.names?.map(name => [name.name, name.sheet])).toEqual([
        ["Rate", undefined], ["rate", undefined], ["Rate", "Data"], ["rate", "Data"], ["Bridge", "Data"]
      ]);
      expect(recalculateWorkbook(reopened, context, true).sheets[1]!.cells.map(cell => cell.value)).toEqual(expected);
    }
    expect(book).toEqual(original);
  });
