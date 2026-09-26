import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { resizeWorkbookReferences } from "./resize.js";

const context: CapabilityContext = { limits: { sheets: 8, cells: 100, inputBytes: 100000, outputBytes: 100000, operations: 100 },
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };

it("keeps relative named coordinates and wraps their displayed address after shrink", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Small", size: { rows: 256, columns: 256 },
    cells: [{ row: 0, column: 0, formula: "=A200", value: { kind: "blank" } }] }], names:
    ["=A200", "=$A$200", "=A$200", "=A100:A200", "=A100:$A$200"].map((expression, index) =>
      ({ name: `Example${index}`, expression, sheet: "s", position: { sheet: "s", row: 0, column: 0 } })) };
  const result = resizeWorkbookReferences(book, "s", { rows: 128, columns: 128 }, context);
  expect(result.names!.map(name => name.expression)).toEqual(["=A72", "=#REF!", "=#REF!", "=A72:A100", "=A100:$A$128"]);
  expect(result.sheets[0]!.cells[0]!.formula).toBe("=#REF!");
  expect(book.names![0]!.expression).toBe("=A200");
});
