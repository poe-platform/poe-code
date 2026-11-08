import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 100000 } };
const fields = ["objects", "scenarios", "formatCells", "formatColumns", "formatRows", "insertColumns", "insertRows",
  "insertHyperlinks", "deleteColumns", "deleteRows", "selectLockedCells", "sort", "autoFilter", "pivotTables", "selectUnlockedCells"];
for (const edition of ["2006", "2008"] as const) {
  it.each(fields)(`${edition} transports the %s allow permission using OOXML deny semantics`, async name => {
    const allowed = Object.fromEntries(fields.map(field => [field, field === name]));
    const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], view: { gnumeric: { Protected: "1" }, protectedAllow: allowed } }] };
    const imported = await readXlsx(await createXlsxWriter(edition)(book, [], context), context);
    const protection = metadataNode(imported.sheets[0]!.unsupportedRecords!.find(record => record.kind === "sheetProtection")!.data)!;
    expect(protection.attributes[name]).toBe("0");
    expect(imported.sheets[0]!.view?.protectedAllow).toEqual(allowed);
    const edited = { ...imported, sheets: imported.sheets.map(sheet => ({ ...sheet, view: { ...sheet.view,
      protectedAllow: Object.fromEntries(fields.map(field => [field, field !== name])) } })) };
    const reopened = await readXlsx(await createXlsxWriter(edition)(edited, [], context), context);
    expect(reopened.sheets[0]!.view?.protectedAllow).toEqual(edited.sheets[0]!.view.protectedAllow);
  });
}

it("uses selection-only defaults for partial maps and rejects invalid fields", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], view: { protectedAllow: { formatCells: true } } }] };
  const result = await readXlsx(await createXlsxWriter("2006")(book, [], context), context);
  expect(result.sheets[0]!.view?.protectedAllow).toEqual(Object.fromEntries(fields.map(name =>
    [name, ["formatCells", "selectLockedCells", "selectUnlockedCells"].includes(name)])));
  for (const protectedAllow of [null, [], { formatCells: "true" }, { unknown: true }]) {
    await expect(createXlsxWriter("2006")({ sheets: [{ ...book.sheets[0]!, view: { protectedAllow } }] }, [], context))
      .rejects.toThrow("sheet protection permission");
  }
});
