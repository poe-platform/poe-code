import { PDFDocument, rgb, PDFName, PDFString, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { LayoutDocument, Paragraph, PdfContext, PdfLimits, TextRun } from "./model.js";
export type * from "./model.js";
export class PdfError extends Error {
  constructor(readonly code: "E_LIMIT" | "E_CAPABILITY" | "E_CANCELLED", message: string) { super(message); this.name = "PdfError"; }
}
export function pdfCapabilities() {
  return {profile: "PDF-1.7-supplied-fonts-ltr", reference: "Adobe PDF Reference sixth edition, November 2006", scripts: ["Latin", "Greek", "Cyrillic"], images: ["png", "jpeg"], tables: "rectangular-unspanned", encryption: false, javascript: false, attachments: false} as const;
}
const defaults: PdfLimits = {fontBytes: 4_000_000, fonts: 8, glyphs: 100_000, pages: 200, objects: 100_000, images: 100, imageBytes: 8_000_000, layoutWork: 500_000, outputBytes: 16_000_000};
function unsupported(message: string): never { throw new PdfError("E_CAPABILITY", message); }
function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }
interface Glyph { text: string; font: PDFFont; size: number; width: number; link?: string }
interface Line { glyphs: Glyph[]; height: number }
export async function renderPdf(document: LayoutDocument, context: PdfContext = {}): Promise<Uint8Array> {
  const limits = {...defaults, ...context.limits};
  const usage = Object.fromEntries(Object.keys(defaults).map(key => [key, 0])) as Record<keyof PdfLimits, number>;
  const check = () => { if (context.signal?.aborted) throw new PdfError("E_CANCELLED", "PDF cancelled"); };
  const charge = (key: keyof PdfLimits, amount: number) => {
    check();
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0 || usage[key] + amount > limits[key]) throw new PdfError("E_LIMIT", `PDF ${key} limit exceeded`);
    context.charge?.(key, amount); usage[key] += amount;
  };
  const cooperate = async () => { check(); await context.yield?.(); check(); };
  check();
  const box = document.page ?? {width: 595.28, height: 841.89, margin: 48};
  if (![box.width, box.height].every(positive) || !Number.isFinite(box.margin) || box.margin < 0 || box.width <= box.margin * 2 || box.height <= box.margin * 2) unsupported("Invalid page box");
  if (!document.fonts.length) unsupported("Supply at least one font");
  // Admit all fonts before parsing; never query the filesystem or system fonts.
  const ids = new Set<string>();
  for (const font of document.fonts) {
    if (!font.id || ids.has(font.id)) unsupported("Duplicate/empty font identity");
    ids.add(font.id); charge("fonts", 1); charge("fontBytes", font.bytes.length); charge("objects", 8);
  }
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const fonts = new Map<string, PDFFont>();
  try {
    for (const font of document.fonts) { fonts.set(font.id, await pdf.embedFont(new Uint8Array(font.bytes), {subset: false})); await cooperate(); }
  } catch (error) { if (error instanceof PdfError) throw error; unsupported("Invalid or unsupported supplied font"); }
  const coverage = new Map([...fonts.values()].map(font => [font, new Set(font.getCharacterSet())]));
  const glyph = (text: string, run: TextRun): Glyph => {
    charge("glyphs", 1); charge("layoutWork", 1);
    const cp = text.codePointAt(0)!;
    if (!(cp >= 32 && cp <= 126 || cp >= 160 && cp <= 255 || cp >= 0x370 && cp <= 0x52f) || cp >= 0x483 && cp <= 0x489) unsupported("Unsupported script or combining sequence");
    const candidates = run.font === undefined ? [...fonts.values()] : [fonts.get(run.font), ...fonts.values()];
    if (run.font !== undefined && !fonts.has(run.font)) unsupported("Unknown font identity");
    const font = candidates.find(candidate => candidate && coverage.get(candidate)!.has(cp));
    if (!font) unsupported(`No supplied font covers U+${cp.toString(16)}`);
    const size = run.size ?? 12; if (!positive(size) || size > 144) unsupported("Invalid font size");
    if (run.link !== undefined) { let url: URL; try { url = new URL(run.link); } catch { unsupported("Invalid link"); } if (!["https:", "http:", "mailto:"].includes(url.protocol)) unsupported("Unsafe link scheme"); }
    return {text, font, size, width: font.widthOfTextAtSize(text, size), ...(run.link === undefined ? {} : {link: run.link})};
  };
  const lines = async (block: Paragraph, width: number): Promise<Line[]> => {
    const result: Line[] = []; let line: Line = {glyphs: [], height: 14.4}; let used = 0;
    for (const run of block.runs) for (const scalar of run.text) {
      charge("layoutWork", 1);
      if (scalar === "\n") { result.push(line); line = {glyphs: [], height: 14.4}; used = 0; continue; }
      const g = glyph(scalar === "\t" ? " " : scalar, run);
      if (g.width > width) unsupported("Glyph wider than text box");
      if (used + g.width > width && line.glyphs.length) { result.push(line); line = {glyphs: [], height: 14.4}; used = 0; }
      used += g.width; line.height = Math.max(line.height, g.size * 1.2); line.glyphs.push(g);
      if (usage.layoutWork % 256 === 0) await cooperate();
    }
    if (line.glyphs.length || !result.length) result.push(line);
    return result;
  };
  let page: PDFPage; let top = box.margin;
  const newPage = () => { charge("pages", 1); charge("objects", 3); page = pdf.addPage([box.width, box.height]); top = box.margin; };
  const usableHeight = box.height - 2 * box.margin;
  const room = (height: number) => { if (height > usableHeight) unsupported("Indivisible layout exceeds page"); if (top + height > box.height - box.margin) newPage(); };
  const draw = (line: Line, x: number, baselineTop: number) => {
    for (const g of line.glyphs) {
      charge("objects", 1); charge("layoutWork", 1);
      page.drawText(g.text, {x, y: box.height - baselineTop - g.size, size: g.size, font: g.font});
      if (g.link) { charge("objects", 1); const ref = pdf.context.register(pdf.context.obj({Type: "Annot", Subtype: "Link", Rect: [x, box.height - baselineTop - line.height, x + g.width, box.height - baselineTop], Border: [0, 0, 0], A: {Type: "Action", S: "URI", URI: PDFString.of(g.link)}})); page.node.addAnnot(ref); }
      x += g.width;
    }
  };
  newPage();
  for (const block of document.blocks) {
    charge("layoutWork", 1); if (block.breakBefore && top > box.margin) newPage();
    if (block.kind === "paragraph") {
      const prepared = await lines(block, box.width - 2 * box.margin);
      if (block.keepTogether) room(prepared.reduce((sum, line) => sum + line.height, 0));
      for (const line of prepared) { room(line.height); draw(line, box.margin, top); top += line.height; }
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
      for (const row of preparedRows) {
        room(row.height); let x = box.margin;
        for (let i = 0; i < row.cells.length; i++) {
          const width = (box.width - 2 * box.margin) * block.widths[i]!; charge("objects", 1);
          page!.drawRectangle({x, y: box.height - top - row.height, width, height: row.height, borderWidth: 0.5, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0)});
          let offset = top + 4; for (const line of row.cells[i]!) { draw(line, x + 4, offset); offset += line.height; } x += width;
        }
        top += row.height;
      }
      top += 8;
    } else if (block.kind === "image") {
      charge("images", 1); charge("imageBytes", block.bytes.length); charge("objects", 3);
      if (!positive(block.width) || !positive(block.height) || block.width > box.width - 2 * box.margin) unsupported("Invalid image box");
      // Bound decoded dimensions before the library inflates PNG pixel buffers.
      const bytes = block.bytes;
      if (block.media === "png") {
        if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) unsupported("Invalid PNG");
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const pixels = view.getUint32(16) * view.getUint32(20); if (!pixels || pixels > 4_000_000) throw new PdfError("E_LIMIT", "PNG pixel limit exceeded");
      }
      room(block.height);
      try { const image = block.media === "png" ? await pdf.embedPng(new Uint8Array(bytes)) : await pdf.embedJpg(new Uint8Array(bytes)); page!.drawImage(image, {x: box.margin, y: box.height - top - block.height, width: block.width, height: block.height}); }
      catch { unsupported("Invalid image bytes"); }
      top += block.height + 8;
    } else unsupported("Unknown layout block");
    await cooperate();
  }
  check();
  // Uncompressed object syntax makes the restricted profile independently inspectable.
  const bytes = await pdf.save({useObjectStreams: false}); check(); charge("outputBytes", bytes.length);
  // pdf-lib writes its fixed 1.7 header; no catalog APIs expose active content here.
  if (pdf.catalog.has(PDFName.of("OpenAction"))) unsupported("Active content forbidden");
  return bytes;
}

export { suppliedDefaultFont } from "./default-font.js";
