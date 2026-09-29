import { expect, it } from "vitest";
import { parseXml } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { readXlsxString } from "./xlsx-styles.js";
import { createXlsxXml, escapeXlsx, writeRichString } from "./xlsx-write-support.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 1000 } };
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

// LibreOffice bce0998a: AttributeConversion::decodeXString and
// RichStringPortion::setText decode each <t> once, before assigning run offsets.
it.each([
  ["A_x0000_Z", "A\0Z"],
  ["_x0001__x001f__x0085_", "\x01\x1f\x85"],
  ["_xFFFE__xffff_", "\ufffe\uffff"],
  ["_xD83D__xDE00_", "😀"],
  ["_x005F_x0000_", "_x0000_"],
  ["_x005F__x0000_", "_\0"],
  ["_x0000_x0041_", "\0x0041_"],
  ["_X0000_ _x000g_ _x001_", "_X0000_ _x000g_ _x001_"],
])("decodes a rich string escape once: %s", (wire, value) => {
  const node = parseXml(`<si xmlns="${namespace}"><t>${wire}</t></si>`);
  expect(readXlsxString(node, context).value).toBe(value);
});

it("computes UTF-8 run offsets after escape decoding and keeps text nodes separate", () => {
  const node = parseXml(`<si xmlns="${namespace}"><t>é</t><r><rPr><b/></rPr><t>_x0000__xD83D__xDE00_</t></r><r><t>_x00</t></r><r><t>41_</t></r></si>`);
  expect(readXlsxString(node, context)).toEqual({ value: "é\0😀_x0041_",
    richText: [{ start: 2, end: 7, attributes: { bold: 1 } }] });
});

// Calc stylesbuffer.cxx:801-809 keeps doubleAccounting distinct from
// singleAccounting when converting the shared cell/comment font model.
for (const target of ["cell", "comment"] as const)
it.each([
  ["singleAccounting", "low"], ["doubleAccounting", "doubleAccounting"],
  ["single", "single"], ["double", "double"], ["none", "none"]
])(`retains rich ${target} underline line count through import and export: %s`, (wire, underline) => {
  const input = `<si xmlns="${namespace}"><r><rPr><u val="${wire}"/></rPr><t>é😀</t></r></si>`;
  const read = readXlsxString(parseXml(input), context);
  expect(read).toEqual({ value: "é😀", richText: [{ start: 0, end: 6, attributes: { underline } }] });
  const output = writeRichString(read.value, read.richText, createXlsxXml(context).element, undefined, target);
  expect(output).toContain(`<u val="${wire}"/>`);
  expect(readXlsxString(parseXml(`<si xmlns="${namespace}">${output}</si>`), context)).toEqual(read);
});

// RichStringPortion::setText preserves decoded UTF-16 units. A run boundary
// must not act as a UTF-8 stream boundary or replace an isolated surrogate.
for (const target of ["cell", "comment"] as const)
it.each(["\ufeff", "\ud800", "\udfff", "😀", "é", "\0"])(`preserves rich ${target} text at UTF-8 span boundaries: %j`, character => {
  const value = "a" + character + "z", end = 1 + new TextEncoder().encode(character).length;
  const runs = [{ start: 1, end, attributes: { bold: 1 } }];
  const output = writeRichString(value, runs, createXlsxXml(context).element, undefined, target);
  const read = readXlsxString(parseXml(`<si xmlns="${namespace}">${output}</si>`), context);
  expect(read).toEqual({ value, richText: runs });
});

it.each(["2006", "2008"] as const)("preserves shared and inline rich UTF-16 units in %s", async edition => {
  const values = ["\ufeff\ud800z", "\ufeff\ud800z", "\udfff😀"];
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: values.map((value, row) => ({ row, column: 0,
    value: { kind: "string", value }, richText: [{ start: 0, end: new TextEncoder().encode(value).length, attributes: { bold: 1 } }] })) }] };
  const result = await readXlsx(await createXlsxWriter(edition)(book, [], context), context);
  expect(result.sheets[0]!.cells.map(cell => ({ value: cell.value, richText: cell.richText }))).toEqual(
    book.sheets[0]!.cells.map(cell => ({ value: cell.value, richText: cell.richText })));
});

it.each([1, 2, 3, 5, -1, Infinity, 1.5])("rejects invalid rich UTF-8 boundaries instead of truncating text: %s", end => {
  expect(() => writeRichString("😀", [{ start: 0, end, attributes: { bold: 1 } }], createXlsxXml(context).element)).toThrow();
});

it.each([
  ["A\0Z", "A_x0000_Z"],
  ["\x01\x1f\ufffe\uffff", "_x0001__x001F__xFFFE__xFFFF_"],
  ["_x0000_", "_x005F_x0000_"],
  ["_x005F_x0000_", "_x005F_x005F_x005F_x0000_"],
  ["_x0000_x0041_", "_x005F_x0000_x005F_x0041_"],
  ["_x0020_", "_x005F_x0020_"],
  ["😀&<\r", "😀&amp;&lt;&#13;"],
])("writes cell string data with XML-safe escapes: %j", (value, wire) => {
  const xml = createXlsxXml(context).element;
  expect(writeRichString(value, undefined, xml)).toContain(`>${wire}</t>`);
});

it.each(["2006", "2008"] as const)("round-trips shared and inline escaped strings in %s", async edition => {
  const values = ["A\0Z", "A\0Z", "\x01\x1f\ufffe\uffff", "_x0000_", "_x005F_x0000_", "_x0000_x0041_", "😀\r\n\t"];
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: values.map((value, row) => ({ row, column: 0, value: { kind: "string", value } })) }] };
  const bytes = await createXlsxWriter(edition)(book, [], context);
  const result = await readXlsx(bytes, context);
  expect(result.sheets[0]!.cells.map(cell => cell.value)).toEqual(values.map(value => ({ kind: "string", value })));
});

it.each(["2006", "2008"] as const)("preserves shared and inline rich typeface names through export and reimport in %s", async edition => {
  const values = ["é😀", "é😀", "unique"];
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: values.map((value, row) => ({ row, column: 0,
    value: { kind: "string", value }, richText: [{ start: 0, end: new TextEncoder().encode(value).length,
      attributes: { family: "Noto _x0041_ & Serif", bold: 1 } }] })) }] };
  const before = structuredClone(book);
  const result = await readXlsx(await createXlsxWriter(edition)(book, [], context), context);
  expect(result.sheets[0]!.cells.map(cell => ({ value: cell.value, richText: cell.richText }))).toEqual(
    book.sheets[0]!.cells.map(cell => ({ value: cell.value, richText: cell.richText })));
  expect(book).toEqual(before);
});

it("keeps generic XML escaping strict and does not interpret string escapes there", () => {
  expect(escapeXlsx("_x0000_")).toBe("_x0000_");
  expect(() => escapeXlsx("\0")).toThrow("non-XML XLSX character");
});

it.each(["2006", "2008"] as const)("preserves unique formula string caches in %s", async edition => {
  const values = ["A\0Z", "\x01\x1f\ufffe\uffff", "_x0000_", "_x005F_x0000_", "_x0000_x0041_", "\ud800", "😀\r\n\t", ""];
  const book: Workbook = { calculationMode: "manual", sheets: [{ id: "s", name: "S", cells: values.map((value, row) => ({
    row, column: 0, formula: '="_x0000_"', value: { kind: "blank" }, cachedResult: { kind: "string", value }
  })) }] };
  const bytes = await createXlsxWriter(edition)(book, [], context);
  const cells = (await readXlsx(bytes, context)).sheets[0]!.cells;
  expect(cells.map(cell => cell.cachedResult)).toEqual(values.map(value => ({ kind: "string", value })));
  expect(cells.map(cell => cell.formula)).toEqual(values.map(() => '="_x0000_"'));
});
