import { expect, it, vi } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { suppliedDefaultFont } from "@poe-code/pdf";
import { PDFDocument, PDFPage } from "pdf-lib";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Workbook } from "../workbook.js";
import { readXlsx, createXlsxWriter } from "./xlsx.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import { readBiff } from "./biff.js";
import { writeBiffStream } from "./biff-write.js";
import { writePdf } from "./pdf.js";
import { sheetPrintSettings } from "../rendering/print/settings.js";
import { metadataNode, type MetadataNode } from "./xlsx-write-support.js";

function imported(node: MetadataNode): ImportedValue {
  return { ...node, attributes: { ...node.attributes }, children: node.children.map(imported) };
}
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, fonts: { async resolve() { return suppliedDefaultFont().bytes; } },
  limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 1000, sheets: 4, operations: 1000 } };
const zipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
async function fixture(axis: "row" | "col", breaks = '<brk id="2" min="0" max="3" man="1"/>') {
  const cells = Array.from({ length: 4 }, (_, i) => `<c r="${axis === "row" ? "A" + (i + 1) : String.fromCharCode(65 + i) + "1"}" t="inlineStr"><is><t>cell${i}</t></is></c>`);
  const rows = axis === "row" ? cells.map(c => `<row>${c}</row>`).join("") : `<row>${cells.join("")}</row>`;
  const parts = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetData>${rows}</sheetData><pageSetup paperSize="1" cellComments="asDisplayed"/><headerFooter><oddHeader/><oddFooter/></headerFooter><${axis}Breaks count="1" manualBreakCount="1">${breaks}</${axis}Breaks></worksheet>`
  };
  const zip = createZipCodec(), entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, zipLimits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, zipLimits, context.signal);
}
async function sheetXml(book: Workbook) {
  const zip = createZipCodec();
  const archive = await zip.readZipArchive(await createXlsxWriter("2008")(book, [], context), zipLimits, context.signal);
  const entry = archive.entries.find(e => e.name === "xl/worksheets/sheet1.xml")!;
  let text = ""; const decoder = new TextDecoder();
  for await (const chunk of zip.decodeZipEntry(entry, zipLimits, context.signal)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}
it.each(["row", "col"] as const)("preserves original XLSX %s axes through XML/XLSX/BIFF and prints package geometry", async axis => {
  const original = await readXlsx(await fixture(axis), context);
  const variants = [original,
    await readGnumeric(await writeGnumeric(original, [], context), context),
    await readXlsx(await createXlsxWriter("2008")(original, [], context), context),
    await readXlsx(await createXlsxWriter("2006")(original, [], context), context),
    await readBiff(await writeBiffStream(original, 7, false, context), context),
    await readBiff(await writeBiffStream(original, 8, false, context), context)];
  for (const book of variants) {
    const settings = sheetPrintSettings(book.sheets[0]!, context);
    expect(settings.rowBreaks).toEqual(axis === "row" ? [{ position: 2, type: "manual" }] : []);
    expect(settings.columnBreaks).toEqual(axis === "col" ? [{ position: 2, type: "manual" }] : []);
  }
  // XLSX/BIFF writers materialize styles outside this axis qualification. The
  // independent original package and its XML transport exercise PDF directly.
  for (const book of variants.slice(0, 2)) {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const pdf = await PDFDocument.load(await writePdf(book, [], context));
      expect(pdf.getPages().map(p => [p.getWidth(), p.getHeight()])).toEqual([[612, 792], [612, 792]]);
      const pages = new Map<object, string[]>();
      draw.mock.calls.forEach(([text], i) => {
        if (text.startsWith("cell")) { const page = draw.mock.contexts[i]!; pages.set(page, [...pages.get(page) ?? [], text]); }
      });
      expect([...pages.values()]).toEqual([["cell0", "cell1"], ["cell2", "cell3"]]);
    } finally { draw.mockRestore(); }
  }
});
it.each(["row", "col"] as const)("preserves untouched %s break bounds and manual flags while allowing explicit edits", async axis => {
  const book = await readXlsx(await fixture(axis, '<brk id="2" min="1" max="3" man="1" pt="0"/>'), context);
  expect(await sheetXml(book)).toContain(`<${axis}Breaks count="1" manualBreakCount="1"><brk id="2" min="1" max="3" man="1" pt="0"/></${axis}Breaks>`);
  const records = book.sheets[0]!.unsupportedRecords!;
  const print = metadataNode(records.find(r => r.kind === "PrintInformation")!.data)!;
  const name = axis === "row" ? "hPageBreaks" : "vPageBreaks";
  const edited = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: records.map(r => r.kind !== "PrintInformation" ? r : { ...r,
    data: imported({ ...print, children: print.children.map(n => n.name !== name ? n : { ...n, children: [{ ...n.children[0]!, attributes: { pos: "3", type: "data-slice" } }] }) }) }) }] };
  const output = await sheetXml(edited);
  expect(output).toContain(`<${axis}Breaks count="1"><brk id="3" max="${axis === "row" ? 16383 : 1048575}" pt="1"/></${axis}Breaks>`);
  expect(output).not.toContain('id="2"');
});

it.each(["row", "col"] as const)("retains %s automatic/data-slice and ordered admission semantics", async axis => {
  for (const [breaks, pages] of [
    ['<brk id="2" man="0"/>', 1],
    ['<brk id="2" man="0" pt="1"/>', 2],
    ['<brk id="2" man="1"/><brk id="1" man="1"/>', 2],
    ['<brk id="2" man="0"/><brk id="1" man="1"/>', 1],
    ['<brk id="100" man="1"/>', 1]
  ] as const) {
    const book = await readXlsx(await fixture(axis, breaks), context);
    expect((await PDFDocument.load(await writePdf(book, [], context))).getPageCount()).toBe(pages);
  }
});
it("does not resurrect removed normalized break metadata", async () => {
  const book = await readXlsx(await fixture("row"), context);
  const records = book.sheets[0]!.unsupportedRecords!;
  const print = metadataNode(records.find(r => r.kind === "PrintInformation")!.data)!;
  const edited = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: records.map(r => r.kind !== "PrintInformation" ? r : {
    ...r, data: imported({ ...print, children: print.children.filter(n => n.name !== "hPageBreaks") })
  }) }] };
  expect(await sheetXml(edited)).not.toContain("<rowBreaks");
});
it("keeps cancellation and work budgets on retained break export", async () => {
  const book = await readXlsx(await fixture("row"), context);
  const controller = new AbortController(); controller.abort(new Error("cancel break export"));
  await expect(createXlsxWriter("2008")(book, [], { ...context, signal: controller.signal })).rejects.toThrow("cancel break export");
  await expect(createXlsxWriter("2008")(book, [], { ...context, limits: { ...context.limits, workbookWork: 10 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("preserves an untouched sibling's bounds when another break is edited", async () => {
  const book = await readXlsx(await fixture("row", '<brk id="1" min="2" max="3" man="1"/><brk id="2" min="0" max="3" man="1"/>'), context);
  const records = book.sheets[0]!.unsupportedRecords!;
  const print = metadataNode(records.find(r => r.kind === "PrintInformation")!.data)!;
  const edited = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: records.map(r => r.kind !== "PrintInformation" ? r : {
    ...r, data: imported({ ...print, children: print.children.map(n => n.name !== "hPageBreaks" ? n : {
      ...n, children: [n.children[0]!, { ...n.children[1]!, attributes: { pos: "3", type: "manual" } }]
    }) })
  }) }] };
  const output = await sheetXml(edited);
  expect(output).toContain('<brk id="1" min="2" max="3" man="1"/>');
  expect(output).toContain('<brk id="3" max="16383" man="1"/>');
});


it.each(["row", "col"] as const)("accepts xs:boolean break flags on the %s axis through XLSX/BIFF/PDF", async axis => {
  for (const [flags, type, pages] of [
    ['man="true"', "manual", 2],
    ['pt="true"', "data-slice", 2],
    ['man="true" pt="true"', "data-slice", 2],
    ['man="false" pt="false"', "auto", 1],
    ['man="true" pt="false"', "manual", 2]
  ] as const) {
    const book = await readXlsx(await fixture(axis, `<brk id="2" min="0" max="3" ${flags}/>`), context);
    const variants = [book,
      await readXlsx(await createXlsxWriter("2008")(book, [], context), context),
      await readBiff(await writeBiffStream(book, 8, false, context), context)];
    for (const [index, variant] of variants.entries()) {
      const settings = sheetPrintSettings(variant.sheets[0]!, context);
      expect(axis === "row" ? settings.rowBreaks : settings.columnBreaks).toEqual(type === "auto" ? [] : [{ position: 2, type: index === 2 ? "manual" : type }]);
    }
    expect((await PDFDocument.load(await writePdf(book, [], context))).getPageCount()).toBe(pages);
    expect(await sheetXml(book)).toContain(`<brk id="2" min="0" max="3" ${flags}/>`);
  }
});

it.each(["manual", "data-slice"])("retains true-spelled %s bounds after sibling edits", async type => {
  const flags = type === "manual" ? 'man="true"' : 'pt="true"';
  const book = await readXlsx(await fixture("row", `<brk id="1" min="2" max="3" ${flags}/><brk id="2" man="1"/>`), context);
  const records = book.sheets[0]!.unsupportedRecords!;
  const print = metadataNode(records.find(r => r.kind === "PrintInformation")!.data)!;
  const edited = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: records.map(r => r.kind !== "PrintInformation" ? r : {
    ...r, data: imported({ ...print, children: print.children.map(n => n.name !== "hPageBreaks" ? n : {
      ...n, children: [{ ...n.children[0]!, attributes: { pos: "1", type } }, { ...n.children[1]!, attributes: { pos: "3", type: "manual" } }]
    }) })
  }) }] };
  expect(await sheetXml(edited)).toContain(`<brk id="1" min="2" max="3" ${flags}/>`);
});

it.each(["row", "col"] as const)("omits cleared %s break containers with retained raw metadata", async axis => {
  const book = await readXlsx(await fixture(axis), context);
  const records = book.sheets[0]!.unsupportedRecords!;
  const print = metadataNode(records.find(r => r.kind === "PrintInformation")!.data)!;
  const name = axis === "row" ? "hPageBreaks" : "vPageBreaks";
  const edited = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: records.map(r => r.kind !== "PrintInformation" ? r : {
    ...r, data: imported({ ...print, children: print.children.map(n => n.name !== name ? n : { ...n, attributes: { count: "0" }, children: [] }) })
  }) }] };
  expect(await sheetXml(edited)).not.toContain(`<${axis}Breaks`);
});

it("omits empty Gnumeric page-break containers on both axes", async () => {
  const book = await readGnumeric(new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:hPageBreaks count="0"/><g:vPageBreaks count="0"/></g:PrintInformation><g:Cells><g:Cell Row="0" Col="0" ValueType="60">cell</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>'), context);
  const output = await sheetXml(book);
  expect(output).not.toContain("<rowBreaks");
  expect(output).not.toContain("<colBreaks");
});
