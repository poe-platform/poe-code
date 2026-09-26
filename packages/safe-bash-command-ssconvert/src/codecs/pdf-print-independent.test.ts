import { expect, it, vi } from "vitest";
import { PDFArray, PDFDocument, PDFPage, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readGnumeric } from "./gnumeric.js";
import { writePdf } from "./pdf.js";
import type { CapabilityContext } from "../contracts.js";

function context(): CapabilityContext {
  return { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 10, operations: 100 } };
}
async function fixture(settings: string, ctx: CapabilityContext, cells = '<g:Cell Row="0" Col="0" ValueType="60">body</g:Cell>') {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" xmlns:f="urn:foreign"><g:Sheets><g:Sheet><g:Name>Independent print</g:Name><g:PrintInformation>${settings}</g:PrintInformation><g:Cells>${cells}</g:Cells></g:Sheet></g:Sheets></g:Workbook>`), ctx);
}
function stream(pdf: PDFDocument): string {
  return (pdf.getPage(0).node.Contents() as PDFArray).asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
}

it("ignores foreign element and attribute namespaces when projecting settings", async () => {
  const ctx = context();
  const pdf = await PDFDocument.load(await writePdf(await fixture('<f:paper>na_letter</f:paper><f:orientation>landscape</f:orientation><g:Scale type="percentage" f:percentage="50"/>', ctx), [], ctx));
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(210 * 72 / 25.4);
  expect(pdf.getPage(0).getHeight()).toBeCloseTo(297 * 72 / 25.4);
  expect(stream(pdf)).toContain("1 0 0 1 0 0 cm");
});

it("scales only the worksheet body around its top-left origin", async () => {
  const ctx = context();
  const pdf = await PDFDocument.load(await writePdf(await fixture('<g:paper>na_letter</g:paper><g:Scale type="percentage" percentage="50"/>', ctx), [], ctx));
  const content = stream(pdf), ctm = content.indexOf("0.5 0 0 0.5 36 336 cm");
  expect(ctm).toBeGreaterThan(0);
  expect([...content.slice(0, ctm).matchAll(/<[0-9A-F]+> Tj/g)]).toHaveLength(2); // nonempty header + footer
  expect([...content.slice(ctm).matchAll(/<[0-9A-F]+> Tj/g)]).toHaveLength(1); // body
});

it("lets an explicit qualified paper override unqualified retained paper", async () => {
  const ctx = context(), book = await fixture('<g:paper>unqualified</g:paper>', ctx);
  const pdf = await PDFDocument.load(await writePdf(book, ["paper=A4"], ctx));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(210 * 72 / 25.4);
  await expect(writePdf(book, [], ctx)).rejects.toMatchObject({ code: "unsupported-feature", exitCode: 1 });
});

it("fits a wide tall sheet into one page with an isotropic body transform", async () => {
  const ctx = context();
  const cells = '<g:Cell Row="0" Col="0" ValueType="60">origin</g:Cell><g:Cell Row="100" Col="20" ValueType="60">end</g:Cell>';
  const pdf = await PDFDocument.load(await writePdf(await fixture('<g:Scale type="fit" cols="1" rows="1"/>', ctx, cells), [], ctx));
  expect(pdf.getPageCount()).toBe(1);
  const matrices = [...stream(pdf).matchAll(/([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm/g)];
  const scaled = matrices.find(matrix => Number(matrix[1]) < 1)!;
  expect(scaled).toBeDefined();
  expect(Number(scaled[1])).toBe(Number(scaled[2]));
  expect(Number(scaled[1])).toBeGreaterThan(0);
});

it("aligns all header fields inside asymmetric margins", async () => {
  const ctx = context(), draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await writePdf(await fixture('<g:paper>na_letter</g:paper><g:Margins><g:left Points="100"/><g:right Points="50"/></g:Margins><g:Header Left="LL" Middle="MM" Right="RR"/>', ctx), [], ctx);
    const calls = new Map(draw.mock.calls.map(([value, options]) => [value, options!]));
    expect(calls.get("LL")!.x).toBe(100);
    // Identical glyph count/monospace width lets alignment be checked without font internals.
    expect(calls.get("MM")!.x! - 331).toBeCloseTo((calls.get("RR")!.x! - 562) / 2);
    expect(calls.get("RR")!.x).toBeLessThan(562);
  } finally { draw.mockRestore(); }
});

it("suppresses header and footer whose margins leave no room", async () => {
  const ctx = context(), draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await writePdf(await fixture('<g:Margins><g:top Points="72"/><g:bottom Points="72"/></g:Margins><g:Header Middle="hidden header"/><g:Footer Middle="hidden footer"/>', ctx), [], ctx);
    expect(draw.mock.calls.map(([value]) => value)).toEqual(["body"]);
  } finally { draw.mockRestore(); }
});

it.each(["hcenter", "vcenter"])("keeps %s value 2 disabled as the upstream painter does", async name => {
  const ctx = context();
  const one = await writePdf(await fixture(`<g:${name} value="0"/>`, ctx), [], ctx);
  const two = await writePdf(await fixture(`<g:${name} value="2"/>`, ctx), [], ctx);
  expect(stream(await PDFDocument.load(two))).toEqual(stream(await PDFDocument.load(one)));
});

it.each([["d_then_r", ["A", "C", "B", "D"]], ["r_then_d", ["A", "B", "C", "D"]]] as const)("retains explicit Cartesian print order %s", async (order, expected) => {
  const ctx = context(), draw = vi.spyOn(PDFPage.prototype, "drawText");
  const cells = [[0, 0, "A"], [0, 10, "B"], [50, 0, "C"], [50, 10, "D"]].map(([row, column, value]) => `<g:Cell Row="${row}" Col="${column}" ValueType="60">${value}</g:Cell>`).join("");
  try {
    const pdf = await PDFDocument.load(await writePdf(await fixture(`<g:order>${order}</g:order>`, ctx, cells), [], ctx));
    expect(pdf.getPageCount()).toBe(4);
    expect(draw.mock.calls.map(([value]) => value).filter(value => ["A", "B", "C", "D"].includes(value))).toEqual(expected);
  } finally { draw.mockRestore(); }
});

it("lets explicit sheet selection override do_not_print while implicit export excludes it", async () => {
  const ctx = context(), book = await fixture('<g:do_not_print value="1"/>', ctx);
  const pdf = await PDFDocument.load(await writePdf(book, ["sheet='Independent print'"], ctx));
  expect(pdf.getPageCount()).toBe(1);
  expect((await PDFDocument.load(await writePdf(book, [], ctx))).getPageCount()).toBe(0);
  expect((await PDFDocument.load(await writePdf(book, [], ctx, { sheets: [book.sheets[0]!.id] }))).getPageCount()).toBe(1);
});

it("keeps hidden sheets excluded even when explicitly selected", async () => {
  const ctx = context(), original = await fixture("", ctx);
  const book = { ...original, sheets: original.sheets.map(sheet => ({ ...sheet, visibility: "hidden" as const })) };
  expect((await PDFDocument.load(await writePdf(book, ["sheet='Independent print'"], ctx))).getPageCount()).toBe(0);
  expect((await PDFDocument.load(await writePdf(book, [], ctx, { sheets: [book.sheets[0]!.id] }))).getPageCount()).toBe(0);
});

it("preserves an explicitly empty SDK sheet selection", async () => {
  const ctx = context();
  const pdf = await PDFDocument.load(await writePdf(await fixture("", ctx), [], ctx, { sheets: [] }));
  expect(pdf.getPageCount()).toBe(0);
});

it("uses the full workbook page total in each sheet header", async () => {
  const ctx = context(), original = await fixture('<g:Header Middle="&amp;[PAGES]"/>', ctx);
  const book = { ...original, sheets: [original.sheets[0]!, { ...original.sheets[0]!, id: "second", name: "Second" }] };
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await writePdf(book, [], ctx);
    expect(draw.mock.calls.map(([value]) => value).filter(value => value === "2")).toHaveLength(2);
  } finally { draw.mockRestore(); }
});

it("rejects a later sheet's excessive precomputation before any page painting", async () => {
  const ctx = context(), original = await fixture("", ctx);
  const book = { ...original, sheets: [original.sheets[0]!, { id: "large", name: "Large", cells: [{ row: 1000000, column: 0, value: { kind: "blank" as const } }] }] };
  const draw = vi.spyOn(PDFPage.prototype, "drawText"), format = vi.fn(async () => "unused");
  try {
    await expect(writePdf(book, [], { ...ctx, formatting: { format }, limits: { ...ctx.limits, workbookWork: 1000 } })).rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
    expect(draw).not.toHaveBeenCalled();
    expect(format).not.toHaveBeenCalled();
  } finally { draw.mockRestore(); }
});

it("preserves pre-aborted reason identity before planning or painting", async () => {
  const ctx = context(), book = await fixture("", ctx);
  const controller = new AbortController(), reason = { kind: "original caller reason" };
  controller.abort(reason);
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await expect(writePdf(book, [], { ...ctx, signal: controller.signal })).rejects.toBe(reason);
    expect(draw).not.toHaveBeenCalled();
  } finally { draw.mockRestore(); }
});

it.each(["titles", "grid", "draft", "monochrome"])("refuses enabled %s without a supported painter", async name => {
  const ctx = context();
  await expect(writePdf(await fixture(`<g:${name} value="1"/>`, ctx), [], ctx)).rejects.toMatchObject({ code: "unsupported-feature", exitCode: 1 });
});
