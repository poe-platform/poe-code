import { expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import type { CapabilityContext } from "../contracts.js";
import { readGnumeric } from "./gnumeric.js";
import { writePdf } from "./pdf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 4, operations: 100 } };
async function fixture(axis: "h" | "v", type = "manual", position = "2", extra = "") {
  const cells = Array.from({ length: 4 }, (_, index) => `<g:Cell Row="${axis === "h" ? index : 0}" Col="${axis === "v" ? index : 0}" ValueType="60">cell${index}</g:Cell>`).join("");
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:paper>na_letter</g:paper><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/><g:${axis}PageBreaks><g:break pos="${position}" type="${type}"/>${extra}</g:${axis}PageBreaks></g:PrintInformation><g:Cells>${cells}</g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
// Authenticated print.c uses h breaks for row pagination and v for columns.
// Native cleans stored automatic breaks and retains manual/data-slice boundaries.
it.each(["h", "v"] as const)("prints persisted %s page breaks on the correct axis", async axis => {
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    const pdf = await PDFDocument.load(await writePdf(await fixture(axis), [], context));
    expect(pdf.getPageCount()).toBe(2);
    const pages = new Map<object, string[]>();
    draw.mock.calls.forEach(([text], index) => {
      if (!text) return;
      const page = draw.mock.contexts[index]!; pages.set(page, [...pages.get(page) ?? [], text]);
    });
    expect([...pages.values()]).toEqual([["cell0", "cell1"], ["cell2", "cell3"]]);
  } finally { draw.mockRestore(); }
});
it.each(["auto", "none"])("recomputes pagination instead of forcing stored %s breaks", async type => {
  expect((await PDFDocument.load(await writePdf(await fixture("h", type), [], context))).getPageCount()).toBe(1);
});
it("retains data-slice boundaries and ignores a break beyond the printed extent", async () => {
  expect((await PDFDocument.load(await writePdf(await fixture("h", "data-slice"), [], context))).getPageCount()).toBe(2);
  expect((await PDFDocument.load(await writePdf(await fixture("h", "manual", "100"), [], context))).getPageCount()).toBe(1);
});

it("keeps native ascending admission before cleaning automatic entries", async () => {
  const after = '<g:break pos="1" type="manual"/>';
  expect((await PDFDocument.load(await writePdf(await fixture("h", "manual", "2", after), [], context))).getPageCount()).toBe(2);
  expect((await PDFDocument.load(await writePdf(await fixture("h", "auto", "2", after), [], context))).getPageCount()).toBe(1);
});
it("retains ASCII case and integer admission while dropping malformed positions", async () => {
  expect((await PDFDocument.load(await writePdf(await fixture("h", "MANUAL", "  +2"), [], context))).getPageCount()).toBe(2);
  for (const position of ["-1", "2.5", "2e0", "2 ", "+", " "])
    expect((await PDFDocument.load(await writePdf(await fixture("h", "manual", position), [], context))).getPageCount()).toBe(1);
});
