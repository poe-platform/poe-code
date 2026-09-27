import { expect, it } from "vitest";
import type { Workbook } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { writeGnumeric, readGnumeric } from "./gnumeric.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { context, fixture, content } from "./odf.test.js";

it("retains source-authored ODF sheet relativity through import, copy and export", async () => {
  const imported = await readOdf(await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="First"><table:table-row><table:table-cell table:formula="of:=[Second.A1]+[$Second.A1]"/></table:table-row></table:table><table:table table:name="Second"/><table:table table:name="Third"/>') }), context);
  for (const book of [imported, await readOdf(await createOdfWriter("extended")(imported, [], context), context)]) {
    const result = parseExpression(book.sheets[0]!.cells[0]!.formula!, { position: { sheet: book.sheets[0]!.id, row: 0, column: 0 }, workbook: book });
    if (!result.ok) throw new Error(result.diagnostic.message);
    const copied = rewriteReferences(result.document, { position: { sheet: book.sheets[1]!.id, row: 0, column: 0 }, translation: "copy" });
    expect(copied).toContain("'Third'.A1");
    expect(copied).toContain("$'Second'.A1");
  }
});

for (const [format, write, read] of [["Gnumeric XML", writeGnumeric, readGnumeric],
  ["XLSX", createXlsxWriter("2008"), readXlsx], ["ODF", createOdfWriter("extended"), readOdf]] as const) {
  it(`retains relative cells, named anchors and arrays through ${format}`, async () => {
    const book: Workbook = { names: [{ name: "Previous", expression: "of:=[Second.$A$1]", position: { sheet: "s2", row: 3, column: 2 } }],
      sheets: ["First", "Second", "Third"].map((name, index) => ({ id: `s${index}`, name,
        ...(index === 1 ? { formulaGroups: [{ id: "a", kind: "array" as const, expression: "of:=[Second.$A$1]", range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 } }] } : {}),
        cells: [{ row: 0, column: 0, value: { kind: "number" as const, value: 10 + index } },
          ...(index === 1 ? [{ row: 1, column: 0, formula: "=Previous", value: { kind: "blank" as const } },
            { row: 2, column: 0, formula: "of:=[Second.$A$1]", formulaGroup: "a", value: { kind: "blank" as const } }] : [])]
      })) };
    const reopened = await read(await write(book, [], context), context);
    expect(recalculateWorkbook(reopened, context, true).sheets[1]!.cells.map(cell => cell.value)).toEqual([
      { kind: "number", value: 11 }, { kind: "number", value: 10 }, { kind: "number", value: 11 }
    ]);
    const parsed = parseExpression(reopened.sheets[1]!.cells[2]!.formula!, { position: { sheet: reopened.sheets[1]!.id, row: 2, column: 0 }, workbook: reopened });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    expect(parsed.document.root).toMatchObject({ kind: "reference", first: { sheetRelative: true } });
  });

  it(`preserves formula strings containing XML attribute whitespace through ${format}`, async () => {
    const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, value: { kind: "number", value: 11 } },
      { row: 1, column: 0, formula: 'of:=[Sheet.A1]&"\r\n\t"', value: { kind: "blank" } }
    ] }] };
    const reopened = await read(await write(book, [], context), context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "string", value: "11\r\n\t" });
  });
}

it.each([
  ['ssc:openformula="=12"', "OpenFormula expression"],
  ['ssc:openformula="of:=12" ssc:openformula-origin="bad"', "OpenFormula origin"],
  ['ssc:openformula="of:=12" ssc:openformula-origin="[]"', "OpenFormula origin"],
  ['ssc:openformula="of:=12" ssc:openformula-origin="[&quot;Sheet&quot;,-1,0]"', "OpenFormula origin"]
])("rejects malformed OpenFormula annotations: %s", async (attributes, message) => {
  const xml = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" xmlns:ssc="urn:poe-code:ssconvert:formulas:1"><g:Sheets><g:Sheet><g:Name>Sheet</g:Name><g:Cells><g:Cell Row="0" Col="0" ${attributes}>=11</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  await expect(readGnumeric(new TextEncoder().encode(xml), context)).rejects.toThrow(message);
  const foreign = await readGnumeric(new TextEncoder().encode(xml.replace("urn:poe-code:ssconvert:formulas:1", "urn:foreign")), context);
  expect(recalculateWorkbook(foreign, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 11 });
});
