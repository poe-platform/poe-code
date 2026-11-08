import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
const cases = [
  ['"A_x0000__x0001__xFFFE__xD800_Z"', '="A\0\x01\ufffe\ud800Z"'],
  ['"_x005F_x0000_"', '="_x0000_"'],
  ['"_x005F_x005F_x005F_x0000_"', '="_x005F_x0000_"'],
  ['"é😀&amp;&lt;&#13;"', '="é😀&<\r"'],
  ['_x0022_text_x0022_', '="text"'],
] as const;

// ECMA-376 sml.xsd: CT_DefinedName extends ST_Formula, which restricts ST_Xstring.
// Read hand-authored XML as well as writer output so symmetric mistakes cannot pass.
it.each(cases)("decodes defined-name text before formula parsing: %s", async (wire, expression) => {
  const zip = createZipCodec();
  const parts = {
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="s"/></sheets><definedNames><definedName name="Global">${wire}</definedName><definedName name="Local" localSheetId="0">${wire}</definedName></definedNames></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetData/></worksheet>`
  };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, context.signal));
  const book = await readXlsx(await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal), context);
  expect(book.names).toMatchObject([{ name: "Global", expression }, { name: "Local", expression, sheet: book.sheets[0]!.id }]);
});

for (const edition of ["2006", "2008"] as const)
it.each(cases.slice(0, 4))(`encodes defined-name expressions in ${edition}: %s`, async (wire, expression) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [] }], names: [
    { name: "Global", expression }, { name: "Local", expression, sheet: "s" }
  ] };
  const before = structuredClone(book);
  const bytes = await createXlsxWriter(edition)(book, [], context);
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/workbook.xml")!;
  let xml = ""; const decoder = new TextDecoder();
  for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += decoder.decode(chunk, { stream: true });
  xml += decoder.decode();
  expect(xml).toContain(`>${wire.split('"').join("&quot;")}</definedName>`);
  const result = await readXlsx(bytes, context);
  expect(result.names?.filter(name => name.name === "Global" || name.name === "Local").map(name => name.expression)).toEqual([expression, expression]);
  expect(book).toEqual(before);
});

it.each(["2006", "2008"] as const)("preserves generated Sheet_Title escape tokens in %s", async edition => {
  const book: Workbook = { sheets: [{ id: "s", name: "_x0000_", cells: [] }] };
  const result = await readXlsx(await createXlsxWriter(edition)(book, [], context), context);
  expect(result.names?.find(name => name.name === "Sheet_Title")?.expression).toBe('="_x0000_"');
});
