import { PDFDocument, StandardFonts, rgb, PDFName, PDFDict, PDFHexString, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor, type PDFFont, type PDFPage } from "pdf-lib";
import type {Font} from "@pdf-lib/fontkit";
import { setTextRenderingMode, TextRenderingMode, setLineWidth, setStrokingRgbColor } from "pdf-lib";
import {admitTrueTypeFont} from "./font-admission.js";
import {decodePng} from "./png.js";
import {imageBox} from "./image-box.js";
import type { LayoutDocument, Paragraph, PdfContext, PdfLimits, TextRun } from "./model.js";
export type * from "./model.js";
import {PdfError} from "./errors.js";
import {pdfTextString} from "./text-string.js";
import {serializePdf} from "./serialization.js";
export {PdfError} from "./errors.js";
export {serializePdf} from "./serialization.js";
export {decodePng} from "./png.js";
export function pdfCapabilities() {
  return {profile: "PDF-1.7-supplied-fonts-ltr", reference: "Adobe PDF Reference sixth edition, November 2006", scripts: ["Latin", "Greek", "Cyrillic"], fonts: ["sfnt-TrueType-glyf", "standard-14"], png: "static-noninterlaced-8bit", jpeg: "8bit-gray-rgb-adobe-cmyk", images: ["png", "jpeg"], tables: "rectangular-unspanned", encryption: false, javascript: false, attachments: false, accessibility: {tagged: false, readingOrder: "not-guaranteed", pdfUA: false}, conformance: {pdfA: false}, text: {unicodeMapping: "supported-scalars", extraction: "not-guaranteed", searchable: "not-guaranteed"}} as const;
}
export const defaultPdfLimits: Readonly<PdfLimits> = Object.freeze({fontBytes: Infinity, fonts: Infinity, glyphs: Infinity, pages: Infinity, objects: Infinity, images: Infinity, imageBytes: Infinity, imagePixels: Infinity, decodedImageBytes: Infinity, layoutWork: Infinity, outputBytes: Infinity});
function unsupported(message: string): never { throw new PdfError("E_CAPABILITY", message); }
function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }
interface Glyph { text: string; code: string; font: PDFFont; size: number; width: number; ascent: number; descent: number; link?: string; bold: boolean; italic: boolean; strikeout: boolean; underline: boolean }
interface Line { glyphs: Glyph[]; height: number; ascent: number; descent: number }
function emptyLine(): Line {return {glyphs: [], height: 14.4, ascent: 0, descent: 0};}
export async function renderPdf(document: LayoutDocument, context: PdfContext = {}): Promise<Uint8Array> {
  const limits = {...defaultPdfLimits, ...context.limits};
  const usage = Object.fromEntries(Object.keys(defaultPdfLimits).map(key => [key, 0])) as Record<keyof PdfLimits, number>;
  const check = () => { if (context.signal?.aborted) throw new PdfError("E_CANCELLED", "PDF cancelled"); };
  const charge = (key: keyof PdfLimits, amount: number) => {
    check();
    if (!Number.isSafeInteger(amount) || amount < 0 || (limits[key] !== Infinity && !Number.isSafeInteger(limits[key])) || limits[key] < 0 || amount > limits[key] - usage[key]) throw new PdfError("E_LIMIT", `PDF ${key} limit exceeded`);
    context.charge?.(key, amount); usage[key] += amount;
  };
  const cooperate = async () => { check(); if (context.yield) await context.yield(); else await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); };
  check();
  for (const key of Object.keys(defaultPdfLimits) as (keyof PdfLimits)[]) {
    if ((limits[key] !== Infinity && !Number.isSafeInteger(limits[key])) || limits[key] < 0) throw new PdfError("E_LIMIT", `Invalid PDF ${key} budget`);
  }
  const box = document.page ?? {width: 595.28, height: 841.89, margin: 48};
  const lineHeight = document.lineHeight ?? 1.2;
  if (!Number.isFinite(lineHeight) || lineHeight < 1 || lineHeight > 3) unsupported("Invalid line-height multiplier");
  if (![box.width, box.height].every(positive) || !Number.isFinite(box.margin) || box.margin < 0 || box.width <= box.margin * 2 || box.height <= box.margin * 2) unsupported("Invalid page box");
  if (!document.fonts.length) unsupported("Supply at least one font");
  // Admit all fonts before parsing; never query the filesystem or system fonts.
  const ids = new Set<string>();
  for (const font of document.fonts) {
    if (!font.id || ids.has(font.id)) unsupported("Duplicate/empty font identity");
    ids.add(font.id); charge("fonts", 1); charge("objects", 8);
    if ("standard" in font) {
      if (!Object.values(StandardFonts).includes(font.standard as StandardFonts)) unsupported("Unknown standard font");
    } else {
      charge("fontBytes", font.bytes.length);
      admitTrueTypeFont(font.bytes, unsupported, amount => charge("layoutWork", amount));
    }
  }
  const pdf = await PDFDocument.create({updateMetadata: false});
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
      if ("standard" in resource) {
        fonts.set(resource.id, await pdf.embedFont(resource.standard as StandardFonts));
        await cooperate(); continue;
      }
      const fontkit = (await import("@pdf-lib/fontkit")).default; const bytes = new Uint8Array(resource.bytes); const parsed = fontkit.create(bytes);
      if (!positive(parsed.unitsPerEm) || !Number.isInteger(parsed.numGlyphs) || parsed.numGlyphs < 1 || parsed.numGlyphs > 65535) unsupported("Invalid font metrics");
      pdf.registerFontkit({create: () => parsed});
      const font = await pdf.embedFont(bytes, {subset: false}); fonts.set(resource.id, font); parsedFonts.set(font, parsed); await cooperate();
    }
  } catch (error) { if (error instanceof PdfError) throw error; unsupported("Invalid or unsupported supplied font"); }
  const emittedScalars = new Map<PDFFont, Map<string, number>>();
  const coverage = new Map([...fonts.values()].map(font => [font, new Set(font.getCharacterSet())]));
  const glyph = (text: string, run: TextRun): Glyph => {
    charge("glyphs", 1); charge("layoutWork", 1);
    const cp = text.codePointAt(0)!;
    if (!(cp >= 32 && cp <= 126 || cp >= 160 && cp <= 255 || cp >= 0x370 && cp <= 0x52f) || cp >= 0x483 && cp <= 0x489) unsupported("Unsupported script or combining sequence");
    const candidates = run.font === undefined ? [...fonts.values()] : [fonts.get(run.font), ...fonts.values()];
    if (run.font !== undefined && !fonts.has(run.font)) unsupported("Unknown font identity");
    const font = candidates.find(candidate => candidate && coverage.get(candidate)!.has(cp) && (!parsedFonts.has(candidate) || parsedFonts.get(candidate)!.glyphForCodePoint(cp).id > 0));
    if (!font) unsupported(`No supplied font covers U+${cp.toString(16)}`);
    const parsed = parsedFonts.get(font);
    const parsedGlyph = parsed?.glyphForCodePoint(cp);
    if (parsedGlyph && (!Number.isInteger(parsedGlyph.id) || parsedGlyph.id <= 0 || parsedGlyph.id >= parsed!.numGlyphs)) unsupported("Font character map points outside glyph records");
    const encoded = parsedGlyph ? parsedGlyph.id.toString(16).padStart(4, "0").toUpperCase() : font.encodeText(text).asString();
    let scalars = emittedScalars.get(font);
    if (!scalars) {scalars = new Map(); emittedScalars.set(font, scalars);}
    const previous = scalars.get(encoded);
    if (previous !== undefined && previous !== cp) unsupported("Conflicting Unicode scalars share an emitted font glyph");
    scalars.set(encoded, cp);
    const size = run.size ?? 12; if (!positive(size) || size > 144) unsupported("Invalid font size");
    if (run.link !== undefined) { let url: URL; try { url = new URL(run.link); } catch { unsupported("Invalid link"); } if (!["https:", "http:", "mailto:"].includes(url.protocol)) unsupported("Unsafe link scheme"); }
    const width = parsedGlyph ? parsedGlyph.advanceWidth / parsed!.unitsPerEm * size : font.widthOfTextAtSize(text, size);
    if (!positive(width)) unsupported(`Nonadvancing glyph U+${cp.toString(16)}`);
    const ascent = parsed ? parsed.ascent / parsed.unitsPerEm * size : font.heightAtSize(size, {descender: false});
    const descent = parsed ? -parsed.descent / parsed.unitsPerEm * size : font.heightAtSize(size) - ascent;
    if (!positive(ascent) || !Number.isFinite(descent) || descent < 0) unsupported("Invalid vertical font metrics");
    return {text, code: encoded, font, size, width, ascent, descent, bold: parsed ? run.bold ?? false : false, italic: parsed ? run.italic ?? false : false, strikeout: run.strikeout ?? false, underline: run.underline ?? false, ...(run.link === undefined ? {} : {link: run.link})};
  };
  const lines = async (block: Paragraph, width: number): Promise<Line[]> => {
    charge("layoutWork", 1);
    if (!positive(width)) unsupported("Nonadvancing text box");
    if (block.align !== undefined && !["left", "center", "right"].includes(block.align)) unsupported("Invalid text alignment");
    const result: Line[] = []; let line = emptyLine(); let used = 0;
    let word: Glyph[] = []; let wordWidth = 0;
    const flush = () => {
      if (wordWidth > width && block.longWord === "error") unsupported("Unbreakable word exceeds text box");
      if (used + wordWidth > width && line.glyphs.length) {result.push(line); line = emptyLine(); used = 0;}
      for (const g of word) {
        if (used + g.width > width && line.glyphs.length) {result.push(line); line = emptyLine(); used = 0;}
        used += g.width; line.ascent = Math.max(line.ascent, g.ascent); line.descent = Math.max(line.descent, g.descent);
        line.height = Math.max(line.height, g.size * lineHeight, line.ascent + line.descent); line.glyphs.push(g);
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
  let page: PDFPage; let top = box.margin; let fontKeys = new Map<PDFFont, PDFName>();
  const newPage = () => { charge("pages", 1); charge("objects", 3); page = pdf.addPage([box.width, box.height]); fontKeys = new Map(); top = box.margin; };
  const usableHeight = box.height - 2 * box.margin;
  const room = (height: number) => { if (height > usableHeight) unsupported("Indivisible layout exceeds page"); if (top + height > box.height - box.margin) newPage(); };
  const draw = (line: Line, x: number, baselineTop: number, width: number, align: Paragraph["align"] = "left") => {
    const lineWidth = line.glyphs.reduce((sum, g) => sum + g.width, 0);
    x += align === "right" ? width - lineWidth : align === "center" ? (width - lineWidth) / 2 : 0;
    context.onPlacement?.({kind: "text", page: usage.pages, x, y: baselineTop, width: lineWidth, height: line.height, text: line.glyphs.map(g => g.text).join("")});
    for (let i = 0; i < line.glyphs.length;) {
      const g = line.glyphs[i]!; let codes = ""; let width = 0;
      do {
        charge("layoutWork", 1); const current = line.glyphs[i++]!; codes += current.code; width += current.width;
      } while (i < line.glyphs.length && line.glyphs[i]!.font === g.font && line.glyphs[i]!.size === g.size && line.glyphs[i]!.link === g.link && line.glyphs[i]!.bold === g.bold && line.glyphs[i]!.italic === g.italic && line.glyphs[i]!.strikeout === g.strikeout && line.glyphs[i]!.underline === g.underline);
      charge("objects", 1);
      let fontKey = fontKeys.get(g.font);
      if (!fontKey) {fontKey = page.node.newFontDictionary("Font", g.font.ref); fontKeys.set(g.font, fontKey);}
      // Use admitted scalar codes directly: no cross-scalar ligatures or shaping.
      const baseline = box.height - baselineTop - line.ascent;
      page.pushOperators(pushGraphicsState(), setFillingRgbColor(0, 0, 0), setStrokingRgbColor(0, 0, 0), setLineWidth(g.size / 40), beginText(), setFontAndSize(fontKey, g.size), setTextRenderingMode(g.bold ? TextRenderingMode.FillAndOutline : TextRenderingMode.Fill), setTextMatrix(1, 0, g.italic ? 0.2 : 0, 1, x, baseline), showText(PDFHexString.of(codes)), endText(), popGraphicsState());
      for (const offset of [...g.strikeout ? [g.size * 0.3] : [], ...g.underline ? [-g.size * 0.15] : []]) {
        charge("objects", 1); charge("layoutWork", 1);
        page.drawLine({start: {x, y: baseline + offset}, end: {x: x + width, y: baseline + offset}, thickness: g.size / 20, color: rgb(0, 0, 0)});
      }
      if (g.link) { charge("objects", 1); const ref = pdf.context.register(pdf.context.obj({Type: "Annot", Subtype: "Link", Rect: [x, box.height - baselineTop - line.height, x + width, box.height - baselineTop], Border: [0, 0, 0], A: {Type: "Action", S: "URI", URI: textString(g.link)}})); page.node.addAnnot(ref); }
      x += width;
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
        else if (next.kind === "rule") nextHeight = 16;
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
        for (let i = 0; i < count; i++) {const line = prepared[cursor++]!; draw(line, box.margin + indent, top, box.width - 2 * box.margin - indent, block.align); top += line.height;}
        if (cursor < prepared.length) newPage();
        await cooperate();
      }
      const after = block.spaceAfter ?? 8; if (!Number.isFinite(after) || after < 0) unsupported("Invalid paragraph spacing"); top += after;
    } else if (block.kind === "table") {
      if (!block.widths.length || !block.widths.every(positive) || Math.abs(block.widths.reduce((a, b) => a + b, 0) - 1) > 0.000001) unsupported("Invalid table widths");
      const preparedRows: {cells: Line[][]; height: number; alignments: Paragraph["align"][]}[] = [];
      for (const row of block.rows) {
        if (row.length !== block.widths.length) unsupported("Nonrectangular table");
        const cells: Line[][] = [];
        for (let i = 0; i < row.length; i++) cells.push(await lines(row[i]!, (box.width - 2 * box.margin) * block.widths[i]! - 8));
        const height = Math.max(8, ...cells.map(cell => cell.reduce((sum, line) => sum + line.height, 8))); preparedRows.push({cells, height, alignments: row.map(cell => cell.align)});
      }
      if (block.keepTogether) room(preparedRows.reduce((sum, row) => sum + row.height, 0));
      const headerCount = block.headerRows ?? 0;
      if (!Number.isSafeInteger(headerCount) || headerCount < 0 || headerCount > preparedRows.length) unsupported("Invalid table header count");
      const headers = preparedRows.slice(0, headerCount);
      const headerHeight = headers.reduce((s, r) => s + r.height, 0);
      if (headerHeight >= usableHeight) unsupported("Table headers leave no body space");
      const drawRow = (cells: Line[][], height: number, alignments: readonly Paragraph["align"][]) => {
        let x = box.margin;
        for (let i = 0; i < cells.length; i++) {
          const width = (box.width - 2 * box.margin) * block.widths[i]!; charge("objects", 1);
          context.onPlacement?.({kind: "cell", page: usage.pages, x, y: top, width, height});
          page!.drawRectangle({x, y: box.height - top - height, width, height, borderWidth: 0.5, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0)});
          let offset = top + 4; for (const line of cells[i]!) { draw(line, x + 4, offset, width - 8, alignments[i]); offset += line.height; } x += width;
        }
        top += height;
      };
      const continuation = () => {newPage(); for (const h of headers) drawRow(h.cells, h.height, h.alignments);};
      // Start headers with at least one body line, avoiding a header-only page.
      if (preparedRows.length > headerCount) room(headerHeight + Math.max(...preparedRows[headerCount]!.cells.map(cell => (cell[0]?.height ?? 0) + 8)));
      else room(headerHeight);
      for (let r = 0; r < preparedRows.length; r++) {
        const row = preparedRows[r]!;
        if (r < headerCount) {drawRow(row.cells, row.height, row.alignments); continue;}
        if (block.rowSplit !== "lines") {
          if (row.height + headerHeight > usableHeight) unsupported("Table row exceeds page with headers");
          if (top + row.height > box.height - box.margin) continuation();
          drawRow(row.cells, row.height, row.alignments);
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
            drawRow(fragments, Math.max(...fragments.map(cell => cell.reduce((s, l) => s + l.height, 8))), row.alignments);
            if (row.cells.some((cell, i) => cursors[i]! < cell.length)) continuation();
            await cooperate();
          }
        }
      }
      top += 8;
    } else if (block.kind === "rule") {
      const indent = block.indent ?? 0;
      const width = box.width - 2 * box.margin - indent;
      if (!Number.isFinite(indent) || indent < 0 || !positive(width)) unsupported("Invalid rule indent");
      room(16); charge("objects", 1);
      const x = box.margin + indent, y = top + 8;
      page!.drawLine({start: {x, y: box.height - y}, end: {x: x + width, y: box.height - y}, thickness: 0.5, color: rgb(0, 0, 0)});
      context.onPlacement?.({kind: "rule", page: usage.pages, x, y, width, height: 0.5});
      top += 16;
    } else if (block.kind === "image") {
      charge("images", 1); charge("imageBytes", block.bytes.length); charge("objects", 3);
      const bytes = block.bytes;
      const {width, height, pixels} = imageBox(block, box, unsupported, () => charge("layoutWork", 1));
      charge("imagePixels", pixels);
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

export {admitTrueTypeFont} from "./font-admission.js";
