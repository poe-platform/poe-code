import { decodePdfString, decodeStoredPdfString, type PdfCosNode, type PdfCosDict } from "../ast.js";
import { readRawPdfDictionaryEntries, readPdfDictionaryValue } from "../content/stored-dictionary.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";
import type { PdfRawTextIndex, PdfStoredTextLine, PdfStoredTextWord } from "./raw-text-index.js";

export interface PdfHtmlPageTextOptions {
  readonly xml?: boolean;
  readonly zoom?: number;
  readonly height: number;
  readonly signal?: AbortSignal;
  /** Image markup belongs after XML font definitions and before page text. */
  readonly images?: () => AsyncIterable<string>;
}
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Format styled text with replayable caller-backed word and font indexes.
 * The caller owns the document and text index throughout consumption. */
export async function* streamHtmlPageText(document: PdfRetainedDocument, page: PdfRetainedPage, index: PdfRawTextIndex,
  storage: PdfIndexStorage, options: PdfHtmlPageTextOptions): AsyncGenerator<string, void, void> {
  const { signal, xml = false, height } = options, zoom = options.zoom ?? 1;
  signal?.throwIfAborted();
  const names = xml ? new PdfNameIndex(storage, Infinity, signal) : undefined;
  let failed = false;
  async function* chunks(text: string) {
    for (let at = 0; at < text.length; at += 2048) {
      if (at && at % 65536 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted(); yield text.slice(at, at + 2048);
    }
  }
  async function* rawName(word: PdfStoredTextWord | undefined) {
    if (!word?.fontName) { yield "Helvetica"; return; }
    let first = true;
    for await (let text of word.fontName()) {
      signal?.throwIfAborted();
      if (first && text.length) { first = false; if (!xml && text.startsWith("/")) text = text.slice(1); }
      yield text;
    }
  }
  async function matches(word: PdfStoredTextWord | undefined, name: string) {
    let at = 0;
    for await (const part of rawName(word)) { if (name.slice(at, at + part.length) !== part) return false; at += part.length; }
    return at === name.length;
  }
  async function value(dict: PdfCosDict, key: string) {
    return (await document.lookup(await readPdfDictionaryValue(dict, key, signal, { preserveDeferred: true })))?.value;
  }
  const resources = (await page.attributes()).resources;
  const fonts = await value(resources, "Font");
  async function* family(word: PdfStoredTextWord | undefined) {
    let selected: PdfCosNode | undefined, work = 0;
    if (fonts?.kind === "dict") for await (const entry of readRawPdfDictionaryEntries(fonts, signal)) {
      if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      if (!await matches(word, entry.key.decoded)) continue;
      const definition = (await document.lookup(entry.value))?.value;
      const base = definition?.kind === "dict" ? await document.lookup(
        await readPdfDictionaryValue(definition, "BaseFont", signal, { preserveDeferred: true })
          ?? await readPdfDictionaryValue(definition, "Name", signal, { preserveDeferred: true })) : undefined;
      // XML's resource map ignores invalid entries; HTML's direct dictionary
      // lookup selects the final entry even when it has no usable family.
      if (!xml || base?.value.kind === "name" || base?.value.kind === "string") selected = base?.value;
    }
    if (selected?.kind === "name") yield* chunks(selected.decoded);
    else if (selected?.kind === "string") {
      if (selected.storedBytes) yield* decodeStoredPdfString(selected.storedBytes, signal);
      else yield* chunks(decodePdfString(selected));
    } else yield* rawName(word);
  }
  async function firstWord(line: PdfStoredTextLine) { for await (const word of line.words()) return word; }
  async function* fontKey(word: PdfStoredTextWord | undefined, size: number) {
    for await (const part of family(word)) for (let i = 0; i < part.length; i++) yield part.charCodeAt(i);
    for (const char of `:${size}`) yield char.charCodeAt(0);
  }
  try {
    if (names) {
      const defaultSize = Math.round(12 * zoom);
      await names.intern(`Helvetica:${defaultSize}`);
      yield `    <fontspec id="0" size="${defaultSize}" family="Helvetica" color="#000000"/>\n`;
      for await (const block of index.blocks()) for await (const line of block.lines()) {
        signal?.throwIfAborted();
        const word = await firstWord(line), size = Math.max(1, Math.round((word?.fontSize ?? 12) * zoom));
        const identity = await names.intern(fontKey(word, size));
        if (!identity.added) continue;
        yield `    <fontspec id="${identity.index}" size="${size}" family="`;
        for await (const part of family(word)) yield escape(part);
        yield '" color="#000000"/>\n';
      }
    }
    if (options.images) yield* options.images();
    for await (const block of index.blocks()) for await (const line of block.lines()) {
      signal?.throwIfAborted();
      const [x0, y0, x1, y1] = line.bbox, top = Math.max(0, Math.round((height - y1) * zoom)), left = Math.max(0, Math.round(x0 * zoom));
      const word = await firstWord(line);
      let bold = false, italic = false, tail = "";
      for await (const part of family(word)) {
        const text = tail + part.toLowerCase(); bold ||= text.includes("bold"); italic ||= text.includes("italic") || text.includes("oblique"); tail = text.slice(-6);
      }
      let uri: string | undefined;
      for await (const annotation of page.annotations()) {
        const rect = annotation.rect;
        if (annotation.uri && Math.min(x1, Math.max(rect[0], rect[2])) > Math.max(x0, Math.min(rect[0], rect[2]))
          && Math.min(y1, Math.max(rect[1], rect[3])) > Math.max(y0, Math.min(rect[1], rect[3]))) { uri = annotation.uri; break; }
      }
      if (names) {
        const size = Math.max(1, Math.round((word?.fontSize ?? 12) * zoom)), identity = await names.intern(fontKey(word, size));
        yield `    <text top="${top}" left="${left}" width="${Math.max(1, Math.round((x1 - x0) * zoom))}" height="${Math.max(1, Math.round((y1 - y0) * zoom))}" font="${identity.index}">`;
      } else yield `  <p style="position:absolute;top:${top}pt;left:${left}pt;margin:0;">`;
      if (uri) { yield '<a href="'; for await (const part of chunks(uri)) yield escape(part); yield '">'; }
      if (bold) yield "<b>"; if (italic) yield "<i>";
      let first = true;
      for await (const word of line.words()) {
        if (!first) yield " "; first = false;
        for await (const part of word.text()) { signal?.throwIfAborted(); yield escape(part); }
      }
      if (italic) yield "</i>"; if (bold) yield "</b>"; if (uri) yield "</a>";
      yield names ? "</text>\n" : "</p>\n";
    }
  } catch (error) { failed = true; throw error; }
  finally { await names?.close().catch(error => { if (!failed) throw error; }); }
}
