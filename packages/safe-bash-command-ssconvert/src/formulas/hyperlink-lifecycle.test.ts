import { expect, it } from "vitest";
import { readGnumeric } from "../codecs/gnumeric.js";
import { createOdfWriter, readOdf } from "../codecs/odf.js";
import { context, unpackOdf } from "../codecs/odf-write.test.js";
import { odfAttributes, odfChildren, odfObject, odfNamespaces } from "../codecs/odf-write-support.js";
import { renameWorkbookSheet, remapWorkbookSheets } from "./workbook.js";
import type { ImportedValue, Workbook } from "../workbook.js";

const input = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>
<g:Sheet><g:Name>Links</g:Name><g:Styles>
<g:StyleRegion startRow="0" endRow="0" startCol="0" endCol="0"><g:Style><g:HyperLink type="GnmHLinkCurWB" target="Data!A1"/></g:Style></g:StyleRegion>
<g:StyleRegion startRow="1" endRow="1" startCol="0" endCol="0"><g:Style><g:HyperLink type="GnmHLinkCurWB" target="data!Total"/></g:Style></g:StyleRegion>
</g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="60">cell link</g:Cell><g:Cell Row="1" Col="0" ValueType="60">name link</g:Cell></g:Cells></g:Sheet>
<g:Sheet><g:Name>Data</g:Name><g:Names><g:Name><g:name>Total</g:name><g:value>=$A$1</g:value></g:Name></g:Names>
<g:Cells><g:Cell Row="0" Col="0" ValueType="40">7</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;

for (const source of ["gnumeric", "odf"] as const) for (const operation of ["rename", "remap"] as const) {
  it(`${operation} rewrites ${source} cell and retained hyperlinks without changing input`, async () => {
    let book = await readGnumeric(new TextEncoder().encode(input), context);
    if (source === "odf") book = await readOdf(await createOdfWriter("strict")(book, [], context), context);
    const before = structuredClone(book), target = book.sheets[1]!.id;
    const renamed = operation === "rename" ? renameWorkbookSheet(book, target, "Archive #50%?", context)
      : remapWorkbookSheets(book, new Map([[target, { id: "new-data", name: "Archive #50%?" }]]), context);
    for (const profile of ["strict", "extended"] as const) for (const retained of [true, false]) {
      // ODF stores links in style regions; omit paragraphs to force regeneration.
      const current = retained ? renamed : { ...renamed, sheets: renamed.sheets.map(sheet => ({ ...sheet,
        unsupportedRecords: source === "gnumeric" ? [] : sheet.unsupportedRecords?.filter(record => record.kind !== "p") ?? [] })) };
      const xml = (await unpackOdf(await createOdfWriter(profile)(current, [], context))).parts.get("content.xml")!;
      expect(xml).toContain('xlink:href="#\'Archive%20%2350%25%3F\'.A1"');
      expect(xml).toContain('xlink:href="#Total%20(Archive%20%2350%25%3F)"');
      expect(xml).toContain("cell link");
      expect(xml).toContain("name link");
    }
    expect(renamed.sheets[1]!.id).toBe(operation === "rename" ? target : "new-data");
    expect(book).toEqual(before);
  });
}

it("remaps hyperlinks in detached sheets and keeps non-link metadata passive", async () => {
  const original = await readGnumeric(new TextEncoder().encode(input), context);
  const links = original.sheets[0]!, data = original.sheets[1]!;
  const book: Workbook = { ...original, activeSheet: data.id, sheets: [data], detachedSheets: [links] };
  const mapped = remapWorkbookSheets(book, new Map([[data.id, { id: "archive", name: "Archive" }]]), context);
  const targets = mapped.detachedSheets![0]!.cells.flatMap(cell => odfChildren(cell.style?.gnumeric)
    .filter(node => odfObject(node)?.name === "HyperLink").map(node => odfAttributes(node).target));
  expect(targets.join(" ")).toContain("Archive");
  expect(targets.join(" ").toLowerCase()).not.toContain("data!");
});

function metadataBook(node: ImportedValue, odf = false): Workbook {
  return { sheets: [{ id: "data", name: "Data", cells: [{ row: 0, column: 0, value: { kind: "string", value: "label" },
    ...(odf ? {} : { style: { gnumeric: { name: "Style", children: [node] } } }) }],
    ...(odf ? { unsupportedRecords: [{ source: "odf:cell-content", kind: "p", disposition: "retained", data: {
      name: "p", namespace: odfNamespaces.text!, children: [], content: [
        { kind: "text", text: "before " }, { kind: "element", value: node }, { kind: "text", text: " after" }
      ] } }] } : {}) }] };
}

it.each(["https://example.test/#Data!A1", "[other]Data!A1", "Data!A1+1", "Data!", "Other!A1", "Total"])(
  "preserves external, malformed and unaffected hyperlink %s", target => {
    const book = metadataBook({ name: "HyperLink", attributes: { type: "GnmHLinkCurWB", target } });
    expect(renameWorkbookSheet(book, "data", "Archive", context).sheets[0]!.cells).toEqual(book.sheets[0]!.cells);
  });

it.each([
  { name: "HyperLink", namespace: "urn:foreign", attributes: { type: "GnmHLinkCurWB", target: "Data!A1" } },
  { name: "HyperLink", attributes: { type: "GnmHLinkURL", target: "Data!A1" } },
  { name: "HyperLink", attributes: [{ name: "type", namespace: "", value: "GnmHLinkCurWB" }, { name: "target", namespace: "urn:foreign", value: "Data!A1" }] },
  { name: "Font", children: [{ name: "HyperLink", attributes: { type: "GnmHLinkCurWB", target: "Data!A1" } }] }
])("leaves foreign and misplaced Gnumeric metadata unchanged: %j", node => {
  const book = metadataBook(node);
  expect(renameWorkbookSheet(book, "data", "Archive", context).sheets[0]!.cells).toEqual(book.sheets[0]!.cells);
});

it.each(["#Data.A1", "#Total%20(Data)", "#$'Data'.$A$1"])("rewrites inline ODF mixed content %s", href => {
  const link = { name: "a", namespace: odfNamespaces.text!, text: "label", attributes: [
    { name: "href", namespace: odfNamespaces.xlink!, value: href },
    { name: "href", namespace: "urn:foreign", value: "#Data.A1" }
  ] };
  const book = metadataBook(link, true), before = structuredClone(book);
  const changed = renameWorkbookSheet(book, "data", "Archive", context);
  const data = odfObject(changed.sheets[0]!.unsupportedRecords![0]!.data)!;
  const content = data.content as readonly ImportedValue[];
  expect(content[0]).toEqual({ kind: "text", text: "before " });
  expect(content[2]).toEqual({ kind: "text", text: " after" });
  const rewritten = odfObject(content[1])!.value;
  expect(odfAttributes(rewritten, odfNamespaces.xlink).href).toContain("Archive");
  expect(odfAttributes(rewritten, "urn:foreign").href).toBe("#Data.A1");
  expect(odfObject(rewritten)!.text).toBe("label");
  expect(book).toEqual(before);
});

it("preserves hyperlink spelling for identity-only remaps and bounds work/cancellation", () => {
  const book = metadataBook({ name: "HyperLink", attributes: { type: "GnmHLinkCurWB", target: "data!Total" } });
  expect(remapWorkbookSheets(book, new Map([["data", { id: "new", name: "Data" }]]), context).sheets[0]!.cells).toEqual(book.sheets[0]!.cells);
  expect(() => renameWorkbookSheet(book, "data", "Archive", { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow(/work limit/);
  const controller = new AbortController(), reason = new Error("cancel"); controller.abort(reason);
  expect(() => renameWorkbookSheet(book, "data", "Archive", { ...context, signal: controller.signal })).toThrow(reason);
});
