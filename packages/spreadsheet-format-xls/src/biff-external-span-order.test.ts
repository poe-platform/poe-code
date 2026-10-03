import { expect, it } from "vitest";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { writeBiffStream } from "./biff-write.js";
import { readBiff } from "./biff.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 },
  externalReferences: { resolve() { throw new Error("Export must not fetch sheet order"); } } };
function workbook(span: string, sheets?: string[]): Workbook {
  return { sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, formula: "=['book.xls']Last!A1", value: { kind: "number", value: 999 } },
    { row: 0, column: 1, formula: "=['book.xls']Missing!A1", value: { kind: "number", value: 999 } },
    { row: 0, column: 2, formula: `=SUM(['book.xls']${span}!$A$1:$B$2)`, value: { kind: "number", value: 999 } }
  ] }], ...(sheets ? { unsupportedRecords: [{ source: "xlsx", kind: "externalLink", disposition: "retained",
    data: { externalNameDefinitions: { workbook: "book.xls", sheets, names: [] } } }] } : {}) };
}

it.each(["First:Missing", "Missing:Last", "Missing:Absent"])("refuses invented membership for %s", async span => {
  await expect(writeBiffStream(workbook(span, ["First", "Middle", "Last"]), 8, false, context))
    .rejects.toThrow("Excel BIFF external span requires retained sheet order");
});

it("does not infer a two-sheet span from reference discovery order", async () => {
  await expect(writeBiffStream(workbook("First:Last"), 8, false, context))
    .rejects.toThrow("Excel BIFF external span requires retained sheet order");
});

it.each(["First:Last", "FIRST:last", "Last:First"])("preserves every retained member in %s", async span => {
  const original = workbook(span, ["First", "Middle", "Last"]);
  const reopened = await readBiff(await writeBiffStream(original, 8, false, context), context);
  expect(reopened.unsupportedRecords).toContainEqual(expect.objectContaining({ data: expect.objectContaining({
    externalNameDefinitions: { workbook: "book.xls", sheets: ["First", "Middle", "Last", "Missing"], names: [] }
  }) }));
  expect(reopened.sheets[0]!.cells[2]!.formula).toContain(span === "Last:First" ? "'Last':'First'" : "'First':'Last'");
});

it("allows a new single sheet without claiming span order", async () => {
  const reopened = await readBiff(await writeBiffStream(workbook("New:NEW"), 8, false, context), context);
  expect(reopened.sheets[0]!.cells[2]!.formula).toContain("New");
});
