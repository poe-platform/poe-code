import { PDFDocument, rgb, PDFName, PDFDict, PDFHexString, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit, {type Font} from "@pdf-lib/fontkit";
import {admitCharacterMaps, admitMetricTables} from "./font-admission.js";
import {decodePng} from "./png.js";
import {imageBox} from "./image-box.js";
import type { LayoutDocument, Paragraph, PdfContext, PdfLimits, TextRun } from "./model.js";
export type * from "./model.js";
import {PdfError} from "./errors.js";
import {pdfTextString} from "./text-string.js";
import {serializePdf} from "./serialization.js";
export {PdfError} from "./errors.js";
export function pdfCapabilities() {
  return {profile: "PDF-1.7-supplied-fonts-ltr", reference: "Adobe PDF Reference sixth edition, November 2006", scripts: ["Latin", "Greek", "Cyrillic"], fonts: ["sfnt-TrueType-glyf"], png: "static-noninterlaced-8bit", jpeg: "8bit-gray-rgb-adobe-cmyk", images: ["png", "jpeg"], tables: "rectangular-unspanned", encryption: false, javascript: false, attachments: false, accessibility: {tagged: false, readingOrder: "not-guaranteed", pdfUA: false}, conformance: {pdfA: false}, text: {unicodeMapping: "supported-scalars", extraction: "not-guaranteed", searchable: "not-guaranteed"}} as const;
}
export const defaultPdfLimits: Readonly<PdfLimits> = Object.freeze({fontBytes: 4_000_000, fonts: 8, glyphs: 100_000, pages: 200, objects: 100_000, images: 100, imageBytes: 8_000_000, decodedImageBytes: 32_000_000, layoutWork: 500_000, outputBytes: 16_000_000});
function unsupported(message: string): never { throw new PdfError("E_CAPABILITY", message); }
function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }
interface Glyph { text: string; font: PDFFont; size: number; width: number; ascent: number; descent: number; link?: string }
interface Line { glyphs: Glyph[]; height: number; ascent: number; descent: number }
function emptyLine(): Line {return {glyphs: [], height: 14.4, ascent: 0, descent: 0};}
export async function renderPdf(document: LayoutDocument, context: PdfContext = {}): Promise<Uint8Array> {
  const limits = {...defaultPdfLimits, ...context.limits};
  const usage = Object.fromEntries(Object.keys(defaultPdfLimits).map(key => [key, 0])) as Record<keyof PdfLimits, number>;
  const check = () => { if (context.signal?.aborted) throw new PdfError("E_CANCELLED", "PDF cancelled"); };
  const charge = (key: keyof PdfLimits, amount: number) => {
    check();
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(limits[key]) || limits[key] < 0 || amount > limits[key] - usage[key]) throw new PdfError("E_LIMIT", `PDF ${key} limit exceeded`);
    context.charge?.(key, amount); usage[key] += amount;
  };
  const cooperate = async () => { check(); if (context.yield) await context.yield(); else await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); };
  check();
  const box = document.page ?? {width: 595.28, height: 841.89, margin: 48};
  if (![box.width, box.height].every(positive) || !Number.isFinite(box.margin) || box.margin < 0 || box.width <= box.margin * 2 || box.height <= box.margin * 2) unsupported("Invalid page box");
  if (!document.fonts.length) unsupported("Supply at least one font");
  // Admit all fonts before parsing; never query the filesystem or system fonts.
  const ids = new Set<string>();
  for (const font of document.fonts) {
    if (!font.id || ids.has(font.id)) unsupported("Duplicate/empty font identity");
    ids.add(font.id); charge("fonts", 1); charge("fontBytes", font.bytes.length); charge("objects", 8);
    if (font.bytes.length < 12) unsupported("Supply an sfnt TrueType/OpenType font");
    const signature = new DataView(font.bytes.buffer, font.bytes.byteOffset, font.bytes.byteLength).getUint32(0);
    if (signature !== 0x00010000) unsupported("Only sfnt TrueType glyf fonts are supported; CFF and compressed containers are forbidden");
    const view = new DataView(font.bytes.buffer, font.bytes.byteOffset, font.bytes.byteLength);
    const count = view.getUint16(4);
    if (!count || count > 128 || 12 + count * 16 > font.bytes.length) unsupported("Invalid sfnt table directory");
    const tags = new Set<number>(); const regions: {start: number; end: number}[] = [];
    const tables = new Map<number, {start: number; length: number}>();
    for (let i = 0; i < count; i++) {
      charge("layoutWork", 1);
      const record = 12 + i * 16; const tag = view.getUint32(record); const start = view.getUint32(record + 8); const length = view.getUint32(record + 12);
      if (tags.has(tag) || start < 12 + count * 16 || start + length > font.bytes.length || regions.some(r => start < r.end && start + length > r.start)) unsupported("Invalid sfnt table range");
      tags.add(tag); regions.push({start, end: start + length});
      tables.set(tag, {start, length});
      if (tag === 0x636d6170) admitCharacterMaps(view, start, length, unsupported, amount => charge("layoutWork", amount));
    }
    if (!tags.has(0x636d6170)) unsupported("Missing font character map");
    if (!tags.has(0x676c7966) || !tags.has(0x6c6f6361)) unsupported("Only TrueType glyf outline programs are supported");
    admitMetricTables(view, tables, unsupported, amount => charge("layoutWork", amount));
  }
  const pdf = await PDFDocument.create({updateMetadata: false}); pdf.registerFontkit(fontkit);
  const textString = (text: string) => pdfTextString(text, limits.outputBytes, amount => charge("layoutWork", amount));
  charge("objects", 2); // catalog and page-tree root created by pdf-lib
  const info = pdf.context.obj({Producer: textString("poe-code PDF"), Creator: textString("poe-code PDF")});
  for (const [key, field] of [["title", "Title"], ["author", "Author"], ["subject", "Subject"]] as const) {
    const value = document.metadata?.[key]; if (value !== undefined) info.set(PDFName.of(field), textString(value));
  }
  if (document.metadata?.keywords) {
    const length = document.metadata.keywords.reduce((sum, word) => sum + word.length + 1, 0);
    charge("layoutWork", length);
    if (!Number.isSafeInteger(length) || length > limits.outputBytes / 4) throw new PdfError("E_LIMIT", "PDF keywords exceed output budget");
    info.set(PDFName.of("Keywords"), textString(document.metadata.keywords.join(" ")));
  }
  charge("objects", 1); pdf.context.trailerInfo.Info = pdf.context.register(info);
  const outlines: {title: PDFHexString; page: PDFPage; y: number}[] = [];
  const fonts = new Map<string, PDFFont>();
  const parsedFonts = new Map<PDFFont, Font>();
  try {
    for (const resource of document.fonts) {
      const bytes = new Uint8Array(resource.bytes); const parsed = fontkit.create(bytes);
      if (!positive(parsed.unitsPerEm) || !Number.isInteger(parsed.numGlyphs) || parsed.numGlyphs < 1 || parsed.numGlyphs > 65535) unsupported("Invalid font metrics");
      pdf.registerFontkit({create: () => parsed});
      const font = await pdf.embedFont(bytes, {subset: false}); fonts.set(resource.id, font); parsedFonts.set(font, parsed); await cooperate();
    }
  } catch (error) { if (error instanceof PdfError) throw error; unsupported("Invalid or unsupported supplied font"); }
  const coverage = new Map([...fonts.values()].map(font => [font, new Set(font.getCharacterSet())]));
  const glyph = (text: string, run: TextRun): Glyph => {
    charge("glyphs", 1); charge("layoutWork", 1);
    const cp = text.codePointAt(0)!;
    if (!(cp >= 32 && cp <= 126 || cp >= 160 && cp <= 255 || cp >= 0x370 && cp <= 0x52f) || cp >= 0x483 && cp <= 0x489) unsupported("Unsupported script or combining sequence");
    const candidates = run.font === undefined ? [...fonts.values()] : [fonts.get(run.font), ...fonts.values()];
    if (run.font !== undefined && !fonts.has(run.font)) unsupported("Unknown font identity");
    const font = candidates.find(candidate => candidate && coverage.get(candidate)!.has(cp) && parsedFonts.get(candidate)!.glyphForCodePoint(cp).id > 0);
    if (!font) unsupported(`No supplied font covers U+${cp.toString(16)}`);
    const size = run.size ?? 12; if (!positive(size) || size > 144) unsupported("Invalid font size");
    if (run.link !== undefined) { let url: URL; try { url = new URL(run.link); } catch { unsupported("Invalid link"); } if (!["https:", "http:", "mailto:"].includes(url.protocol)) unsupported("Unsafe link scheme"); }
    const width = font.widthOfTextAtSize(text, size);
    if (!positive(width)) unsupported(`Nonadvancing glyph U+${cp.toString(16)}`);
    const parsed = parsedFonts.get(font)!;
    const ascent = parsed.ascent / parsed.unitsPerEm * size; const descent = -parsed.descent / parsed.unitsPerEm * size;
    if (!positive(ascent) || !Number.isFinite(descent) || descent < 0) unsupported("Invalid vertical font metrics");
    return {text, font, size, width, ascent, descent, ...(run.link === undefined ? {} : {link: run.link})};
  };
  const lines = async (block: Paragraph, width: number): Promise<Line[]> => {
    charge("layoutWork", 1);
    if (!positive(width)) unsupported("Nonadvancing text box");
    const result: Line[] = []; let line = emptyLine(); let used = 0;
    let word: Glyph[] = []; let wordWidth = 0;
    const flush = () => {
      if (wordWidth > width && block.longWord === "error") unsupported("Unbreakable word exceeds text box");
      if (used + wordWidth > width && line.glyphs.length) {result.push(line); line = emptyLine(); used = 0;}
      for (const g of word) {
        if (used + g.width > width && line.glyphs.length) {result.push(line); line = emptyLine(); used = 0;}
        used += g.width; line.ascent = Math.max(line.ascent, g.ascent); line.descent = Math.max(line.descent, g.descent);
        line.height = Math.max(line.height, g.size * 1.2, line.ascent + line.descent); line.glyphs.push(g);
      }
      word = []; wordWidth = 0;
    };
    for (const run of block.runs) for (const scalar of run.text) {
      charge("layoutWork", 1);
      if (scalar === "\n") { flush(); result.push(line); line = emptyLine(); used = 0; continue; }
      const g = glyph(scalar === "\t" ? " " : scalar, run);
      if (g.width > width) unsupported("Glyph wider than text box");
      word.push(g); wordWidth += g.width;
      if (scalar === " " || scalar === "\t") flush();
      if (usage.layoutWork % 256 === 0) await cooperate();
    }
    flush(); if (line.glyphs.length || !result.length) result.push(line);
    return result;
  };
  let page: PDFPage; let top = box.margin;
  const newPage = () => { charge("pages", 1); charge("objects", 3); page = pdf.addPage([box.width, box.height]); top = box.margin; };
  const usableHeight = box.height - 2 * box.margin;
  const room = (height: number) => { if (height > usableHeight) unsupported("Indivisible layout exceeds page"); if (top + height > box.height - box.margin) newPage(); };
  const draw = (line: Line, x: number, baselineTop: number) => {
    context.onPlacement?.({kind: "text", page: usage.pages, x, y: baselineTop, width: line.glyphs.reduce((sum, g) => sum + g.width, 0), height: line.height, text: line.glyphs.map(g => g.text).join("")});
    for (const g of line.glyphs) {
      charge("objects", 1); charge("layoutWork", 1);
      page.drawText(g.text, {x, y: box.height - baselineTop - line.ascent, size: g.size, font: g.font});
      if (g.link) { charge("objects", 1); const ref = pdf.context.register(pdf.context.obj({Type: "Annot", Subtype: "Link", Rect: [x, box.height - baselineTop - line.height, x + g.width, box.height - baselineTop], Border: [0, 0, 0], A: {Type: "Action", S: "URI", URI: textString(g.link)}})); page.node.addAnnot(ref); }
      x += g.width;
    }
  };
  newPage();
  for (let blockIndex = 0; blockIndex < document.blocks.length; blockIndex++) {
    const block = document.blocks[blockIndex]!;
    charge("layoutWork", 1); if (block.breakBefore && top > box.margin) newPage();
    if (block.kind === "paragraph") {
      const indent = block.indent ?? 0; if (!Number.isFinite(indent) || indent < 0) unsupported("Invalid indent");
      const prepared = await lines(block, box.width - 2 * box.margin - indent);
      const height = prepared.reduce((sum, line) => sum + line.height, 0);
      const widows = block.widows ?? 2; const orphans = block.orphans ?? 2;
      if (![widows, orphans].every(n => Number.isSafeInteger(n) && n >= 1)) unsupported("Invalid widow/orphan rules");
      const next = document.blocks[blockIndex + 1];
      if (block.keepWithNext && next) {
        if (next.breakBefore) unsupported("keepWithNext conflicts with breakBefore");
        let nextHeight = 0;
        if (next.kind === "paragraph") {
          const nextLines = await lines(next, box.width - 2 * box.margin - (next.indent ?? 0));
          nextHeight = (next.keepTogether ? nextLines : nextLines.slice(0, next.orphans ?? 2)).reduce((s, l) => s + l.height, 0);
        } else if (next.kind === "image") nextHeight = imageBox(next, box, unsupported, () => charge("layoutWork", 1)).height;
        else {
          for (const row of next.rows.slice(0, (next.headerRows ?? 0) + 1)) {
            let rowHeight = 0;
            for (let i = 0; i < row.length; i++) {
              const cellLines = await lines(row[i]!, (box.width - 2 * box.margin) * next.widths[i]! - 8);
              rowHeight = Math.max(rowHeight, cellLines.reduce((s, l) => s + l.height, 8));
            }
            nextHeight += rowHeight;
          }
        }
        const needed = height + (block.spaceAfter ?? 8) + nextHeight;
        room(needed);
      } else if (block.keepTogether) room(height);
      let cursor = 0;
      while (cursor < prepared.length) {
        let count = 0; let available = box.height - box.margin - top;
        while (cursor + count < prepared.length && prepared[cursor + count]!.height <= available) {available -= prepared[cursor + count]!.height; count++;}
        const remaining = prepared.length - cursor;
        if (count < remaining) {
          if (remaining - count < widows) count = Math.max(0, remaining - widows);
          if (count < orphans && top > box.margin) count = 0;
        }
        if (!count) { if (top > box.margin) {newPage(); continue;} room(prepared[cursor]!.height); count = 1; }
        if (cursor === 0 && block.outline !== undefined) {
          charge("objects", outlines.length ? 1 : 2);
          outlines.push({title: textString(block.outline), page: page!, y: box.height - top});
        }
        for (let i = 0; i < count; i++) {const line = prepared[cursor++]!; draw(line, box.margin + indent, top); top += line.height;}
        if (cursor < prepared.length) newPage();
        await cooperate();
      }
      const after = block.spaceAfter ?? 8; if (!Number.isFinite(after) || after < 0) unsupported("Invalid paragraph spacing"); top += after;
    } else if (block.kind === "table") {
      if (!block.widths.length || !block.widths.every(positive) || Math.abs(block.widths.reduce((a, b) => a + b, 0) - 1) > 0.000001) unsupported("Invalid table widths");
      const preparedRows: {cells: Line[][]; height: number}[] = [];
      for (const row of block.rows) {
        if (row.length !== block.widths.length) unsupported("Nonrectangular table");
        const cells: Line[][] = [];
        for (let i = 0; i < row.length; i++) cells.push(await lines(row[i]!, (box.width - 2 * box.margin) * block.widths[i]! - 8));
        const height = Math.max(8, ...cells.map(cell => cell.reduce((sum, line) => sum + line.height, 8))); preparedRows.push({cells, height});
      }
      if (block.keepTogether) room(preparedRows.reduce((sum, row) => sum + row.height, 0));
      const headerCount = block.headerRows ?? 0;
      if (!Number.isSafeInteger(headerCount) || headerCount < 0 || headerCount > preparedRows.length) unsupported("Invalid table header count");
      const headers = preparedRows.slice(0, headerCount);
      const headerHeight = headers.reduce((s, r) => s + r.height, 0);
      if (headerHeight >= usableHeight) unsupported("Table headers leave no body space");
      const drawRow = (cells: Line[][], height: number) => {
        let x = box.margin;
        for (let i = 0; i < cells.length; i++) {
          const width = (box.width - 2 * box.margin) * block.widths[i]!; charge("objects", 1);
          context.onPlacement?.({kind: "cell", page: usage.pages, x, y: top, width, height});
          page!.drawRectangle({x, y: box.height - top - height, width, height, borderWidth: 0.5, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0)});
          let offset = top + 4; for (const line of cells[i]!) { draw(line, x + 4, offset); offset += line.height; } x += width;
        }
        top += height;
      };
      const continuation = () => {newPage(); for (const h of headers) drawRow(h.cells, h.height);};
      // Start headers with at least one body line, avoiding a header-only page.
      if (preparedRows.length > headerCount) room(headerHeight + Math.max(...preparedRows[headerCount]!.cells.map(cell => (cell[0]?.height ?? 0) + 8)));
      for (let r = 0; r < preparedRows.length; r++) {
        const row = preparedRows[r]!;
        if (r < headerCount) {drawRow(row.cells, row.height); continue;}
        if (block.rowSplit !== "lines") {
          if (row.height + headerHeight > usableHeight) unsupported("Table row exceeds page with headers");
          if (top + row.height > box.height - box.margin) continuation();
          drawRow(row.cells, row.height);
        } else {
          const cursors = row.cells.map(() => 0);
          while (row.cells.some((cell, i) => cursors[i]! < cell.length)) {
            charge("layoutWork", 1);
            const capacity = box.height - box.margin - top - 8;
            const fragments = row.cells.map((cell, i) => {
              const fragment: Line[] = []; let used = 0;
              while (cursors[i]! < cell.length && used + cell[cursors[i]!]!.height <= capacity) {const line = cell[cursors[i]!]!; used += line.height; fragment.push(line); cursors[i]!++;}
              return fragment;
            });
            if (!fragments.some(cell => cell.length)) {
              const minimum = Math.max(...row.cells.map((cell, i) => cell[cursors[i]!] ?.height ?? 0));
              if (minimum + 8 + headerHeight > usableHeight) unsupported("Table line exceeds page with headers");
              continuation(); continue;
            }
            drawRow(fragments, Math.max(...fragments.map(cell => cell.reduce((s, l) => s + l.height, 8))));
            if (row.cells.some((cell, i) => cursors[i]! < cell.length)) continuation();
            await cooperate();
          }
        }
      }
      top += 8;
    } else if (block.kind === "image") {
      charge("images", 1); charge("imageBytes", block.bytes.length); charge("objects", 3);
      const bytes = block.bytes;
      const {width, height, pixels} = imageBox(block, box, unsupported, () => charge("layoutWork", 1));
      if (pixels > 4_000_000) throw new PdfError("E_LIMIT", "Image pixel limit exceeded");
      charge("decodedImageBytes", pixels * 16 + 65536);
      let imageRef;
      if (block.media === "png") {
        const decoded = decodePng(bytes, amount => charge("layoutWork", amount));
        const mask = decoded.alpha === undefined ? undefined : pdf.context.register(pdf.context.flateStream(decoded.alpha, {Type: "XObject", Subtype: "Image", Width: decoded.width, Height: decoded.height, BitsPerComponent: 8, ColorSpace: "DeviceGray"}));
        imageRef = pdf.context.register(pdf.context.flateStream(decoded.rgb, {Type: "XObject", Subtype: "Image", Width: decoded.width, Height: decoded.height, BitsPerComponent: 8, ColorSpace: "DeviceRGB", SMask: mask}));
      } else {
        try {imageRef = (await pdf.embedJpg(new Uint8Array(bytes))).ref;}
        catch {unsupported("Invalid image bytes");}
      }
      room(height);
      context.onPlacement?.({kind: "image", page: usage.pages, x: box.margin, y: top, width, height});
      const key = page!.node.newXObject("Image", imageRef);
      page!.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, box.margin, box.height - top - height), drawObject(key), popGraphicsState());
      top += height + 8;
    } else unsupported("Unknown layout block");
    await cooperate();
  }
  check();
  if (outlines.length) {
    const root = pdf.context.obj({Type: "Outlines", Count: outlines.length}); const rootRef = pdf.context.register(root);
    const entries: PDFDict[] = outlines.map(entry => pdf.context.obj({Title: entry.title, Parent: rootRef, Dest: [entry.page.ref, "XYZ", null, entry.y, null]}));
    const refs = entries.map(entry => pdf.context.register(entry));
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) entries[i]!.set(PDFName.of("Prev"), refs[i - 1]!);
      if (i + 1 < entries.length) entries[i]!.set(PDFName.of("Next"), refs[i + 1]!);
    }
    root.set(PDFName.of("First"), refs[0]!); root.set(PDFName.of("Last"), refs[refs.length - 1]!);
    pdf.catalog.set(PDFName.of("Outlines"), rootRef);
  }
  // Uncompressed object syntax makes the restricted profile independently inspectable.
  await pdf.flush(); check();
  const bytes = await serializePdf(pdf.context, {outputBytes: limits.outputBytes, objects: limits.objects, reserveOutput: amount => charge("outputBytes", amount), work: () => charge("layoutWork", 1), cooperate}); check();
  // pdf-lib writes its fixed 1.7 header; no catalog APIs expose active content here.
  if (pdf.catalog.has(PDFName.of("OpenAction"))) unsupported("Active content forbidden");
  return bytes;
}

export { suppliedDefaultFont } from "./default-font.js";
