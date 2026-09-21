import { expect, it, vi } from "vitest";
import { PDFArray, PDFDocument, PDFPage, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import type { CapabilityContext } from "../contracts.js";
import { readGnumeric } from "./gnumeric.js";
import { writePdf } from "./pdf.js";

function context(): CapabilityContext {
  return { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 10, operations: 100 } };
}

async function fixture(ctx: CapabilityContext, mode = "1", width = 600, height = 700, bound = "A1:A1", offsets = "0 0") {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Clip stress</g:Name><g:Objects><g:SheetObjectGraph Name="wide-tall" AnchorMode="${mode}" ObjectBound="${bound}" ObjectOffset="${offsets} ${width} ${height}"><GogObject type="GogGraph"><property name="style" type="GogStyle"><line dash="none" auto-dash="0"/><fill type="pattern" auto-type="0" is-auto="0"><pattern type="solid" auto-pattern="0" back="ff:00:00:ff"/></fill></property></GogObject></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), ctx);
}

function content(pdf: PDFDocument, page: PDFPage): string {
  return (page.node.Contents() as PDFArray).asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
}

it("retains one spanning scene in all four Cartesian pages with isolated clips", async () => {
  const ctx = context();
  const pdf = await PDFDocument.load(await writePdf(await fixture(ctx), [], ctx));
  expect(pdf.getPageCount()).toBe(4);
  // Original fixture: 600 / 48 -> 13 columns; 700 / 12.75 -> 55 rows.
  // A4 fits 9 columns and 47 rows. Default order is down, then across.
  const expected = [[74.5, 120.5, 432, 599.25], [74.5, -478.75, 432, 102], [-357.5, 120.5, 192, 599.25], [-357.5, -478.75, 192, 102]];
  for (const [index, page] of pdf.getPages().entries()) {
    const stream = content(pdf, page), [x, y, clipWidth, clipHeight] = expected[index]!;
    expect(stream).toContain(`1 0 0 1 ${x} ${page.getHeight() - y! - 700} cm`);
    expect(stream).toContain("0 0 m\n0 700 l\n600 700 l\n600 0 l");
    expect(stream).toContain(`74 ${page.getHeight() - 120 - clipHeight!} ${clipWidth} ${clipHeight} re\nW\nn`);
    let depth = 0;
    for (const token of stream.split(/\s+/)) {
      if (token === "q") depth++;
      if (token === "Q") depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  }
});

it("refuses unqualified absolute spanning geometry instead of returning clipped success", async () => {
  const ctx = context();
  await expect(writePdf(await fixture(ctx, "2"), [], ctx)).rejects.toMatchObject({ code: "unsupported-feature", exitCode: 1 });
});

it("preserves fractional cell anchor offsets across a horizontal page boundary", async () => {
  const ctx = context();
  const pdf = await PDFDocument.load(await writePdf(await fixture(ctx, "1", 350, 10, "C3:C3", "0.5 0.25"), [], ctx));
  expect(pdf.getPageCount()).toBe(2);
  for (const [index, page] of pdf.getPages().entries()) {
    // C3 + half-column / quarter-row = (120, 28.6875) sheet points.
    expect(content(pdf, page)).toContain(`1 0 0 1 ${index ? -237.5 : 194.5} ${page.getHeight() - 149.1875 - 10} cm`);
  }
});

it("does not paint a merely touching graph on the preceding page", async () => {
  const ctx = context();
  const pdf = await PDFDocument.load(await writePdf(await fixture(ctx, "1", 10, 10, "J1:J1"), [], ctx));
  expect(pdf.getPageCount()).toBe(2);
  expect(content(pdf, pdf.getPage(0))).not.toContain("W\nn");
  expect(content(pdf, pdf.getPage(1))).toContain("W\nn");
});

it("does not create an extra page for an object ending exactly at the page boundary", async () => {
  const ctx = context();
  const pdf = await PDFDocument.load(await writePdf(await fixture(ctx, "1", 432, 599.25), [], ctx));
  expect(pdf.getPageCount()).toBe(1);
});

it("admits extreme object extent against the work budget before scene painting", async () => {
  const ctx = context();
  const book = await fixture(ctx, "1", 1e12, 700);
  const draw = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    await expect(writePdf(book, [], { ...ctx, limits: { ...ctx.limits, workbookWork: 100 } })).rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
    expect(draw).not.toHaveBeenCalled();
  } finally { draw.mockRestore(); }
});

it("balances the clip painter state when cancellation occurs during graph painting", async () => {
  const controller = new AbortController(), reason = new Error("independent graph cancellation");
  const ctx = { ...context(), signal: controller.signal };
  const book = await fixture(ctx);
  const original = PDFPage.prototype.drawRectangle;
  const states = vi.spyOn(PDFPage.prototype, "pushOperators");
  const draw = vi.spyOn(PDFPage.prototype, "drawRectangle").mockImplementation(function (this: PDFPage, options) {
    original.call(this, options);
    controller.abort(reason);
  });
  try {
    await expect(writePdf(book, [], ctx)).rejects.toBe(reason);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(states.mock.calls.at(-1)!.map(operator => operator.toString())).toEqual(["Q"]);
  } finally { draw.mockRestore(); states.mockRestore(); }
});
