import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import type { CapabilityContext } from "../../contracts.js";
import { renderPrintHeaderFooter } from "./header-footer.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 10, operations: 100, workbookWork: 10000 } };
const info = { page: 7, pages: 12, sheetName: "Résumé", filename: "book.gnumeric", path: "/virtual/", title: "Report" };

it("expands native case-insensitive opcodes, consumes unknowns and truncates unterminated opcodes", () => {
  expect(renderPrintHeaderFooter("&[TAB] &[page]/&[PAGES] &[FILE] &[PATH]&[TITLE] &[unknown] && &[broken", info, context))
    .toBe("Résumé 7/12 book.gnumeric /virtual/Report  && ");
});
it("passes timestamp formats and cell references to explicit render metadata", () => {
  const calls: string[] = [];
  expect(renderPrintHeaderFooter("&[DATE]|&[TIME:ss]|&[CELL:rep|$A1]", { ...info,
    timestamp: { serial: 45000.5, dateSystem: "1900" as const,
      format(serial, pattern, dateSystem) { calls.push(`${serial}:${pattern}:${dateSystem}`); return pattern; } },
    cell(reference, repeating) { calls.push(`${reference}:${repeating}`); return "value"; }
  }, context)).toBe("dd-mmm-yyyy|ss|value");
  expect(calls).toEqual(["45000.5:dd-mmm-yyyy:1900", "45000.5:ss:1900", "$A1:true"]);
});
it("does not silently invent date or cell metadata", () => {
  expect(() => renderPrintHeaderFooter("&[DATE]", info, context)).toThrow("timestamp");
  expect(() => renderPrintHeaderFooter("&[CELL:A1]", info, context)).toThrow("cell");
});
it("bounds expanded UTF-8 output, including borrowed values", () => {
  expect(() => renderPrintHeaderFooter("&[TAB]", { ...info, sheetName: "éé" },
    { ...context, limits: { ...context.limits, outputBytes: 3 } })).toThrow("output limit");
});
it("preserves cancellation identity before validation", () => {
  const controller = new AbortController(); const reason = { cancelled: true }; controller.abort(reason);
  expect(() => renderPrintHeaderFooter("", info, { ...context, signal: controller.signal })).toThrow(reason);
});
it("matches native Unicode casefolded English opcodes without folding dotless I", () => {
  expect(renderPrintHeaderFooter("&[PAGEſ]|&[ﬁLE]|&[TıTLE]|&[TİTLE]", info, context))
    .toBe("12|book.gnumeric||");
});
it("preserves every explicit falsey cancellation reason before header admission", () => {
  for (const reason of [false, 0, "", null]) {
    const controller = new AbortController(); controller.abort(reason);
    let caught: unknown = "not thrown";
    try { renderPrintHeaderFooter("&[DATE]", info, { ...context, signal: controller.signal }); }
    catch (error) { caught = error; }
    expect(caught).toBe(reason);
  }
});
it("observes cancellation after callbacks before accepting their text", () => {
  const controller = new AbortController();
  let caught: unknown = "not thrown";
  try {
    renderPrintHeaderFooter("&[CELL:A1]", { ...info,
      cell() { controller.abort(false); return "unpublished"; }
    }, { ...context, signal: controller.signal });
  } catch (error) { caught = error; }
  expect(caught).toBe(false);
});
it("bounds unknown and unterminated opcode scans independently of output", () => {
  for (const format of ["&[" + "x".repeat(100) + "]", "&[" + "x".repeat(100)]) {
    expect(() => renderPrintHeaderFooter(format, info,
      { ...context, limits: { ...context.limits, workbookWork: 20, outputBytes: 0 } }))
      .toThrow("work limit");
  }
});
it("counts multibyte and malformed UTF-16 output at the UTF-8 boundary", () => {
  for (const text of ["😀", "é漢", "\ud800"]) {
    const bytes = new TextEncoder().encode(text).length;
    expect(renderPrintHeaderFooter("&[TAB]", { ...info, sheetName: text },
      { ...context, limits: { ...context.limits, outputBytes: bytes } })).toBe(text);
    expect(() => renderPrintHeaderFooter("&[TAB]", { ...info, sheetName: text },
      { ...context, limits: { ...context.limits, outputBytes: bytes - 1 } })).toThrow("output limit");
  }
});
it("keeps opcode arguments opaque and callback errors unchanged", () => {
  const references: string[] = [];
  expect(renderPrintHeaderFooter("&[CELL:REP|A1:B2]|&[CELL:rep|A1:B2]|&[DATE:]", { ...info,
    cell(reference, repeating) { references.push(`${reference}:${repeating}`); return ""; },
    timestamp: { serial: 1, dateSystem: "1904", format(_serial, pattern) { return pattern; } }
  }, context)).toBe("||");
  expect(references).toEqual(["REP|A1:B2:false", "A1:B2:true"]);
  const reason = new Error("host callback failure");
  expect(() => renderPrintHeaderFooter("&[CELL:A1]", { ...info, cell() { throw reason; } }, context))
    .toThrow(reason);
});
it("does not classify or replace cross-realm callback failures", () => {
  const reason: unknown = runInNewContext("new Error('foreign callback')");
  let caught: unknown = "not thrown";
  try { renderPrintHeaderFooter("&[CELL:A1]", { ...info, cell() { throw reason; } }, context); }
  catch (error) { caught = error; }
  expect(caught).toBe(reason);
});
it("rejects invalid page and output budget metadata without executing callbacks", () => {
  let calls = 0;
  const metadata = { ...info, cell() { calls++; return "value"; } };
  for (const page of [-1, Infinity, 1.5]) {
    expect(() => renderPrintHeaderFooter("&[CELL:A1]", { ...metadata, page }, context))
      .toThrow("Invalid ssconvert print header metadata");
  }
  for (const outputBytes of [-1, NaN, 1.5]) {
    expect(() => renderPrintHeaderFooter("&[CELL:A1]", metadata,
      { ...context, limits: { ...context.limits, outputBytes } }))
      .toThrow("Invalid ssconvert print header metadata");
  }
  expect(calls).toBe(0);
});
it("matches the original one-page pinned native PDF header capture", () => {
  // Original fixture, Gnumeric 1.12.61 / C / UTC; PDFKit text capture is
  // evidence for expanded text only, not native glyph or page-paint fidelity.
  expect(renderPrintHeaderFooter(
    "Tab=&[tAb] Page=&[pAgE]/&[PAGES] Fold=&[PAGEſ] File=&[ﬁLE] Unknown=&[NOPE] Literal=&& End=&[BROKEN",
    { ...info, page: 1, pages: 1, sheetName: "SheetOne", filename: "fixture.gnumeric" }, context))
    .toBe("Tab=SheetOne Page=1/1 Fold=1 File=fixture.gnumeric Unknown= Literal=&& End=");
});
it("observes native C-string termination in formats and expanded text", () => {
  expect(renderPrintHeaderFooter("before\0&[CELL:A1]", info, context)).toBe("before");
  expect(renderPrintHeaderFooter("before&[PAGE\0]after", info, context)).toBe("before");
  expect(renderPrintHeaderFooter("&[TAB] after", { ...info, sheetName: "Sheet\0discard" }, context)).toBe("Sheet after");
});
it("never dispatches an opcode whose closing bracket follows a NUL", () => {
  let calls = 0;
  expect(renderPrintHeaderFooter("left&[CELL:A1\0]right", { ...info,
    cell() { calls++; return "unreachable"; }
  }, context)).toBe("left");
  expect(calls).toBe(0);
});
it("ignores terminated suffixes without charging their output or scan work", () => {
  const bounded = { ...context, limits: { ...context.limits, outputBytes: 0, workbookWork: 10 } };
  expect(renderPrintHeaderFooter("\0" + "x".repeat(1000), info, bounded)).toBe("");
  expect(renderPrintHeaderFooter("&[TAB]", { ...info, sheetName: "\0" + "x".repeat(1000) }, bounded))
    .toBe("");
});
it("terminates each expanded callback string without terminating the format", () => {
  expect(renderPrintHeaderFooter("&[DATE]|&[CELL:A1]|&[PAGE]", { ...info,
    timestamp: { serial: 1, dateSystem: "1900", format() { return "date\0ignored"; } },
    cell() { return "cell\0ignored"; }
  }, context)).toBe("date|cell|7");
});
