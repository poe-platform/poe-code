import {expect, it, vi} from "vitest";
import {PDFDocument} from "pdf-lib";
import {suppliedDefaultFont} from "@poe-code/pdf";
import type {CapabilityContext, FontCapability} from "../contracts.js";
import {createEngine} from "../engine.js";
import {writePdf} from "./pdf.js";

const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 4, operations: 100}};
const book = {sheets: [{id: "s", name: "Sheet", cells: [{row: 0, column: 0, value: {kind: "string" as const, value: "cell"}}]}]};
const font = () => suppliedDefaultFont().bytes;
const withFonts = (resolve: (request: {family: string; bold: boolean; italic: boolean; maxBytes: number; signal: AbortSignal}) => Promise<Uint8Array | undefined>) => ({...context, fonts: {resolve}});
it("uses an explicit font authority once for default cells and headers", async () => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => font());
  const pdf = await PDFDocument.load(await writePdf(book, [], withFonts(resolve)));
  expect(pdf.getPageCount()).toBe(1);
  expect(resolve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({family: "Sans", bold: false, italic: false, maxBytes: 1000000, signal: context.signal}));
  expect(Object.isFrozen(resolve.mock.calls[0]![0])).toBe(true);
});
it("refuses unresolved supplied fonts without a substitution", async () => {
  await expect(writePdf(book, [], withFonts(async () => undefined))).rejects.toThrow("PDF supplied font unavailable");
});
it("admits supplied font bytes before copying or parsing", async () => {
  const ctx = {...withFonts(async () => font()), limits: {...context.limits, inputBytes: 12}};
  await expect(writePdf(book, [], ctx)).rejects.toThrow("ssconvert PDF font bytes limit exceeded");
});
it("refuses a malformed font without invoking embedFont", async () => {
  const embed = vi.spyOn(PDFDocument.prototype, "embedFont");
  try {
    await expect(writePdf(book, [], withFonts(async () => new Uint8Array(12)))).rejects.toThrow("PDF supplied font:");
    expect(embed).not.toHaveBeenCalled();
  } finally {embed.mockRestore();}
});
it("keeps borrowed host font bytes immutable", async () => {
  const bytes = font(), original = new Uint8Array(bytes);
  await writePdf(book, [], withFonts(async () => bytes));
  expect(bytes).toEqual(original);
});
it("checks falsey cancellation immediately after host font resolution", async () => {
  const controller = new AbortController(), ctx = {...withFonts(async () => {controller.abort(0); return font();}), signal: controller.signal};
  const embed = vi.spyOn(PDFDocument.prototype, "embedFont");
  try {
    await expect(writePdf(book, [], ctx)).rejects.toBe(0);
    expect(embed).not.toHaveBeenCalled();
  } finally {embed.mockRestore();}
});
it("snapshots the bound font port at engine creation and keeps refusal output empty", async () => {
  const fonts = {resolve: vi.fn(async () => undefined as Uint8Array | undefined)};
  const originalResolve = fonts.resolve;
  const engine = createEngine({environment: context.environment, limits: context.limits, codecs: [], fonts});
  fonts.resolve = vi.fn(async () => font());
  const write = vi.fn();
  await expect(engine.convert({input: {kind: "stream", source: [new TextEncoder().encode("cell\n")], filename: "input.csv"}, destination: {kind: "stream", sink: {write}}, exportType: "Gnumeric_pdf:pdf_assistant"}, {signal: context.signal})).rejects.toThrow("PDF supplied font unavailable");
  expect(write).not.toHaveBeenCalled();
  expect(fonts.resolve).not.toHaveBeenCalled();
  expect(originalResolve).toHaveBeenCalledOnce();
});
