import type { RetainedOfficeBlocks } from "./retained-office-blocks.js";
import { retainLower } from "./retained-lower.js";
import { escapeHtmlText } from "./html.js";
import { docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { createZipCodec } from "@poe-code/office-package/zip";
import { openRetainedXml, resolveOfficeResources, type RetainedXml, type XmlRange } from "@poe-code/office-xml";
import { RetainedSpans } from "./retained-spans.js";
import { retainXmlText } from "./retained-xml-text.js";
import type { RetainedSofficeContext, SofficeSnapshot } from "./retained-input.js";

type Element = { name: XmlRange; first: number; open: number; end: number; body: XmlRange };
const kinds = ["text", "start-name", "attribute-name", "attribute-value", "start-end", "end-name", "comment", "cdata", "instruction"];

/** A replayable lexical index preserves the permissive legacy element selection. */
class DocxXml {
  private readonly index: IntegerTable;
  count = 0;
  private work = 0;
  constructor(readonly xml: RetainedXml, storage: PagedStorage, private readonly signal: AbortSignal) { this.index = new IntegerTable(storage); }
  async retain(): Promise<void> {
    for await (const token of this.xml.tokens()) {
      for (const [field, value] of [kinds.indexOf(token.kind), token.range.start, token.range.length, token.empty ? 1 : 0].entries())
        await this.index.set(BigInt(this.count * 4 + field), BigInt(value));
      this.count++; if (this.count % 256 === 0) await yieldTurn(this.signal);
    }
  }
  async token(index: number) {
    this.signal.throwIfAborted(); if (++this.work % 256 === 0) await yieldTurn(this.signal);
    return { kind: kinds[Number(await this.index.get(BigInt(index * 4)))], range: { start: Number(await this.index.get(BigInt(index * 4 + 1))), length: Number(await this.index.get(BigInt(index * 4 + 2))) }, empty: await this.index.get(BigInt(index * 4 + 3)) === 1n };
  }
  async name(range: XmlRange): Promise<string> {
    let local = "", colon = false;
    for await (const bytes of this.xml.read(range)) for (const byte of bytes) {
      if (byte === 58) { if (colon) return ""; colon = true; local = ""; }
      else if (byte === 95 || byte === 45 || byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122) {
        if (local.length <= 32) local += String.fromCharCode(byte);
      } else return "";
    }
    return local.length <= 32 ? local : "";
  }
  async equal(a: XmlRange, b: XmlRange): Promise<boolean> {
    if (a.length !== b.length) return false;
    for (let at = 0; at < a.length; at += 16384) {
      let left = new Uint8Array();
      for await (const bytes of this.xml.read({ start: a.start + at, length: Math.min(16384, a.length - at) })) left = new Uint8Array(bytes);
      for await (const bytes of this.xml.read({ start: b.start + at, length: left.length })) if (bytes.some((byte, index) => byte !== left[index])) return false;
    }
    return true;
  }
  async *elements(first: number, end: number, names: readonly string[], empty = false, openOnly = false, insensitive = false): AsyncGenerator<Element> {
    for (let index = first; index < end; index++) {
      const token = await this.token(index);
      if (token.kind !== "start-name") continue;
      const local = await this.name(token.range);
      if (!names.includes(insensitive ? local.toLowerCase() : local)) continue;
      const start = index;
      while (++index < end && (await this.token(index)).kind !== "start-end") { /* Attributes belong to this opening tag. */ }
      if (index >= end) return;
      const open = index, opening = await this.token(open);
      if (opening.empty || openOnly) {
        if (empty) yield { name: token.range, first: start, open, end: open, body: { start: opening.range.start, length: 0 } };
        continue;
      }
      let close = open + 1;
      for (; close < end; close++) {
        const candidate = await this.token(close);
        if (candidate.kind === "end-name" && await this.equal(token.range, candidate.range)) break;
      }
      if (close < end) {
        const closing = await this.token(close);
        yield { name: token.range, first: start, open, end: close, body: { start: opening.range.start, length: closing.range.start - 2 - opening.range.start } };
        index = close;
      }
    }
  }
  async attribute(element: Element, wanted: string, insensitive = false): Promise<XmlRange | undefined> {
    let name = "";
    for (let index = element.first + 1; index < element.open; index++) {
      const token = await this.token(index);
      if (token.kind === "attribute-name") name = await this.name(token.range);
      else if (token.kind === "attribute-value" && (insensitive ? name.toLowerCase() : name) === wanted) {
        for await (const bytes of this.xml.read({ start: token.range.start - 1, length: 1 })) if (bytes[0] === 34) return token.range;
      }
    }
    return undefined;
  }
}

/** Hash collision chains retain full keys in caller storage, never in a JS map. */
class SpanMap {
  private readonly buckets: IntegerTable;
  private readonly records: IntegerTable;
  private count = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) { this.buckets = new IntegerTable(storage); this.records = new IntegerTable(storage); }
  private async hash(key: SofficeSnapshot): Promise<bigint> {
    let hash = 2166136261;
    for (let at = 0; at < key.size; at += 16384) {
      this.signal.throwIfAborted();
      for (const byte of await this.storage.read(key.position + at, Math.min(16384, key.size - at))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    }
    return BigInt(hash);
  }
  async set(key: SofficeSnapshot, value: SofficeSnapshot): Promise<void> {
    const hash = await this.hash(key), next = await this.buckets.get(hash) ?? 0n, row = this.count++;
    for (const [field, number] of [key.position, key.size, value.position, value.size].entries()) await this.records.set(BigInt(row * 5 + field), BigInt(number));
    await this.records.set(BigInt(row * 5 + 4), next); await this.buckets.set(hash, BigInt(row + 1));
  }
  async get(key: SofficeSnapshot): Promise<SofficeSnapshot | undefined> {
    let next = await this.buckets.get(await this.hash(key)) ?? 0n;
    while (next) {
      const row = (next - 1n) * 5n, position = Number(await this.records.get(row)), size = Number(await this.records.get(row + 1n));
      let equal = size === key.size;
      for (let at = 0; equal && at < size; at += 16384) {
        this.signal.throwIfAborted();
        const left = new Uint8Array(await this.storage.read(position + at, Math.min(16384, size - at)));
        const right = await this.storage.read(key.position + at, left.length);
        equal = left.every((byte, index) => byte === right[index]);
      }
      if (equal) return { position: Number(await this.records.get(row + 2n)), size: Number(await this.records.get(row + 3n)) };
      next = await this.records.get(row + 4n) ?? 0n;
    }
    return undefined;
  }
}

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
    const indexed = new DocxXml(xml, storage, signal);
    try { await indexed.retain(); return indexed; } catch (error) { await xml.close().catch(() => {}); throw error; }
  };
  let document: SofficeSnapshot | undefined, rels: SofficeSnapshot | undefined, styles: SofficeSnapshot | undefined;
  const codec = createZipCodec(), limits = resolveOfficeResources({ archiveLimits: { chunkSize: 16384 } }).archiveLimits;
  await codec.readZipArchive({ size: source.size, read: (offset, maximum) => storage.read(source.position + offset, Math.min(16384, maximum, source.size - offset)) }, limits, signal, {
    storage, async onEntry(entry) {
      const selected = !!documentBlocks || entry.name === "word/document.xml" || entry.name === "word/_rels/document.xml.rels" || !!markup && entry.name === "word/styles.xml";
      const position = storage.allocate(0); let size = 0;
      for await (const bytes of codec.decodeZipEntry(entry, limits, signal)) if (selected) { await storage.append(bytes); size += bytes.length; }
      const span = { position, size };
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
  const addBlock = async (span: SofficeSnapshot, heading = false, image = false) => {
    if (documentBlocks) { if (!image) await documentBlocks.paragraph(span, heading); return; }
    if (!markup) { if (blocks++) await output.add(gap); await output.add(span); return; }
    if (html && image) return;
    await output.add(await literal(html ? heading ? "<h1>" : "<p>" : "<w:p>" + (heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : "") + "<w:r><w:t>"));
    await output.add(await escaped(span));
    await output.add(await literal(html ? heading ? "</h1>\n" : "</p>\n" : "</w:t></w:r></w:p>"));
  };
  const text = async (element: Element): Promise<SofficeSnapshot> => {
    const runs = new RetainedSpans(storage, signal);
    for await (const run of xml.elements(element.open + 1, element.end, ["t", "tab", "br", "cr"], true)) {
      const name = await xml.name(run.name);
      if (name === "t" && run.end !== run.open) await runs.add(await retainXmlText(storage, xml.xml.read(run.body), signal, false));
      else if (name !== "t" && run.end === run.open) await runs.add(name === "tab" ? tab : await literal(" "));
    }
    const joined = await runs.finish(), decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    let first = -1, last = 0, offset = 0;
    const inspect = (text: string) => { for (const char of text) { const point = char.codePointAt(0)!, size = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; if (char.trim()) { if (first < 0) first = offset; last = offset + size; } offset += size; } };
    for await (const bytes of read(joined)) inspect(decoder.decode(bytes, { stream: true })); inspect(decoder.decode());
    return { position: joined.position + Math.max(0, first), size: first < 0 ? 0 : last - first };
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
  const attributeIn = async (owner: DocxXml, element: Element, tag: string, insensitive = false) => {
    for await (const child of owner.elements(element.open + 1, element.end, [tag], true, true, insensitive)) {
      const range = await owner.attribute(child, "val", insensitive); if (range?.length) return range;
    }
    return undefined;
  };
  const fontSize = async (owner: DocxXml, element: Element, insensitive = false) => {
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
  let failed = true;
  try {
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
    const heading = async (block: Element) => {
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
              await table.add(await escaped(await text(cell)));
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
        const value = await text(block); if (value.size) await addBlock(value, await heading(block));
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
    if (markup) await output.add(await literal(html ? "</body></html>\n" : docxDocumentSuffix));
    const result = await output.finish(); failed = false; return result;
  } finally { await xml.xml.close().catch(error => { if (!failed) throw error; }); }
}
