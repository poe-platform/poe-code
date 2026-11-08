import { parseCommand } from "../cli/parser.js";
import { expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { createRegistry } from "./registry.js";
import { readGnumeric } from "./gnumeric.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 1000000, cells: 10000, sheets: 10, operations: 100 } };
const object = (width: number) => `<g:SheetObjectGraph Name="same" AnchorMode="2" ObjectBound="A1:A1" ObjectOffset="0 0 ${width} 35"><GogObject type="GogGraph"/></g:SheetObjectGraph>`;
async function book() { return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects>${object(71)}${object(123)}</g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), context); }
it("installs the PDF writer and retains first native list object with repeated names/options", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_pdf:pdf_assistant");
  expect(codec?.write).toBeTypeOf("function");
  const bytes = await codec!.write!(await book(), ["object=same object=same paper=fit"], context);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 123, height: 35 });
});
it("rejects missing objects and explicitly reports unimplemented paper fallback", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_pdf:pdf_assistant");
  expect(codec?.write).toBeTypeOf("function");
  await expect(codec!.write!(await book(), ["object=missing"], context)).rejects.toThrow("There is no object with name 'missing'");
  await expect(codec!.write!(await book(), ["paper=garbage"], context)).rejects.toThrow("Unsupported ssconvert feature: PDF");
});

it("matches the measured native 72-point object-page origin", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_pdf:pdf_assistant")!;
  const original = object(123).replace('<GogObject type="GogGraph"/>', '<GogObject type="GogGraph"><property name="style" type="GogStyle"><line dash="none" auto-dash="0"/><fill type="pattern" auto-type="0" is-auto="0"><pattern type="solid" auto-pattern="0" back="ff:00:00:ff"/></fill></property></GogObject>');
  const painted = await readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects>${original}</g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), context);
  const draw = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const bytes = await codec.write!(painted, ["object=same"], context);
    const pdf = await PDFDocument.load(bytes);
    expect(draw).toHaveBeenCalledWith(expect.objectContaining({ x: 72, y: pdf.getPage(0).getHeight() - 72 - 35, width: 123, height: 35 }));
  } finally { draw.mockRestore(); }
});
it("continues native footer page numbers across workbook sheets", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_pdf:pdf_assistant")!;
  const input = { sheets: ["One", "Two"].map(id => ({ id, name: id, cells: Array.from({ length: 90 }, (_, row) => ({ row, column: 0, value: { kind: "string" as const, value: `${id} row ${row}` } })) })) };
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await codec.write!(input, [], context);
    expect(draw.mock.calls.map(([value]) => value).filter(value => value.startsWith("Page "))).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
  } finally { draw.mockRestore(); }
});

it("applies orientation=landscape and fit-width=1 export options on Gnumeric_pdf:pdf_assistant", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_pdf:pdf_assistant")!;
  const input = { sheets: [{ id: "One", name: "One", cells: [{ row: 0, column: 0, value: { kind: "string" as const, value: "Region" } }] }] };
  const bytes = await codec.write!(input, ["paper=A4 orientation=landscape fit-width=1"], context);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  const size = pdf.getPage(0).getSize();
  expect(size.width).toBeGreaterThan(size.height);
});

test("ssconvert -O help lists supported PDF and STF export options", () => {
  const withoutFiles = parseCommand(["-T", "Gnumeric_pdf:pdf_assistant", "-O", "help"]);
  expect(withoutFiles.kind).toBe("terminal");
  if (withoutFiles.kind === "terminal") {
    expect(withoutFiles.exitCode).toBe(0);
    expect(withoutFiles.stdout).toContain("orientation=portrait|landscape");
    expect(withoutFiles.stdout).toContain("fit-width=<pages>");
  }
  const withFiles = parseCommand(["-T", "Gnumeric_pdf:pdf_assistant", "-O", "help", "sales.csv", "sales.pdf"]);
  expect(withFiles.kind).toBe("terminal");
  if (withFiles.kind === "terminal") {
    expect(withFiles.exitCode).toBe(0);
    expect(withFiles.stdout).toContain("paper=A4|letter|legal|fit");
  }
});
