import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import { parseXml, type XmlElement } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { writeClipboardGnumeric, writeGnumeric } from "./gnumeric.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 1000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
async function input(content: string) {
  const zip = createZipCodec(), ss = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const parts = { '_rels/.rels': `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/s.xml"/></Relationships>`,
    'xl/worksheets/s.xml': `<worksheet xmlns="${ss}">${content}</worksheet>` };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date('2000-01-01Z'), mode: 0o644, directory: false, symlink: false, compression: 'store' }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
function descendants(node: XmlElement): XmlElement[] { return [node, ...node.children.flatMap(descendants)]; }
const flag = (value: string | undefined) => value === undefined ? '' : ` customHeight="${value}"`;
for (const kind of ['row', 'column'] as const) for (const custom of [undefined, '0', '1', 'false', 'true']) {
  for (const bestFit of kind === 'row' ? [undefined] : [undefined, '0', '1', 'false', 'true']) {
    it(`${kind} transports custom=${custom}, bestFit=${bestFit} through XML,clipboard and both XLSX editions`, async () => {
      const expected = (custom === '1' || custom === 'true') && bestFit !== '1' && bestFit !== 'true';
      const content = kind === 'row' ? `<sheetData><row r="1" ht="25"${flag(custom)}/></sheetData>` :
        `<cols><col min="1" max="2" width="25"${custom === undefined ? '' : ` customWidth="${custom}"`}${bestFit === undefined ? '' : ` bestFit="${bestFit}"`}/></cols>`;
      const imported = await readXlsx(await input(content), context);
      const original = { ...imported, sheets: imported.sheets.map(sheet => ({ ...sheet, size: { rows: 128, columns: 128 } })) };
      for (const book of [original, await readXlsx(await createXlsxWriter('2006')(original, [], context), context), await readXlsx(await createXlsxWriter('2008')(original, [], context), context)]) {
        const sheet = book.sheets[0]!;
        for (const bytes of [await writeGnumeric(book, [], context), writeClipboardGnumeric(book, sheet, { sheet: sheet.id, startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }, context)]) {
          const axes = descendants(parseXml(new TextDecoder().decode(bytes))).filter(n => n.localName === (kind === 'row' ? 'RowInfo' : 'ColInfo') && Number(n.attributes.find(a => a.localName === 'No')?.value) < (kind === 'row' ? 1 : 2));
          expect(axes.length).toBeGreaterThan(0);
          for (const axis of axes) expect(Number(axis.attributes.find(a => a.localName === 'HardSize')?.value ?? 0)).toBe(Number(expected));
        }
      }
    });
  }
}

for (const [kind, value, expected] of [
  ['row', -1, 12.75], ['row', 0, 12.75], ['row', 0.25, 0.25], ['row', 25, 25],
  ['column', -1, 48], ['column', 0, 48], ['column', 0.5, 48], ['column', 1, 5.25], ['column', 25, 131.3],
  ['column', 0.7618589743589743, 48], ['column', 0.7618589743589744, 48], ['column', 0.7618589743589745, 4]
] as const) {
  it(`${kind} retains native accepted geometry for source dimension ${value}`, async () => {
    const flags = 'hidden="1" collapsed="1" outlineLevel="2"';
    const content = kind === 'row' ? `<sheetData><row r="1" ht="${value}" customHeight="1" ${flags}/></sheetData>` :
      `<cols><col min="1" max="1" width="${value}" customWidth="1" ${flags}/></cols>`;
    const original = await readXlsx(await input(content), context);
    const sheet = original.sheets[0]!;
    for (const bytes of [await writeGnumeric(original, [], context), writeClipboardGnumeric(original, sheet, { sheet: sheet.id, startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }, context)]) {
      const axis = descendants(parseXml(new TextDecoder().decode(bytes))).find(n => n.localName === (kind === 'row' ? 'RowInfo' : 'ColInfo') && n.attributes.some(a => a.localName === 'No' && a.value === '0'))!;
      const attrs = Object.fromEntries(axis.attributes.map(a => [a.localName, a.value]));
      expect(Number(attrs.Unit)).toBe(expected);
      expect(Number(attrs.HardSize ?? 0)).toBe(Number(kind === 'row' ? value > 0 : expected !== 48));
      expect(attrs).toMatchObject({ Hidden: '1', Collapsed: '1', OutlineLevel: '2' });
    }
  });
}

const orderedColumnCases = [
  ["<col min=\"1\" max=\"2\" hidden=\"1\" outlineLevel=\"2\"/>",[[48,0,1,0,2],[48,0,1,0,2],[48,0,0,1,0]]],
  ["<col min=\"1\" max=\"2\" hidden=\"1\" outlineLevel=\"2\"/><col min=\"3\" max=\"3\" outlineLevel=\"0\" collapsed=\"0\"/>",[[48,0,1,0,2],[48,0,1,0,2],[48,0,0,1,0]]],
  ["<col min=\"1\" max=\"2\" hidden=\"1\" outlineLevel=\"2\"/><col min=\"2\" max=\"2\" hidden=\"0\" outlineLevel=\"0\"/>",[[48,0,1,0,2],[48,0,1,0,2],[48,0,0,1,0]]],
  ["<col min=\"1\" max=\"1\" width=\"25\" customWidth=\"1\"/><col min=\"1\" max=\"1\" width=\"0\"/>",[[131.3,1,0,0,0],[48,0,0,0,0],[48,0,0,0,0]]],
  ["<col min=\"1\" max=\"2\" outlineLevel=\"3\" collapsed=\"1\"/><col min=\"2\" max=\"2\" outlineLevel=\"1\"/><col min=\"1\" max=\"2\" hidden=\"1\"/>",[[48,0,1,1,3],[48,0,1,0,1],[48,0,0,1,0]]]
] as const;
for (const [columns, expected] of orderedColumnCases) {
  it(`preserves native ordered column state for ${columns}`, async () => {
    const book = await readXlsx(await input(`<cols>${columns}</cols><sheetData/>`), context);
    const bytes = await writeGnumeric(book, [], context);
    const axes = descendants(parseXml(new TextDecoder().decode(bytes))).filter(n => n.localName === "ColInfo");
    const values = Array.from({ length: 3 }, () => [48, 0, 0, 0, 0]);
    for (const axis of axes) {
      const attrs = Object.fromEntries(axis.attributes.map(a => [a.localName, a.value]));
      for (let i = Number(attrs.No); i < Math.min(3, Number(attrs.No) + Number(attrs.Count ?? 1)); i++) {
        values[i] = [Number(attrs.Unit), Number(attrs.HardSize ?? 0), Number(attrs.Hidden ?? 0), Number(attrs.Collapsed ?? 0), Number(attrs.OutlineLevel ?? 0)];
      }
    }
    expect(values).toEqual(expected);
  });
}

it("charges generated column summary markers against the metadata budget", async () => {
  const bytes = await input('<cols><col min="1" max="1" hidden="1" outlineLevel="2"/></cols>');
  await expect(readXlsx(bytes, { ...context, limits: { ...context.limits, workbookNodes: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});
it("keeps a hidden group at the final XLSX column inside worksheet bounds", async () => {
  const book = await readXlsx(await input('<cols><col min="16384" max="16384" hidden="1" outlineLevel="2"/></cols>'), context);
  expect(book.sheets[0]!.columns).toEqual([{ index: 16383, hidden: true, outlineLevel: 2, collapsed: false }]);
});
it("charges repeated column spans even when they update existing metadata", async () => {
  const bytes = await input('<cols><col min="1" max="1"/><col min="1" max="1"/></cols>');
  await expect(readXlsx(bytes, { ...context, limits: { ...context.limits, workbookNodes: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});

const orderedRowCases = [
  ["<row r=\"1\" ht=\"25\" customHeight=\"1\" hidden=\"1\" outlineLevel=\"3\" collapsed=\"1\"/><row r=\"1\" ht=\"0\" hidden=\"0\" outlineLevel=\"0\"/>",[[25,1,1,0,0],[12.75,0,0,0,0]]],
  ["<row r=\"1\" ht=\"25\" customHeight=\"1\" hidden=\"1\" outlineLevel=\"3\" collapsed=\"1\"/><row r=\"1\"/>",[[25,1,1,1,3],[12.75,0,0,0,0]]],
  ["<row r=\"1\" outlineLevel=\"3\"/><row r=\"1\" hidden=\"1\" outlineLevel=\"0\"/>",[[12.75,0,1,0,0],[12.75,0,0,1,0]]],
  ["<row r=\"1\" hidden=\"1\" outlineLevel=\"3\"/><row r=\"1\" hidden=\"1\" outlineLevel=\"3\"/>",[[12.75,0,1,0,3],[12.75,0,0,0,0]]],
  ["<row r=\"1\" ht=\"25\" customHeight=\"1\"/><row r=\"1\" ht=\"-1\" customHeight=\"0\"/>",[[25,1,0,0,0],[12.75,0,0,0,0]]]
] as const;
for (const [rows, expected] of orderedRowCases) {
  it(`preserves native ordered row state for ${rows}`, async () => {
    const original = await readXlsx(await input(`<sheetData>${rows}</sheetData>`), context);
    for (const book of [original, await readXlsx(await createXlsxWriter("2008")(original, [], context), context)]) {
      const axes = descendants(parseXml(new TextDecoder().decode(await writeGnumeric(book, [], context)))).filter(n => n.localName === "RowInfo");
      const values = Array.from({ length: 2 }, () => [12.75, 0, 0, 0, 0]);
      for (const axis of axes) {
        const attrs = Object.fromEntries(axis.attributes.map(a => [a.localName, a.value]));
        for (let i = Number(attrs.No); i < Math.min(2, Number(attrs.No) + Number(attrs.Count ?? 1)); i++) {
          values[i] = [Number(attrs.Unit), Number(attrs.HardSize ?? 0), Number(attrs.Hidden ?? 0), Number(attrs.Collapsed ?? 0), Number(attrs.OutlineLevel ?? 0)];
        }
      }
      expect(values).toEqual(expected);
    }
  });
}

it("charges generated row summaries against the metadata budget", async () => {
  const bytes = await input('<sheetData><row r="1" outlineLevel="3"/><row r="1" hidden="1"/></sheetData>');
  await expect(readXlsx(bytes, { ...context, limits: { ...context.limits, workbookNodes: 2 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});
it("charges repeated row records even when they update existing metadata", async () => {
  const bytes = await input('<sheetData><row r="1"/><row r="1"/></sheetData>');
  await expect(readXlsx(bytes, { ...context, limits: { ...context.limits, workbookNodes: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});
it("keeps generated row summaries within the worksheet boundary", async () => {
  const bytes = await input('<sheetData><row r="1048576" outlineLevel="3"/><row r="1048576" hidden="1" outlineLevel="0"/></sheetData>');
  const book = await readXlsx(bytes, context);
  expect(book.sheets[0]!.rows).toEqual([{ index: 1048575, hidden: true, outlineLevel: 0, collapsed: false }]);
});
