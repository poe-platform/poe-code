import { parseXmlSteps, type XmlElement, type XmlContent } from '@poe-code/xml-ast';
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
  const parse = async (path: string, open: (tag: XmlElement) => void, text?: (value: string) => void, close?: (tag: XmlElement) => void): Promise<void> => {
    const entry = entries.get(path);
    if (!entry) return;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let source = '';
    for await (const chunk of codec.decodeZipEntry(entry, limits, runtime.context.signal)) {
      runtime.step();
      // Reserve decoded source, normalization and retained XML strings/attributes
      // before materializing the AST. Each element is admitted separately below.
      runtime.retain(chunk.byteLength * 32);
      source += decoder.decode(chunk, { stream: true });
    }
    source += decoder.decode();
    let root: XmlElement;
    try {
      const parser = parseXmlSteps(source, {
        expectedEncoding: 'UTF-8', maxDepth: runtime.context.limits.maxNestingDepth,
        maxNodes: runtime.context.limits.maxWork, maxTextLength: limits.maxTextBytes,
        onElement() { runtime.step(); runtime.retain(256); }
      });
      let next = parser.next(); let work = 0;
      while (!next.done) {
        runtime.step();
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        next = parser.next();
      }
      root = next.value;
    } catch (failure) {
      runtime.context.signal.throwIfAborted();
      if (failure instanceof SyntaxError) throw new CsvkitBlocked(`XLSX ISO metadata XML: ${failure.message}`);
      throw failure;
    }
    // Preserve mixed text/CDATA order without recursive traversal of input depth.
    const stack: { node: XmlElement; index: number }[] = [];
    let item: XmlContent | undefined = root;
    while (item || stack.length) {
      runtime.step();
      if (item?.kind === 'element') { open(item); stack.push({ node: item, index: 0 }); }
      else if (item?.kind === 'text' || item?.kind === 'cdata') text?.(item.text);
      item = undefined;
      while (stack.length) {
        const frame = stack[stack.length - 1]!;
        if (frame.index < frame.node.content.length) { item = frame.node.content[frame.index++]; break; }
        runtime.step(); close?.(frame.node); stack.pop();
      }
    }
  };
  let workbookPath: string | undefined;
  await parse('[Content_Types].xml', tag => {
    if (tag.namespace !== contentTypeNamespace || tag.localName !== 'Override') return;
    const kind = attribute(tag, 'ContentType');
    if ([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
      'application/vnd.ms-excel.template.macroEnabled.main+xml'
    ].includes(kind ?? '')) {
      workbookPath = attribute(tag, 'PartName')?.slice(1);
    }
  });
  if (!workbookPath) throw new CsvkitDiagnostic('OSError: File contains no valid workbook part');
  if (namesOnly) return new Map();
  const sheets: { name: string; id: string }[] = [];
  await parse(workbookPath, tag => {
    if (tag.namespace !== spreadsheetNamespace || tag.localName !== 'sheet') return;
    const name = attribute(tag, 'name');
    const id = attribute(tag, 'id', relationshipNamespace);
    if (name !== undefined && id !== undefined) {
      runtime.retain(64 + (name.length + id.length) * 2); sheets.push({ name, id });
    }
  });
  const slash = workbookPath.lastIndexOf('/');
  const directory = workbookPath.slice(0, slash + 1);
  const targets = new Map<string, string>();
  await parse(`${directory}_rels/${workbookPath.slice(slash + 1)}.rels`, tag => {
    if (tag.namespace !== packageRelationshipNamespace || tag.localName !== 'Relationship' || attribute(tag, 'TargetMode') === 'External') return;
    const id = attribute(tag, 'Id'); const target = attribute(tag, 'Target');
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
      if (tag.namespace !== spreadsheetNamespace) return;
      if (tag.localName === 'row') {
        row = Number(attribute(tag, 'r') ?? row + 1); column = 0;
        if (!Number.isSafeInteger(row) || row < 1) throw new CsvkitBlocked('XLSX ISO metadata row coordinate');
      } else if (tag.localName === 'c') {
        const address = attribute(tag, 'r') ?? utils.encode_cell({ r: row - 1, c: column });
        column = utils.decode_cell(address).c + 1;
        coordinate = attribute(tag, 't') === 'd' ? address : undefined;
      } else if (tag.localName === 'v' && coordinate !== undefined) { capturing = true; value = ''; }
    }, text => {
      if (capturing) { runtime.retain(text.length * 2); value += text; }
    }, tag => {
      if (tag.namespace !== spreadsheetNamespace) return;
      if (tag.localName === 'v' && capturing) {
        runtime.retain(64 + coordinate!.length * 2); dates.set(coordinate!, value); capturing = false;
      } else if (tag.localName === 'c') coordinate = undefined;
    });
    if (dates.size) result.set(sheet.name, dates);
  }
  return result;
}

function attribute(node: XmlElement, name: string, namespace = ''): string | undefined {
  return node.attributes.find(item => item.localName === name && item.namespace === namespace)?.value;
}
