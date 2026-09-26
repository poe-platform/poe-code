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

it("keeps generic XML escaping strict and does not interpret string escapes there", () => {
  expect(escapeXlsx("_x0000_")).toBe("_x0000_");
  expect(() => escapeXlsx("\0")).toThrow("non-XML XLSX character");
});
