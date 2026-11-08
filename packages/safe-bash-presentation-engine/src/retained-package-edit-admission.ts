import type { ByteSource } from './contracts.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import type { RetainedContentTypes } from './retained-content-types.js';
import type { RetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedXmlDocument } from './retained-xml-document.js';
import { characters, literal, equal } from './retained-values.js';
import { OfficeError } from './errors.js';
import { resourceContext } from './resource-limits.js';

function unsupported(): never { throw new OfficeError('unsupported-edit', 'Signed, macro-enabled, labeled or protected packages cannot be edited.', 'validate-intent'); }
async function mime(source: ByteSource) {
  let text = '', window = '', pending = '', started = false, overflow = false;
  for await (const value of characters(source)) {
    if (value === ';') break;
    if (!value.trim()) { if (started) pending = ' '; continue; }
    started = true;
    for (const character of pending + value.toLowerCase()) {
      window = (window + character).slice(-17);
      if (['digital-signature', 'macroenabled', 'vbaproject'].some(needle => window.endsWith(needle))) unsupported();
      if (text.length < 100) text += character; else overflow = true;
    }
    pending = '';
  }
  return overflow ? '' : text;
}
/** Matches buffered package-edit admission without collecting XML or MIME values. */
export async function admitRetainedPackageEdit(archive: RetainedPackageArchive, main: string,
  types: RetainedContentTypes, graph: RetainedRelationshipGraph, settings: RetainedPackageContext): Promise<void> {
  const context = resourceContext(settings); let metadataBytes = 0, metadataNodes = 0;
  for await (const part of archive.parts()) {
    if (part === '/[Content_Types].xml') continue;
    const name = part.toLowerCase(), type = await mime(await types.get(part));
    if (name.startsWith('/_xmlsignatures/') || name.endsWith('/vbaproject.bin') || name === '/docmetadata/labelinfo.xml' || type === 'application/vnd.ms-office.classificationlabels+xml') unsupported();
    if (type === 'application/vnd.openxmlformats-officedocument.custom-properties+xml') {
      metadataBytes += await archive.byteLength(part);
      if (metadataBytes > context.xmlLimits.maxBytes || metadataNodes >= context.xmlLimits.maxNodes) throw new OfficeError('resource-limit', 'Security metadata inspection limit exceeded.', 'validate-intent');
      const document = await openRetainedXmlDocument(archive.read(part), { ...settings, xmlLimits: { ...context.xmlLimits, maxNodes: context.xmlLimits.maxNodes - metadataNodes } }); let failed = false;
      try {
        metadataNodes += document.nodeCount;
        for await (const node of document.children(document.root)) {
          if (node.kind !== 'element' || !await equal(document.raw(node.localName), literal('property'))) continue;
          if (!await equal(document.namespace(node), literal('http://schemas.openxmlformats.org/officeDocument/2006/custom-properties')) && !await equal(document.namespace(node), literal('http://purl.oclc.org/ooxml/officeDocument/customProperties'))) continue;
          for await (const attribute of document.attributes(node)) if (await equal(document.namespace(attribute), literal('')) && await equal(document.raw(attribute.localName), literal('name'))) {
            let prefix = ''; for await (const character of characters(document.text(attribute))) { prefix += character; if (prefix.length >= 11) break; }
            if (prefix === 'MSIP_Label_') unsupported();
          }
        }
      } catch (error) { failed = true; throw error; } finally { try { await document.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    }
  }
  async function* owners() { yield '/'; yield* graph.parts(); }
  for await (const owner of owners()) for await (const edge of graph.outgoing(owner)) {
    let window = '';
    for await (const character of characters(edge.type())) { window = (window + character).slice(-19); if (window.includes('/digital-signature/')) unsupported(); }
    if (window.endsWith('/vbaProject')) unsupported();
  }
  const document = await openRetainedXmlDocument(archive.read(main), settings); let failed = false;
  try { for await (const node of document.elements(document.root)) if (await equal(document.raw(node.localName), literal('modifyVerifier')) && await equal(document.namespace(node), document.namespace(document.root))) unsupported(); }
  catch (error) { failed = true; throw error; } finally { try { await document.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
}
