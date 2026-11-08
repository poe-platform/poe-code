import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { recalculateWorkbook } from "@poe-code/spreadsheet-engine/formulas/evaluator";
import { odsFormat } from "./index.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, limits: defaultSsconvertLimits };
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 10, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };

async function workbook(sheet: string, base: string, local: boolean) {
  const quoted = (name: string) => "$'" + name.replaceAll("'", "''") + "'";
  const names = `<table:named-expressions><table:named-expression table:name="Total" table:expression="of:=SUM('Sales')" table:base-cell-address="${quoted(base)}.$B$3"/></table:named-expressions>`;
  const table = (name: string, value: number, target: boolean) => `<table:table table:name="${name}">` +
    '<table:table-row><table:table-cell office:value-type="string"><text:p>Sales</text:p></table:table-cell></table:table-row>' +
    `<table:table-row><table:table-cell office:value-type="float" office:value="${value}"/></table:table-row>` +
    (target ? '<table:table-row><table:table-cell/><table:table-cell table:formula="of:=Total" office:value-type="float" office:value="999"/></table:table-row>' : '') +
    (target && local ? names : '') + '</table:table>';
  const labels = ["First", sheet].map(name => `<table:label-range table:label-cell-range-address="${quoted(name)}.$A$1" table:data-cell-range-address="${quoted(name)}.$A$2:.$A$2" table:orientation="column"/>`).join('');
  const xml = '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"><office:body><office:spreadsheet>' +
    '<table:calculation-settings table:automatic-find-labels="false"/>' + table('First', 3, false) + table(sheet, 10, true) +
    '<table:label-ranges>' + labels + '</table:label-ranges>' + (local ? '' : names) + '</office:spreadsheet></office:body></office:document-content>';
  const zip = createZipCodec(), entries = [];
  for (const [name, source] of Object.entries({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": xml })) {
    entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(source), { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  }
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}

for (const local of [false, true]) {
  it.each([["Second", "Second"], ["Second", "second"], ["O'Brien", "o'BRIEN"], ["Łódź", "łÓDŹ"]])(
    `imports ${local ? "local" : "global"} named formulas based on %s spelled %s`, async (sheet, base) => {
      const engine = createEngine({ formats: [odsFormat] });
      try {
        const book = await engine.readWorkbook({ kind: "stream", filename: "names.ods", source: [await workbook(sheet, base, local)] }, {}, context);
        expect(book.names?.[0]?.position).toEqual({ sheet, row: 2, column: 1 });
        expect(book.names?.[0]?.sheet).toBe(local ? sheet : undefined);
        const calculated = recalculateWorkbook(book, context, true);
        expect(calculated.sheets[1]!.cells.find(cell => cell.row === 2 && cell.column === 1)?.value).toEqual({ kind: "number", value: 10 });
      } finally { await engine.dispose(); }
    });
}

it("retains refusal of a named-formula base on a missing sheet", async () => {
  const engine = createEngine({ formats: [odsFormat] });
  try {
    await expect(engine.readWorkbook({ kind: "stream", filename: "names.ods", source: [await workbook("Second", "Missing", false)] }, {}, context))
      .rejects.toMatchObject({ code: "invalid-request" });
  } finally { await engine.dispose(); }
});
