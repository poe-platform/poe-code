import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readGnumeric } from "./gnumeric.js";
import { writePdf } from "./pdf.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 10, operations: 100 } };
const fixture = (settings: string) => new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:PrintInformation>${settings}</g:PrintInformation><g:Cells>${Array.from({ length: 90 }, (_, row) => `<g:Cell Row="${row}" Col="0" ValueType="60">row ${row}</g:Cell>`).join("")}</g:Cells></g:Sheet></g:Sheets></g:Workbook>`);

it("uses persisted landscape Letter geometry and percentage scale", async () => {
  const book = await readGnumeric(fixture('<g:paper>na_letter</g:paper><g:orientation>landscape</g:orientation><g:Scale type="percentage" percentage="50"/>'), context);
  const pdf = await PDFDocument.load(await writePdf(book, [], context));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
});

it("uses persisted top and bottom margins when paginating", async () => {
  const book = await readGnumeric(fixture('<g:Margins><g:top Points="200"/><g:bottom Points="200"/></g:Margins>'), context);
  expect((await PDFDocument.load(await writePdf(book, [], context))).getPageCount()).toBe(3);
});

it("preserves explicit rejection of enabled print features without a painter", async () => {
  const book = await readGnumeric(fixture('<g:grid value="1"/>'), context);
  await expect(writePdf(book, [], context)).rejects.toMatchObject({ code: "unsupported-feature", exitCode: 1 });
});
