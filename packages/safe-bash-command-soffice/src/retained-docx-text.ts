import { DocxNumbering } from "./retained-docx-numbering.js";
import { OfficeXml, SpanMap, type OfficeElement } from "./retained-office-xml.js";
import type { RetainedOfficeBlocks } from "./retained-office-blocks.js";
import { retainLower } from "./retained-lower.js";
import { escapeHtmlText } from "./html.js";
import { docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { type PagedStorage } from "@poe-code/safe-fs/storage";
import { createZipCodec } from "@poe-code/office-package/zip";
import { openRetainedXml, resolveOfficeResources, type XmlRange } from "@poe-code/office-xml";
import { RetainedSpans } from "./retained-spans.js";
import { retainXmlText } from "./retained-xml-text.js";
import type { RetainedSofficeContext, SofficeSnapshot } from "./retained-input.js";

/** DOCX text extraction retains archive names, relationships, tokens and output. */
export async function retainDocxText(storage: PagedStorage, source: SofficeSnapshot, context: RetainedSofficeContext, separator = "\n", markup?: { readonly format: "html" | "docx"; readonly title: string }, documentBlocks?: RetainedOfficeBlocks): Promise<SofficeSnapshot> {
  const { signal } = context, encoder = new TextEncoder(), names = new SpanMap(storage, signal), relationships = new SpanMap(storage, signal);
  const retain = async (source: AsyncIterable<Uint8Array>): Promise<SofficeSnapshot> => {
    const position = storage.allocate(0); let size = 0;
    for await (const bytes of source) { signal.throwIfAborted(); await storage.append(bytes); size += bytes.length; }
    return { position, size };
  };
  const literal = async (text: string): Promise<SofficeSnapshot> => {
    const position = storage.allocate(0); let size = 0;
    for (let offset = 0; offset < text.length;) {
      signal.throwIfAborted(); let end = Math.min(text.length, offset + 4096);
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
      const bytes = encoder.encode(text.slice(offset, end)); await storage.append(bytes); size += bytes.length; offset = end;
    }
    return { position, size };
  };
  async function* read(span: SofficeSnapshot) {
    for (let offset = 0; offset < span.size; offset += 16384) { signal.throwIfAborted(); if (offset % (64 * 16384) === 0) await yieldTurn(signal); yield new Uint8Array(await storage.read(span.position + offset, Math.min(16384, span.size - offset))); }
  }
  const open = async (span: SofficeSnapshot) => {
    const xml = await openRetainedXml(read(span), { signal, workingStorage: { fs: context.fs, directory: context.cwd } });
    const indexed = new OfficeXml(xml, storage, signal);
    try { await indexed.retain(); return indexed; } catch (error) { await xml.close().catch(() => {}); throw error; }
  };
  let numbering: SofficeSnapshot | undefined;
  let document: SofficeSnapshot | undefined, rels: SofficeSnapshot | undefined, styles: SofficeSnapshot | undefined;
  const codec = createZipCodec(), limits = resolveOfficeResources({ archiveLimits: { chunkSize: 16384 } }).archiveLimits;
  await codec.readZipArchive({ size: source.size, read: (offset, maximum) => storage.read(source.position + offset, Math.min(16384, maximum, source.size - offset)) }, limits, signal, {
    storage, async onEntry(entry) {
      const selected = entry.name === "word/numbering.xml" || !!documentBlocks || entry.name === "word/document.xml" || entry.name === "word/_rels/document.xml.rels" || !!markup && entry.name === "word/styles.xml";
      const position = storage.allocate(0); let size = 0;
      for await (const bytes of codec.decodeZipEntry(entry, limits, signal)) if (selected) { await storage.append(bytes); size += bytes.length; }
      const span = { position, size };
      if (entry.name === "word/numbering.xml") numbering = span;
      if (entry.name === "word/document.xml") document = span;
      if (entry.name === "word/styles.xml") styles = span;
      if (entry.name === "word/_rels/document.xml.rels") rels = span;
      await names.set(await literal(entry.name), span);
    }
  });
  if (!document && !markup && !documentBlocks) return { position: 0, size: 0 };
  if (rels && document) {
    const xml = await open(rels);
    let failed = true;
    try {
      for await (const element of xml.elements(0, xml.count, ["Relationship"], true, true)) {
        const id = await xml.attribute(element, "Id"), target = await xml.attribute(element, "Target");
        if (!id?.length || !target?.length) continue;
        const key = await retain(xml.xml.read(id)), raw = await retain(xml.xml.read(target));
        let start = 0;
        for await (const bytes of read(raw)) { let index = 0; while (index < bytes.length && bytes[index] === 47) index++; start += index; if (index < bytes.length) break; }
        const tail = { position: raw.position + start, size: raw.size - start };
        const prefix = new TextDecoder().decode(await storage.read(tail.position, Math.min(5, tail.size)));
        const normalized = prefix.startsWith("../") ? { position: tail.position + 3, size: tail.size - 3 }
          : prefix.startsWith("word/") ? tail : await retain((async function* () { yield encoder.encode("word/"); yield* read(tail); })());
        await relationships.set(key, normalized);
      }
      failed = false;
    } finally { await xml.xml.close().catch(error => { if (!failed) throw error; }); }
  }
  const output = new RetainedSpans(storage, signal);
  const gap = await literal(separator), newline = await literal("\n"), tab = await literal("\t");
  const xml = await open(document ?? { position: 0, size: 0 });
  let blocks = 0;
  const html = markup?.format === "html";
  const escaped = async (span: SofficeSnapshot): Promise<SofficeSnapshot> => {
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const escape = (text: string) => html ? escapeHtmlText(text) : text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return retain((async function* () {
      for await (const bytes of read(span)) for (let offset = 0; offset < bytes.length; offset += 4096)
        yield encoder.encode(escape(decoder.decode(bytes.subarray(offset, offset + 4096), { stream: true })));
      yield encoder.encode(escape(decoder.decode()));
    })());
  };
  const addBlock = async (span: SofficeSnapshot, heading = false, image = false, element?: OfficeElement) => {
    if (documentBlocks) { if (!image) await documentBlocks.paragraph(span, heading); return; }
    if (!markup) { if (blocks++) await output.add(gap); await output.add(span); return; }
    if (html && image) return;
    await output.add(await literal(html ? heading ? "<h1>" : "<p>" : "<w:p>" + (heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : "") + "<w:r><w:t>"));
    await output.add(html && element ? await inlineHtml(element) : await escaped(span));
    await output.add(await literal(html ? heading ? "</h1>\n" : "</p>\n" : "</w:t></w:r></w:p>"));
  };
  const runStyle = async (run: OfficeElement) => {
    let bold = false, italic = false;
    for await (const properties of xml.elements(run.open + 1, run.end, ["rPr"])) {
      for await (const property of xml.elements(properties.open + 1, properties.end, ["b", "i"], true)) {
        const value = await xml.attribute(property, "val");
        let setting = "";
        if (value && value.length <= 5) for await (const bytes of xml.xml.read(value)) setting += new TextDecoder().decode(bytes);
        const enabled = !value || setting === "1" || setting === "true" || setting === "on";
        if (await xml.name(property.name) === "b") bold = enabled;
        else italic = enabled;
      }
    }
    return {bold, italic};
  };
  const text = async (element: OfficeElement, preserveStyles = false, trim = true): Promise<SofficeSnapshot & { trim?: number; styles?: SofficeSnapshot }> => {
    const runs = new RetainedSpans(storage, signal), styles = new RetainedSpans(storage, signal);
    const owners = xml.elements(element.open + 1, element.end, ["r"])[Symbol.asyncIterator]();
    let owner = preserveStyles ? await owners.next() : undefined, bold = false, italic = false, styledOwner = -1, length = 0;
    for await (const run of xml.elements(element.open + 1, element.end, ["t", "tab", "br", "cr"], true)) {
      const name = await xml.name(run.name);
      let span: SofficeSnapshot | undefined;
      if (name === "t" && run.end !== run.open) span = await retainXmlText(storage, xml.xml.read(run.body), signal, false);
      else if (name !== "t" && run.end === run.open) span = name === "tab" ? tab : await literal(" ");
      if (!span) continue;
      if (preserveStyles) {
        while (owner && !owner.done && owner.value.end < run.first) owner = await owners.next();
        const current = owner && !owner.done && owner.value.first < run.first ? owner.value : undefined;
        if ((current?.first ?? -1) !== styledOwner) {
          bold = false; italic = false; styledOwner = current?.first ?? -1;
          if (current) ({bold, italic} = await runStyle(current));
        }
        if (bold || italic) {
          const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
          for (const [index, value] of [length, span.size, Number(bold), Number(italic)].entries()) view.setFloat64(index * 8, value);
          const position = storage.allocate(32); await storage.write(position, bytes); await styles.add({position, size: 32});
        }
      }
      await runs.add(span); length += span.size;
    }
    const joined = await runs.finish(), decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    if (!trim) return joined;
    let first = -1, last = 0, offset = 0;
    const inspect = (text: string) => { for (const char of text) { const point = char.codePointAt(0)!, size = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; if (char.trim()) { if (first < 0) first = offset; last = offset + size; } offset += size; } };
    for await (const bytes of read(joined)) inspect(decoder.decode(bytes, { stream: true })); inspect(decoder.decode());
    return { position: joined.position + Math.max(0, first), size: first < 0 ? 0 : last - first, trim: Math.max(0, first), ...(preserveStyles ? {styles: await styles.finish()} : {}) };
  };
  const inlineHtml = async (element: OfficeElement): Promise<SofficeSnapshot> => {
    const runs = new RetainedSpans(storage, signal);
    for await (const run of xml.elements(element.open + 1, element.end, ["r"])) {
      const {bold, italic} = await runStyle(run);
      await runs.add(await literal((bold ? "<b>" : "") + (italic ? "<i>" : "")));
      await runs.add(await escaped(await text(run, false, false)));
      await runs.add(await literal((italic ? "</i>" : "") + (bold ? "</b>" : "")));
    }
    return runs.finish();
  };
  const headingStyles = new SpanMap(storage, signal);
  const classify = async (span: SofficeSnapshot) => {
    let prefix = "", tail = "", section = false;
    for await (const bytes of read(span)) {
      const text = new TextDecoder().decode(bytes);
      if (prefix.length < 8) prefix += text.slice(0, 8 - prefix.length);
      section ||= (tail + text).includes("section"); tail = text.slice(-6);
    }
    return { heading: prefix.startsWith("heading"), title: span.size === 5 && prefix === "title", subtitle: span.size === 8 && prefix === "subtitle", normal: span.size === 6 && prefix === "normal", section };
  };
  const attributeIn = async (owner: OfficeXml, element: OfficeElement, tag: string, insensitive = false) => {
    for await (const child of owner.elements(element.open + 1, element.end, [tag], true, true, insensitive)) {
      const range = await owner.attribute(child, "val", insensitive); if (range?.length) return range;
    }
    return undefined;
  };
  const fontSize = async (owner: OfficeXml, element: OfficeElement, insensitive = false) => {
    for await (const child of owner.elements(element.open + 1, element.end, ["sz"], true, true, insensitive)) {
      const range = await owner.attribute(child, "val", insensitive); if (!range?.length) continue;
      let value = 0, valid = true;
      for await (const bytes of owner.xml.read(range)) for (const byte of bytes) {
        if (byte < 48 || byte > 57) { valid = false; break; } value = value * 10 + byte - 48;
      }
      if (valid) return value;
    }
    return 0;
  };
  let numberingXml: OfficeXml | undefined;
  let failed = true;
  try {
    numberingXml = numbering ? await open(numbering) : undefined;
    const lists = numberingXml ? new DocxNumbering(numberingXml, storage, signal) : undefined;
    await lists?.retain();
    const htmlLists: { id: number; level: number; ordered: boolean }[] = [];
    const closeLists = async (level = -1) => {
      while (htmlLists.length && htmlLists.at(-1)!.level > level) {
        const list = htmlLists.pop()!;
        await output.add(await literal(`</li>\n</${list.ordered ? "ol" : "ul"}>\n`));
      }
    };
    if ((markup || documentBlocks) && document && styles) {
      const owner = await open(styles); let styleFailed = true;
      try {
        for await (const style of owner.elements(0, owner.count, ["style"])) {
          const id = await owner.attribute(style, "styleId"); if (!id?.length) continue;
          const key = await retainLower(storage, owner.xml.read(id), signal), idKind = await classify(key);
          if (idKind.normal) continue;
          const name = await attributeIn(owner, style, "name"), nameKind = name ? await classify(await retainLower(storage, owner.xml.read(name), signal)) : undefined;
          const size = await fontSize(owner, style); let bold = false;
          for await (const ignoredElement of owner.elements(style.open + 1, style.end, ["b"], true, true)) { bold = true; break; }
          if (idKind.heading || idKind.title || nameKind?.heading || nameKind?.section || nameKind?.title || nameKind?.subtitle || size >= 26 || bold && size >= 24)
            await headingStyles.set(key, { position: 0, size: 0 });
        }
        styleFailed = false;
      } finally { await owner.xml.close().catch(error => { if (!styleFailed) throw error; }); }
    }
    const heading = async (block: OfficeElement) => {
      if (!markup && !documentBlocks) return false;
      const style = await attributeIn(xml, block, "pstyle", true);
      if (style) {
        const key = await retainLower(storage, xml.xml.read(style), signal), kind = await classify(key);
        if (kind.heading || kind.title || kind.subtitle || await headingStyles.get(key)) return true;
      }
      return await fontSize(xml, block, true) >= 28;
    };
    if (markup) await output.add(await literal(html ? `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtmlText(markup.title)}</title></head><body>\n` : docxDocumentPrefix));
    for await (const block of xml.elements(0, xml.count, ["p", "tbl"])) {
      if (await xml.name(block.name) === "tbl") {
        await closeLists();
        const table = new RetainedSpans(storage, signal); let rows = 0;
        documentBlocks?.beginTable();
        for await (const row of xml.elements(block.open + 1, block.end, ["tr"])) {
          let cells = 0;
          for await (const cell of xml.elements(row.open + 1, row.end, ["tc"])) {
            if (documentBlocks) { await documentBlocks.cell(await text(cell)); cells++; } else if (markup) {
              if (!cells) {
                if (!rows) await table.add(await literal(html ? "<table>\n" : "<w:tbl>"));
                rows++; await table.add(await literal(html ? "  <tr>" : "<w:tr>"));
              }
              cells++; await table.add(await literal(html ? "<td>" : "<w:tc><w:p><w:r><w:t>"));
              await table.add(html ? await inlineHtml(cell) : await escaped(await text(cell)));
              await table.add(await literal(html ? "</td>" : "</w:t></w:r></w:p></w:tc>"));
            } else {
              if (cells++) await table.add(tab); else if (rows++) await table.add(newline);
              await table.add(await text(cell));
            }
          }
          if (documentBlocks) await documentBlocks.endRow();
          if (markup && cells) await table.add(await literal(html ? "</tr>\n" : "</w:tr>"));
        }
        if (documentBlocks) await documentBlocks.endTable();
        if (rows) {
          if (markup) { await table.add(await literal(html ? "</table>\n" : "</w:tbl>")); await output.add(await table.finish()); }
          else await addBlock(await table.finish());
        }
      } else {
        const value = await text(block, !!documentBlocks), list = await lists?.next(xml, block);
        if (html && list) {
          await closeLists(list.level);
          const current = htmlLists.at(-1);
          if (current?.level === list.level && (current.id !== list.id || current.ordered !== list.ordered)) await closeLists(list.level - 1);
          if (htmlLists.at(-1)?.level === list.level) await output.add(await literal("</li>\n"));
          else {
            await output.add(await literal(list.ordered ? `<ol start="${list.number}">\n` : "<ul>\n"));
            htmlLists.push(list);
          }
          await output.add(await literal(list.ordered ? `<li value="${list.number}">` : "<li>"));
          await output.add(await inlineHtml(block));
        } else {
          await closeLists();
          if (value.size || list) {
            const marked = list?.marker ? await retain((async function* () { yield encoder.encode(list.marker + " "); yield* read(value); })()) : value;
            if (documentBlocks) await documentBlocks.paragraph(marked, await heading(block), value.styles, (list?.marker ? encoder.encode(list.marker + " ").length : 0) - (value.trim ?? 0));
            else await addBlock(marked, await heading(block), false, block);
          }
        }
        for await (const drawing of xml.elements(block.open + 1, block.end, ["drawing", "pict"])) {
          let reference: XmlRange | undefined;
          for (let index = drawing.first; index < drawing.end; index++) {
            const token = await xml.token(index);
            if (token.kind === "attribute-name" && await xml.name(token.range) === "embed") {
              const value = await xml.token(index + 1);
              if (value.kind === "attribute-value") for await (const bytes of xml.xml.read({ start: value.range.start - 1, length: 1 })) if (bytes[0] === 34) reference = value.range;
              if (reference) break;
            }
          }
          if (reference) {
            const target = await relationships.get(await retain(xml.xml.read(reference))), media = target ? await names.get(target) : undefined;
            if (media && documentBlocks) {
              let width = 432, height = 226.8;
              for await (const extent of xml.elements(drawing.open + 1, drawing.end, ["extent", "ext"], true, true)) {
                const cx = await xml.attribute(extent, "cx"), cy = await xml.attribute(extent, "cy");
                if (!cx?.length || !cy?.length) continue;
                const number = async (range: XmlRange) => { let value = 0; for await (const bytes of xml.xml.read(range)) for (const byte of bytes) { if (byte < 48 || byte > 57) return undefined; value = value * 10 + byte - 48; } return value; };
                const x = await number(cx), y = await number(cy); if (x === undefined || y === undefined) continue;
                width = Math.max(24, x / 12700); height = Math.max(24, y / 12700); break;
              }
              if (width > 504) { height *= 504 / width; width = 504; }
              await documentBlocks.addImage(media, width, height);
            } else if (media) await addBlock({ position: 0, size: 0 }, false, true);
          }
        }
      }
    }
    await closeLists();
    if (markup) await output.add(await literal(html ? "</body></html>\n" : docxDocumentSuffix));
    const result = await output.finish(); failed = false; return result;
  } finally {
    try { await numberingXml?.xml.close().catch(error => { if (!failed) throw error; }); }
    finally { await xml.xml.close().catch(error => { if (!failed) throw error; }); }
  }
}
