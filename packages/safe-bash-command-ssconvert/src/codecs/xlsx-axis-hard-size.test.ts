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
