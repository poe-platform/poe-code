import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import { parseXml, type XmlElement } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook, ImportedValue } from "@poe-code/spreadsheet-ast";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
const shape = `<v:shape style="position:absolute;margin-left:72pt;margin-top:24pt;width:144pt;height:60pt;z-index:3;visibility:visible"><x:ClientData ObjectType="Note"><x:Anchor>2, 12, 3, 6, 5, 8, 9, 10</x:Anchor><x:MoveWithCells/><x:Visible/><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape>`;
function metadata(node: XmlElement): ImportedValue {
  return { name: node.localName, namespace: node.namespace, text: node.text,
    attributes: Object.fromEntries(node.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => [a.name, a.value])), children: node.children.map(metadata) };
}
async function output(edition: "2006" | "2008", bound = "B2", shapes = shape, replay = false): Promise<string> {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", attributes: {}, children: [
      { name: "CellComment", attributes: { ObjectBound: bound, ObjectOffset: "1 0 1 0", Author: "Ada", Text: "edited note" }, children: [] }
    ] } },
    { source: "Gnumeric_Excel:xlsx", kind: "xml", disposition: "retained", data: metadata(parseXml(`<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">${shapes}</xml>`)) }
  ] }] };
  const zip = createZipCodec(); let bytes = await createXlsxWriter(edition)(book, [], context);
  if (replay) bytes = await createXlsxWriter(edition)(await readXlsx(bytes, context), [], context);
  const archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name.endsWith('.vml'))!;
  const chunks = []; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
for (const edition of ["2006", "2008"] as const) {
  it(`preserves a retained note rectangle and movement flags after text edits (${edition})`, async () => {
    const xml = await output(edition);
    expect(xml).toContain('width:144pt;height:60pt');
    expect(xml).toContain('margin-left:72pt;margin-top:24pt');
    expect(xml).toContain('visibility:visible');
    expect(xml).toContain('<x:Anchor>2, 12, 3, 6, 5, 8, 9, 10</x:Anchor>');
    expect(xml).toContain('<x:Visible/>');
    expect(xml).toContain('<x:MoveWithCells/>');
    expect(xml).not.toContain('<x:SizeWithCells/>');
  });
  it(`retains note geometry through actual XLSX import and re-export (${edition})`, async () => {
    const xml = await output(edition, "B2", shape, true);
    expect(xml).toContain('width:144pt;height:60pt');
    expect(xml).toContain('<x:Anchor>2, 12, 3, 6, 5, 8, 9, 10</x:Anchor>');
    expect(xml).toContain('<x:Visible/>');
    expect(xml).not.toContain('<x:SizeWithCells/>');
  });
  it(`does not attach a removed or ambiguous note rectangle to another comment (${edition})`, async () => {
    expect(await output(edition, 'C3')).not.toContain('width:144pt');
    expect(await output(edition, 'B2', shape + shape)).not.toContain('width:144pt');
  });
}

it("does not copy relationships, executable styling or malformed anchors from retained VML", async () => {
  const hostile = shape.replace('width:144pt', 'width:expression(alert(1))').replace('margin-left:72pt', 'margin-left:url(https://example.invalid/private)')
    .replace('<v:shape ', '<v:shape href="https://example.invalid/private" ');
  const xml = await output("2008", "B2", hostile);
  expect(xml).not.toContain('example.invalid'); expect(xml).not.toContain('expression(');
  expect(xml).toContain('width:0.00pt'); expect(xml).toContain('height:60pt');
  const malformed = await output("2008", "B2", shape.replace('2, 12, 3, 6, 5, 8, 9, 10', '2, bad, 3, 6, 5, 8, 9, 10'));
  expect(malformed).not.toContain('width:144pt');
});
