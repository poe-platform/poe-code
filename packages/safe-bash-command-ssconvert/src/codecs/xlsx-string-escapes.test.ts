import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
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

for (const edition of ["2006", "2008"] as const)
for (const cache of ["value", "cachedResult"] as const)
it.each([0, 1, 2])(`keeps formula string caches out of shared strings (${edition}, ${cache}, %i plain cells)`, async plainCount => {
  const value = "A\0_x0000_😀\ud800";
  const stringValue = { kind: "string", value } as const;
  const formula = '="_x0000_"';
  const book: Workbook = { calculationMode: "manual", sheets: [{ id: "s", name: "S", cells: [
    ...Array.from({ length: plainCount }, (_, row) => ({ row, column: 0, value: stringValue })),
    ...Array.from({ length: 2 }, (_, index) => ({ row: plainCount + index, column: 0,
      formula, value: { kind: "blank" } as const, [cache]: stringValue }))
  ] }] };
  const before = structuredClone(book);
  const bytes = await createXlsxWriter(edition)(book, [], context);
  const zip = createZipCodec();
  const bounds = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, bounds, context.signal);
  const parts = new Map<string, ReturnType<typeof parseXml>>();
  for (const name of ["xl/worksheets/sheet1.xml", "xl/sharedStrings.xml"]) {
    const entry = archive.entries.find(entry => entry.name === name);
    if (!entry) continue;
    const decoder = new TextDecoder(); let text = "";
    for await (const chunk of zip.decodeZipEntry(entry, bounds, context.signal)) text += decoder.decode(chunk, { stream: true });
    parts.set(name, parseXml(text + decoder.decode()));
  }
  const sheetData = parts.get("xl/worksheets/sheet1.xml")!.children.find(node => node.localName === "sheetData")!;
  const cells = sheetData.children.flatMap(row => row.children.filter(node => node.localName === "c"));
  expect(cells.map(cell => cell.attributes.find(attribute => attribute.localName === "t")?.value)).toEqual([
    ...Array.from({ length: plainCount }, () => plainCount > 1 ? "s" : "inlineStr"), "str", "str"
  ]);
  for (const cell of cells.slice(plainCount)) {
    expect(cell.children.find(node => node.localName === "f")?.text).toBe(formula.slice(1));
    expect(cell.children.find(node => node.localName === "v")?.text).toBe("A_x0000__x005F_x0000_😀_xD800_");
  }
  const shared = parts.get("xl/sharedStrings.xml");
  if (plainCount > 1) {
    expect(shared!.children.filter(node => node.localName === "si").map(node => readXlsxString(node, context).value)).toEqual([value]);
    expect(cells.slice(0, plainCount).map(cell => cell.children.find(node => node.localName === "v")?.text)).toEqual(["0", "0"]);
  } else expect(shared).toBeUndefined();
  const reread = (await readXlsx(bytes, context)).sheets[0]!.cells;
  expect(reread.map(cell => cell.formula ? cell.cachedResult : cell.value)).toEqual(Array(plainCount + 2).fill(stringValue));
  expect(book).toEqual(before);
});
