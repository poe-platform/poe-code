import { afterEach, expect, it, vi } from "vitest";
import { utils, write } from "@e965/xlsx";
import * as ssconvert from "safe-bash-command-ssconvert";
import { convert, readDocument } from "./index.js";

const context = { yield: async () => {} };
afterEach(() => vi.restoreAllMocks());
function spreadsheet(rows: (string | number)[][], name = "Quarterly report", formulas = false): Uint8Array {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet(rows);
  if (formulas) {
    sheet.B2 = { t: "n", f: "A2+2" };
    sheet.C2 = { t: "n", f: "B2*3" };
    sheet["!ref"] = "A1:C2";
  }
  utils.book_append_sheet(workbook, sheet, name);
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
}

it.each(["gfm", "markdown", "html", "rst"])("uses the first XLSX row as the %s table header", async to => {
  const bytes = spreadsheet([["Item name", "Total"], ["Green apples", 7]]);
  const result = await convert([{ bytes }], { from: "xlsx", to }, context);
  expect(result.kind).toBe("text");
  if (result.kind !== "text") throw new Error("Expected text");
  expect(result.text).toContain("Item name");
  expect(result.text).toContain("Green apples");
  expect(result.diagnostics).toEqual([]);
  if (to === "html") expect(result.text).toContain('<th scope="col">Item name</th>');
  if (to === "rst") expect(result.text).toContain("===");
});

it("preserves literal spaces and line breaks in sheet names and cells", async () => {
  const bytes = spreadsheet([["Heading"], ["two words\nand **literal**"]]);
  const document = await readDocument({ bytes }, { from: "xlsx" }, context);
  expect(document.blocks[0]).toMatchObject({ t: "Header", c: [1, ["", [], []], [
    { t: "Str", c: "Quarterly" }, { t: "Space" }, { t: "Str", c: "report" }
  ]] });
  const table = document.blocks[1];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[3][1]).toHaveLength(1);
  expect(table.c[4][0]?.[3][0]?.[1][0]?.[4]).toEqual([{ t: "Plain", c: [
    { t: "Str", c: "two" }, { t: "Space" }, { t: "Str", c: "words" },
    { t: "LineBreak" }, { t: "Str", c: "and" }, { t: "Space" }, { t: "Str", c: "**literal**" }
  ] }]);
});

it("calculates uncached formulas and their dependencies before conversion", async () => {
  const bytes = spreadsheet([["Value", "Plus two", "Times three"], [5]], "Formulas", true);
  const result = await convert([{ bytes }], { from: "xlsx", to: "html" }, context);
  expect(result).toMatchObject({ kind: "text", text: expect.stringContaining("<td>7</td>") });
  expect(result).toMatchObject({ kind: "text", text: expect.stringContaining("<td>21</td>") });
});

it("projects asynchronous recalculation limits through the reader error boundary", async () => {
  vi.spyOn(ssconvert, "recalculateWorkbook").mockRejectedValueOnce(new ssconvert.SsconvertError("resource-limit", "Formula work exhausted"));
  await expect(readDocument({ bytes: spreadsheet([["Value"], [5]]) }, { from: "xlsx" }, context))
    .rejects.toMatchObject({ code: "E_LIMIT", message: "Formula work exhausted" });
});

it("reports cancellation during asynchronous recalculation when the reason is false", async () => {
  const controller = new AbortController();
  vi.spyOn(ssconvert, "recalculateWorkbook").mockImplementationOnce(async () => {
    controller.abort(false);
    throw false;
  });
  await expect(readDocument({ bytes: spreadsheet([["Value"], [5]]) }, { from: "xlsx" }, { ...context, signal: controller.signal }))
    .rejects.toMatchObject({ code: "E_CANCELLED", operation: "read" });
  expect(controller.signal.reason).toBe(false);
});
