import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import { parseXml } from "@poe-code/safe-fs/xml";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { readXlsxComments } from "./xlsx-metadata.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
const book = (print: string): Workbook => ({ sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [
  { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", attributes: {}, children: [
    { name: "CellComment", attributes: { ObjectBound: "B2", Author: "Ada", Text: "note", Print: print }, children: [] }
  ] } }
] }] });
async function vml(bytes: Uint8Array): Promise<string> {
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name.endsWith('.vml'))!;
  const chunks = []; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
for (const edition of ["2006", "2008"] as const) {
  it(`keeps non-printing notes non-printing through export and readback (${edition})`, async () => {
    const bytes = await createXlsxWriter(edition)(book("0"), [], context);
    expect(await vml(bytes)).toContain('<x:PrintObject>False</x:PrintObject>');
    const read = await readXlsx(bytes, context);
    expect(metadataNode(read.sheets[0]!.unsupportedRecords!.find(r => r.kind === "Objects")!.data)?.children[0]?.attributes.Print).toBe("0");
  });
  it(`exports an edited printable flag instead of stale source metadata (${edition})`, async () => {
    const read = await readXlsx(await createXlsxWriter(edition)(book("0"), [], context), context);
    const objects = read.sheets[0]!.unsupportedRecords!.find(r => r.kind === "Objects")!;
    const node = metadataNode(objects.data)!;
    const edited: Workbook = { sheets: [{ ...read.sheets[0]!, unsupportedRecords: read.sheets[0]!.unsupportedRecords!.map(r => r === objects
      ? { ...r, data: { name: "Objects", attributes: {}, children: [{ name: "CellComment", attributes: { ...node.children[0]!.attributes, Print: "1" }, children: [] }] } } : r) }] };
    const output = await vml(await createXlsxWriter(edition)(edited, [], context));
    const root = parseXml(output), shape = root.children.find(n => n.localName === "shape")!;
    const data = shape.children.find(n => n.localName === "ClientData")!;
    expect(data.children.filter(n => n.localName === "PrintObject").map(n => n.text)).toEqual(["True"]);
  });
}

it.each([["False", "0"], ["false", "0"], ["f", "0"], ["0", "0"], ["True", "1"], ["", "1"]])("reads independent VML PrintObject %s", (wire, expected) => {
  const drawing = parseXml(`<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape><x:ClientData ObjectType="Note"><x:Row>1</x:Row><x:Column>1</x:Column><x:PrintObject>${wire}</x:PrintObject></x:ClientData></v:shape></xml>`);
  for (const ref of ["B2", "b2", "$B$2"]) {
    const comments = parseXml(`<comments><authors><author>Ada</author></authors><commentList><comment ref="${ref}" authorId="0"><text><t>note</t></text></comment></commentList></comments>`);
    expect(metadataNode(readXlsxComments(comments, context, [drawing]).data)?.children[0]?.attributes.Print).toBe(expected);
  }
});

it("ignores foreign namespace flags and ambiguous note identities", () => {
  const comments = parseXml('<comments><authors><author>Ada</author></authors><commentList><comment ref="B2" authorId="0"><text><t>note</t></text></comment></commentList></comments>');
  const shape = '<v:shape><x:ClientData ObjectType="Note"><x:Row>1</x:Row><x:Column>1</x:Column><x:PrintObject>False</x:PrintObject></x:ClientData></v:shape>';
  for (const body of [shape + shape, shape.replace('x:PrintObject', 'foreign:PrintObject').replace('/x:PrintObject', '/foreign:PrintObject'), shape.replace('ObjectType="Note"', 'ObjectType="Button"')]) {
    const drawing = parseXml(`<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:foreign="urn:foreign">${body}</xml>`);
    expect(metadataNode(readXlsxComments(comments, context, [drawing]).data)?.children[0]?.attributes.Print).toBe("1");
  }
});
