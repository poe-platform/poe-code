import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { parseXml } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { readXlsxMetadata } from "./xlsx-metadata.js";
import { metadataNode } from "./xlsx-write-support.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 1000 } };
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

// LibreOffice bce0998a commentsfragment.cxx delegates text to RichStringContext;
// richstring.cxx decodes each portion separately. Author uses ST_Xstring in OOXML.
it.each([
  ['<t>_x0042__x005F_x0000_</t>', "B_x0000_"],
  ['<r><t>_x0042_</t></r><r><t>_x005F_x0000_</t></r>', "B_x0000_"],
  ['<r><t>_x00</t></r><r><t>41_</t></r>', "_x0041_"],
  ['<t>_x0000__xD800__xFFFE_</t>', "\0\ud800\ufffe"],
  ['<t xml:space="preserve"> note &amp; text </t>', " note & text "],
])("imports comment string portions without trimming or rescanning: %s", (text, value) => {
  const records = readXlsxMetadata(parseXml(`<worksheet xmlns="${namespace}"/>`), parseXml(
    `<comments xmlns="${namespace}"><authors><author> Author _x0041_ </author></authors><commentList><comment ref="A1" authorId="0"><text>${text}</text></comment></commentList></comments>`));
  expect(metadataNode(records[0]!.data)).toMatchObject({ children: [{ attributes: { Author: " Author A ", Text: value } }] });
});

it("preserves an explicitly empty comment author", () => {
  const records = readXlsxMetadata(parseXml(`<worksheet xmlns="${namespace}"/>`), parseXml(
    `<comments xmlns="${namespace}"><authors><author/></authors><commentList><comment ref="A1" authorId="0"><text><t/></text></comment></commentList></comments>`));
  expect(metadataNode(records[0]!.data)).toMatchObject({ children: [{ attributes: { Author: "", Text: "" } }] });
});

for (const edition of ["2006", "2008"] as const) {
  it.each([
    [" _x0041_ ", " _x005F_x0041_ "],
    ["\0\u0001\ud800\ufffe", "_x0000__x0001__xD800__xFFFE_"],
    [" plain & <text> \r\n\t", " plain & <text> \r\n\t"],
    ["", ""],
  ])(`exports and reimports comment author/text strings (${edition}): %j`, async (value, wire) => {
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [{
      source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
        name: "Objects", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: {}, children: [{
          name: "CellComment", namespace: "http://www.gnumeric.org/v10.dtd", text: "", children: [],
          attributes: { ObjectBound: "A1", Author: value, Text: value }
        }]
      }
    }] }] };
    const before = structuredClone(book);
    const bytes = await createXlsxWriter(edition)(book, [], context);
    const zip = createZipCodec();
    const limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
      maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
    const archive = await zip.readZipArchive(bytes, limits, context.signal);
    const entry = archive.entries.find(entry => entry.name === "xl/comments1.xml")!;
    let source = "";
    const decoder = new TextDecoder();
    for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) source += decoder.decode(chunk, { stream: true });
    const xml = parseXml(source + decoder.decode());
    const author = xml.children.find(node => node.localName === "authors")!.children[0]!;
    const text = xml.children.find(node => node.localName === "commentList")!.children[0]!.children[0]!.children[0]!;
    expect(author.text).toBe(wire);
    expect(text.text).toBe(wire);
    if (value.trim() !== value) expect(source).toContain('xml:space="preserve"');
    const read = await readXlsx(bytes, context);
    const objects = read.sheets[0]!.unsupportedRecords!.find(record => record.kind === "Objects")!;
    expect(metadataNode(objects.data)).toMatchObject({ children: [{ attributes: { Author: value, Text: value } }] });
    expect(book).toEqual(before);
  });
}
