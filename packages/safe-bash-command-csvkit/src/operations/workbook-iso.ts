import { SaxesParser, type SaxesTagNS } from 'saxes';
import { utils } from '@e965/xlsx';
import type { ZipArchive, ZipLimits, createZipCodec } from '@poe-code/office-package';
import type { Runtime } from '../runtime.js';
import { virtualPath } from '../io/index.js';
import { CsvkitBlocked, CsvkitDiagnostic } from '../errors.js';

const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentTypeNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Preserve ISO cell provenance lost by the workbook reader's raw serial API. */
export async function readWorkbookIsoDates(runtime: Runtime, archive: ZipArchive, codec: ReturnType<typeof createZipCodec>, limits: ZipLimits, namesOnly = false): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  const entries = new Map(archive.entries.map(entry => [entry.name, entry]));
  if (!entries.has('[Content_Types].xml')) throw new CsvkitDiagnostic(`KeyError: "There is no item named '[Content_Types].xml' in the archive"`);
  const parse = async (path: string, open: (tag: SaxesTagNS) => void, text?: (value: string) => void, close?: (tag: SaxesTagNS) => void): Promise<void> => {
    const entry = entries.get(path);
    if (!entry) return;
    const parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', tag => { runtime.step(); open(tag); });
    if (text) { parser.on('text', text); parser.on('cdata', text); }
    if (close) parser.on('closetag', close);
    parser.on('error', failure => { throw new CsvkitBlocked(`XLSX ISO metadata XML: ${failure.message}`); });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const chunk of codec.decodeZipEntry(entry, limits, runtime.context.signal)) {
      runtime.step();
      // Both decoded XML and parser buffering stay within the invocation budget.
      runtime.retain(chunk.byteLength * 2);
      parser.write(decoder.decode(chunk, { stream: true }));
    }
    parser.write(decoder.decode()); parser.close();
  };
  let workbookPath: string | undefined;
  await parse('[Content_Types].xml', tag => {
    if (tag.uri !== contentTypeNamespace || tag.local !== 'Override') return;
    const kind = tag.attributes.ContentType?.value;
    if ([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
      'application/vnd.ms-excel.template.macroEnabled.main+xml'
    ].includes(kind ?? '')) {
      workbookPath = tag.attributes.PartName?.value.slice(1);
    }
  });
  if (!workbookPath) throw new CsvkitDiagnostic('OSError: File contains no valid workbook part');
  if (namesOnly) return new Map();
  const sheets: { name: string; id: string }[] = [];
  await parse(workbookPath, tag => {
    if (tag.uri !== spreadsheetNamespace || tag.local !== 'sheet') return;
    const name = tag.attributes.name?.value;
    const id = Object.values(tag.attributes).find(attribute => attribute.uri === relationshipNamespace && attribute.local === 'id')?.value;
    if (name !== undefined && id !== undefined) {
      runtime.retain(64 + (name.length + id.length) * 2); sheets.push({ name, id });
    }
  });
  const slash = workbookPath.lastIndexOf('/');
  const directory = workbookPath.slice(0, slash + 1);
  const targets = new Map<string, string>();
  await parse(`${directory}_rels/${workbookPath.slice(slash + 1)}.rels`, tag => {
    if (tag.uri !== packageRelationshipNamespace || tag.local !== 'Relationship' || tag.attributes.TargetMode?.value === 'External') return;
    const id = tag.attributes.Id?.value; const target = tag.attributes.Target?.value;
    if (id !== undefined && target !== undefined) {
      runtime.retain(64 + (id.length + target.length) * 2);
      targets.set(id, virtualPath('/' + directory, target).slice(1));
    }
  });
  const result = new Map<string, ReadonlyMap<string, string>>();
  for (const sheet of sheets) {
    const target = targets.get(sheet.id);
    if (!target) continue;
    const dates = new Map<string, string>();
    let coordinate: string | undefined; let capturing = false; let value = '';
    let row = 0; let column = 0;
    await parse(target, tag => {
      if (tag.uri !== spreadsheetNamespace) return;
      if (tag.local === 'row') {
        row = Number(tag.attributes.r?.value ?? row + 1); column = 0;
        if (!Number.isSafeInteger(row) || row < 1) throw new CsvkitBlocked('XLSX ISO metadata row coordinate');
      } else if (tag.local === 'c') {
        const address = tag.attributes.r?.value ?? utils.encode_cell({ r: row - 1, c: column });
        column = utils.decode_cell(address).c + 1;
        coordinate = tag.attributes.t?.value === 'd' ? address : undefined;
      } else if (tag.local === 'v' && coordinate !== undefined) { capturing = true; value = ''; }
    }, text => {
      if (capturing) { runtime.retain(text.length * 2); value += text; }
    }, tag => {
      if (tag.uri !== spreadsheetNamespace) return;
      if (tag.local === 'v' && capturing) {
        runtime.retain(64 + coordinate!.length * 2); dates.set(coordinate!, value); capturing = false;
      } else if (tag.local === 'c') coordinate = undefined;
    });
    if (dates.size) result.set(sheet.name, dates);
  }
  return result;
}
