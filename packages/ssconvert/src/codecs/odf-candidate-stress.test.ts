import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { createOdfXml, odfNamespaces } from "./odf-write-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 1000 } };
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
async function fixture(styles: string, cells: string) {
  const content = `<office:document-content ${Object.entries(odfNamespaces).map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`).join(" ")} office:version="1.2"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:spreadsheet><table:table table:name="S"><table:table-row>${cells}</table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`;
  const zip = createZipCodec(), entries = [];
  for (const [name, source] of [["mimetype", "application/vnd.oasis.opendocument.spreadsheet"], ["content.xml", content]])
    entries.push(await zip.makeZipEntry(name!, new TextEncoder().encode(source), { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
async function content(bytes: Uint8Array) {
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "content.xml")!;
  const chunks: Uint8Array[] = [];
  for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) chunks.push(Uint8Array.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

it.each(["strict", "extended"] as const)("preserves original cell style whose name collides with a generated table style (%s)", async profile => {
  const original = await readOdf(await fixture('<style:style style:name="ta0" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style>', '<table:table-cell table:style-name="ta0" office:value-type="float" office:value="1"/>'), context);
  expect(JSON.stringify(original.sheets[0]!.cells[0]!.style)).toContain("bold");
  const round = await readOdf(await createOdfWriter(profile)(original, [], context), context);
  expect(JSON.stringify(round.sheets[0]!.cells[0]!.style)).toContain("bold");
});

it.each([false, true])("preserves XML namespace attributes on retained standard ODF metadata (extended=%s)", extended => {
  const source = { name: "p", namespace: odfNamespaces.text!, attributes: [
    { name: "id", namespace: "http://www.w3.org/XML/1998/namespace", value: "paragraph-original" }
  ], text: "tekst" };
  expect(createOdfXml(context, extended).retained(source)).toBe('<text:p xml:id="paragraph-original">tekst</text:p>');
});

it.each(["strict", "extended"] as const)("does not silently discard a merge whose anchor lies inside another merge (%s)", async profile => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [], merges: [
    { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
    { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 }
  ] }] };
  const outcome = await createOdfWriter(profile)(book, [], context).then(() => "exported", error => (error as { code: string }).code);
  expect(outcome).toBe("invalid-request");
});

it("rejects a pre-aborted writer without mutating the original input", async () => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [{ row: 0, column: 0, value: { kind: "string", value: "original" } }] }] };
  const before = JSON.stringify(book), controller = new AbortController(), reason = { cancel: "negative-control" };
  controller.abort(reason);
  await expect(createOdfWriter("extended")(book, [], { ...context, signal: controller.signal })).rejects.toBe(reason);
  expect(JSON.stringify(book)).toBe(before);
});

it("charges cells created for comment-only addresses against the cell budget", async () => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [], unsupportedRecords: [{
    source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", children: [
      { name: "CellComment", attributes: { ObjectBound: "A1", Text: "first" } },
      { name: "CellComment", attributes: { ObjectBound: "B2", Text: "second" } }
    ] }
  }] }] };
  const bounded = { ...context, limits: { ...context.limits, cells: 1 } };
  const outcome = await createOdfWriter("extended")(book, [], bounded).then(() => "exported", error => (error as { code: string }).code);
  expect(outcome).toBe("resource-limit");
});

it.each(["strict", "extended"] as const)("keeps neighboring disjoint merges separate (%s)", async profile => {
  const merges = [
    { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
    { startRow: 0, endRow: 1, startColumn: 2, endColumn: 3 },
    { startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 }
  ];
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [], merges }] };
  const round = await readOdf(await createOdfWriter(profile)(book, [], context), context);
  expect(round.sheets[0]!.merges).toEqual(merges);
});

it.each(["strict", "extended"] as const)("retains original XML namespace identity through package read/write (%s)", async profile => {
  const original = await readOdf(await fixture("", '<table:table-cell office:value-type="string"><text:p xml:id="original-paragraph"><text:a xlink:href="https://example.invalid">tekst</text:a></text:p></table:table-cell>'), context);
  expect(JSON.stringify(original)).toContain("original-paragraph");
  const bytes = await createOdfWriter(profile)(original, [], context);
  expect(await content(bytes)).toContain('xml:id="original-paragraph"');
  expect(JSON.stringify(await readOdf(bytes, context))).toContain("original-paragraph");
});

it.each(["strict", "extended"] as const)("admits exact comment-cell budget and counts duplicate comments once (%s)", async profile => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [{ row: 0, column: 0, value: { kind: "number", value: 7 } }], unsupportedRecords: [{
    source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", children: [
      { name: "CellComment", attributes: { ObjectBound: "A1", Text: "first" } },
      { name: "CellComment", attributes: { ObjectBound: "B2", Text: "second" } },
      { name: "CellComment", attributes: { ObjectBound: "B2", Text: "last" } }
    ] }
  }] }] };
  const bounded = { ...context, limits: { ...context.limits, cells: 2 } };
  const bytes = await createOdfWriter(profile)(book, [], bounded), xml = await content(bytes);
  expect(xml.split("<office:annotation")).toHaveLength(3);
  expect(xml).toContain("last");
  const round = await readOdf(bytes, context);
  expect(round.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});
