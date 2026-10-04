import { PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle as pdfRectangle, clip, endPath, drawObject as drawPdfObject, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor, setGraphicsState, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit, {type Font} from "@pdf-lib/fontkit";
import { admitTrueTypeFont, suppliedDefaultFont, serializePdf, decodePng, PdfError } from "safe-bash-pdf-engine";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { createFormattingCapability } from "../formatting.js";
import { exportOptionPairs } from "../cli/export-options.js";
import { foldSheetName } from "../workbook/case-fold.js";
import { getCellsExtent, type Workbook, type Sheet, type AxisMetadata } from "../workbook.js";
import { sheetObjects, type SheetObject } from "../objects/index.js";
import { objectRectangle } from "../objects/layout.js";
import { graphBackground } from "../rendering/images/scene.js";
import { layoutPrintPages } from "../rendering/print/layout.js";
import { renderPrintHeaderFooter } from "../rendering/print/header-footer.js";
import { splitPrintLines } from "@poe-code/spreadsheet-engine/rendering/print/text-lines";
import { renderPrintFormula } from "@poe-code/spreadsheet-engine/rendering/print/formula-text";
import { createPrintSpans } from "@poe-code/spreadsheet-engine/rendering/print/text-span";
import { cellPrintStyle, type CellPrintStyle } from "../rendering/print/cell-style.js";
import { sheetPrintSettings } from "../rendering/print/settings.js";
import { normalizeFontText } from "../rendering/print/font-normalization.js";
import { createFontShaper } from "../rendering/print/font-shaping.js";

// Native default display DPI for the admitted materialized Gnumeric style profile.
const printDisplayScale = 72 / 96;
function sheetViewFlag(sheet: Sheet, name: "displayFormulas" | "hideZero"): boolean {
  const retained = sheet.view?.gnumeric;
  return Boolean(Number(sheet.view?.[name] ?? (retained && typeof retained === "object" && !Array.isArray(retained)
    ? (retained as Readonly<Record<string, unknown>>)[name.charAt(0).toUpperCase() + name.slice(1)] ?? 0 : 0)));
}
function normalizePdfCellStyle(cell: Workbook["sheets"][number]["cells"][number]): NonNullable<Workbook["sheets"][number]["cells"][number]["style"]> | undefined {
  const style = cell.style;
  if (!style) return undefined;
  const g = style.gnumeric as Record<string, any> | undefined;
  if (
    Object.keys(style).length === 1 &&
    Object.hasOwn(style, "gnumeric") &&
    g &&
    typeof g === "object" &&
    !Array.isArray(g) &&
    g.name === "Style" &&
    g.namespace === "http://www.gnumeric.org/v10.dtd" &&
    typeof g.text === "string" &&
    g.text.trim() === "" &&
    Array.isArray(g.children) &&
    g.children.length === 0 &&
    Array.isArray(g.attributes) &&
    g.attributes.every((a: any) => a && typeof a === "object" && a.namespace === "" && a.name === "Format" && typeof a.value === "string")
  ) {
    return undefined;
  }
  if (Object.keys(style).length === 2 && Object.hasOwn(style, "xlsx") && Object.hasOwn(style, "gnumeric")) {
    if (g && typeof g === "object" && !Array.isArray(g) && Array.isArray(g.attributes)) {
      const hasFormat = g.attributes.some((a: any) => a && typeof a === "object" && a.name === "Format");
      const normalizedAttrs = hasFormat
        ? g.attributes.map((a: any) => a && typeof a === "object" && a.name === "Format" ? { ...a, value: "General" } : a)
        : [...g.attributes, { name: "Format", namespace: "", value: "General" }];
      return {
        gnumeric: { ...g, attributes: normalizedAttrs }
      };
    }
  }
  if (Object.keys(style).length === 1 && Object.hasOwn(style, "gnumeric") && g && typeof g === "object" && !Array.isArray(g) && Array.isArray(g.attributes)) {
    const hasCustomFormat = g.attributes.some((a: any) => a && typeof a === "object" && a.name === "Format" && a.value !== "General");
    if (hasCustomFormat) {
      return {
        gnumeric: {
          ...g,
          attributes: g.attributes.map((a: any) => a && typeof a === "object" && a.name === "Format" ? { ...a, value: "General" } : a)
        }
      };
    }
  }
  return style;
}


// Explicit GTK names in the measured C profile; no ambient paper discovery.
const papers: Readonly<Record<string, readonly [number, number]>> = {
  iso_a4: [210 * 72 / 25.4, 297 * 72 / 25.4], na_letter: [612, 792], na_legal: [612, 1008],
  iso_a3: [297 * 72 / 25.4, 420 * 72 / 25.4], iso_a5: [148 * 72 / 25.4, 210 * 72 / 25.4],
  iso_b5: [176 * 72 / 25.4, 250 * 72 / 25.4],
  na_ledger: [1224, 792], na_executive: [522, 756]
};
function paperName(value: string): string {
  const aliases: Readonly<Record<string, string>> = { a4: "iso_a4", a3: "iso_a3", a5: "iso_a5", b5: "iso_b5", usletter: "na_letter", "us-letter": "na_letter", letter: "na_letter", uslegal: "na_legal" };
  const alias = aliases[value.toLowerCase()];
  if (alias) return alias;
  if (value.toLowerCase().startsWith("executive")) return "na_executive";
  for (const name of ["iso_a3", "iso_a4", "iso_a5", "iso_b5", "na_letter", "na_legal", "na_executive"]) if (value.startsWith(`${name}_`)) return name;
  return value;
}
function unsupported(feature: string): never { throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: PDF ${feature}`); }
function optionsFor(book: Workbook, options: readonly string[], context: CapabilityContext) {
  let paper: readonly [number, number] | undefined, fit = false;
  let orientation: "portrait" | "landscape" | "reverse-portrait" | "reverse-landscape" | undefined;
  let fitColumns: number | undefined, fitRows: number | undefined, scalePct: number | undefined;
  const objects: { sheet: Sheet; object: SheetObject }[] = [], sheets: string[] = [];
  let work = 0;
  for (const text of options) for (const [key, value] of exportOptionPairs(text)) {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? context.limits.inputBytes)) throw new SsconvertError("resource-limit", "ssconvert PDF option work limit exceeded");
    if (key === "object") {
      let seen = false;
      for (const sheet of book.sheets) for (const object of [...sheetObjects(sheet, context)].reverse()) {
        if (object.name === value) { objects.push({ sheet, object }); seen = true; }
        if (++work > (context.limits.workbookWork ?? context.limits.inputBytes)) throw new SsconvertError("resource-limit", "ssconvert PDF option work limit exceeded");
      }
      if (!seen) throw new SsconvertError("invalid-request", `ssconvert: There is no object with name '${value}'`);
    } else if (key === "paper") {
      if (value === "fit") fit = true;
      else {
        const lower = value.toLowerCase();
        const landscapeSuffix = lower.endsWith("-landscape") ? "-landscape" : lower.endsWith("_landscape") ? "_landscape" : (lower === "a4l" || lower === "a3l" || lower === "a5l" || lower === "letterl") ? "l" : "";
        const rawPaper = landscapeSuffix ? value.slice(0, -landscapeSuffix.length) : value;
        if (landscapeSuffix && !orientation) orientation = "landscape";
        const name = paperName(rawPaper);
        if (!Object.hasOwn(papers, name)) {
          if (value === "") throw new SsconvertError("invalid-request", "ssconvert: Unknown paper size");
          unsupported("unqualified named-paper warning profile");
        }
        paper = papers[name]!;
      }
    } else if (key === "orientation") {
      const norm = value.toLowerCase();
      if (norm !== "portrait" && norm !== "landscape" && norm !== "reverse-portrait" && norm !== "reverse-landscape") {
        throw new SsconvertError("invalid-request", `ssconvert: Invalid orientation "${value}" for format Gnumeric_pdf:pdf_assistant`);
      }
      orientation = norm;
    } else if (key === "fit-width" || key === "fit_width" || key === "fit-to-pages-wide") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
        throw new SsconvertError("invalid-request", `ssconvert: Invalid fit-width "${value}" for format Gnumeric_pdf:pdf_assistant`);
      }
      fitColumns = parsed;
    } else if (key === "fit-height" || key === "fit_height" || key === "fit-to-pages-tall") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
        throw new SsconvertError("invalid-request", `ssconvert: Invalid fit-height "${value}" for format Gnumeric_pdf:pdf_assistant`);
      }
      fitRows = parsed;
    } else if (key === "scale") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new SsconvertError("invalid-request", `ssconvert: Invalid scale "${value}" for format Gnumeric_pdf:pdf_assistant`);
      }
      scalePct = parsed;
    } else if (key === "sheet" || key === "active-sheet") {
      const sheet = key === "active-sheet" ? book.sheets.find(sheet => sheet.id === book.activeSheet) ?? book.sheets[0] : book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(value));
      if (!sheet) throw new SsconvertError("invalid-request", `ssconvert: Unknown sheet "${value}"`);
      sheets.push(sheet.id);
    } else throw new SsconvertError("invalid-request", `ssconvert: Invalid export option "${key}" for format Gnumeric_pdf:pdf_assistant`);
  }
  const scale = (fitColumns !== undefined || fitRows !== undefined)
    ? { kind: "fit" as const, rows: fitRows ?? 0, columns: fitColumns ?? 0 }
    : scalePct !== undefined
      ? { kind: "percentage" as const, x: scalePct, y: scalePct }
      : undefined;
  return { paper, fit, orientation, scale, objects, sheets };
}
export async function pdfExportOptions(options: readonly string[], context: CapabilityContext, book?: Workbook): Promise<readonly string[]> {
  if (book) optionsFor(book, options, context);
  return options;
}
export async function writePdf(book: Workbook, options: readonly string[], context: CapabilityContext,
  selection?: { readonly sheets: readonly string[] }): Promise<Uint8Array> {
  const settings = optionsFor(book, options, context);
  const formatting = context.formatting ?? createFormattingCapability();
  let work = 0;
  const tick = (amount = 1) => {
    context.signal.throwIfAborted();
    work += amount;
    if (!Number.isSafeInteger(work) || work > (context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32)) throw new SsconvertError("resource-limit", "ssconvert PDF work limit exceeded");
  };
  tick();
  const shaper = createFontShaper(context, tick);
  try {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setProducer("ssconvert JavaScript PDF writer");
  const fonts = new Map<string, {font: PDFFont; metrics: Font; bytes: Uint8Array; shaped: boolean; supported: ReadonlySet<number>; ascentRatio: number; descentRatio: number}>();
  let fontBytes = 0;
  const text = async (page: PDFPage, value: string, x: number, y: number, size = 10, alignment: "left" | "center" | "right" = "left", cellBox?: { width: number; height: number; style: CellPrintStyle; overflow?: (displayWidth: number) => {left: number; right: number} }) => {
    tick(value.length);
    if (!value) return;
    const bold = cellBox?.style.bold ?? false, italic = cellBox?.style.italic ?? false, family = cellBox?.style.family ?? "Sans";
    const fontKey = JSON.stringify([family, bold, italic]);
    let selected = fonts.get(fontKey);
    if (!selected) {
      pdf.registerFontkit(fontkit);
      let bytes: Uint8Array;
      if (context.fonts) {
        const supplied = await context.fonts.resolve(Object.freeze({ family, bold, italic,
          maxBytes: context.limits.inputBytes - fontBytes, signal: context.signal }));
        tick();
        if (supplied === undefined) unsupported("supplied font unavailable");
        if (!(supplied instanceof Uint8Array)) unsupported("supplied font bytes");
        if (supplied.byteLength > context.limits.inputBytes - fontBytes) throw new SsconvertError("resource-limit", "ssconvert PDF font bytes limit exceeded");
        fontBytes += supplied.byteLength;
        tick(supplied.byteLength);
        bytes = new Uint8Array(supplied);
        admitTrueTypeFont(bytes, message => unsupported(`supplied font: ${message}`), tick);
      } else bytes = suppliedDefaultFont(count => tick(count)).bytes;
      try {
        const parsed = fontkit.create(bytes);
        if (!Number.isFinite(parsed.unitsPerEm) || parsed.unitsPerEm <= 0 || !Number.isFinite(parsed.ascent) || parsed.ascent <= 0 || !Number.isFinite(parsed.descent) || parsed.descent > 0) unsupported("supplied font metrics");
        await shaper.addFont(bytes, parsed);
        pdf.registerFontkit({ create: () => parsed });
        const embeddedFont = await pdf.embedFont(bytes, { subset: true });
        selected = {font: embeddedFont, metrics: parsed, bytes, shaped: true, supported: new Set(embeddedFont.getCharacterSet()),
          ascentRatio: parsed.ascent / parsed.unitsPerEm, descentRatio: -parsed.descent / parsed.unitsPerEm};
        fonts.set(fontKey, selected);
      }
      catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof SsconvertError) throw error;
        unsupported("supplied font parsing");
      }
      tick();
    }
    const {font, metrics, supported, ascentRatio, descentRatio} = selected;
    const paragraphs = cellBox ? splitPrintLines(value, tick) : [value];
    const shapedLines = paragraphs.map(line => cellBox ? normalizeFontText(line, supported, tick) : line);
    for (const line of shapedLines) for (const scalar of line) {
      tick();
      if (!supported.has(scalar.codePointAt(0)!)) unsupported("font coverage");
    }
    let baseline = page.getHeight() - y - size;
    let width = cellBox ? 0 : font.widthOfTextAtSize(value, size);
    if (cellBox) {
      if (!selected.shaped) {
        try {
          await shaper.addFont(selected.bytes, metrics);
          selected.shaped = true;
        } catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof SsconvertError) throw error;
          unsupported("supplied font parsing");
        }
      }
      const ascent = ascentRatio * size, lineHeight = ascent + descentRatio * size;
      const height = lineHeight * shapedLines.length;
      const lines = shapedLines.map(shapedValue => {
        const glyphs: {x: number; y: number}[] = [];
        let width = 0, displayWidth = 0;
        // Pango's unhinted print profile rounds advances and offsets in display pixels.
        const run = shapedValue ? shaper.shape(metrics, shapedValue) : undefined;
        for (const position of run?.positions ?? []) {
          tick();
          const advance = position.xAdvance * cellBox.style.size / metrics.unitsPerEm;
          if (!Number.isFinite(advance) || advance < 0 || !Number.isFinite(position.xOffset) || !Number.isFinite(position.yOffset) || position.yAdvance !== 0) unsupported("supplied font advances");
          glyphs.push({x: width + Math.round(position.xOffset * cellBox.style.size / metrics.unitsPerEm) * printDisplayScale,
            // Pango rounds its downward y offset before the PDF coordinate inversion.
            y: -Math.round(-position.yOffset * cellBox.style.size / metrics.unitsPerEm) * printDisplayScale});
          width += Math.round(advance) * printDisplayScale;
          displayWidth += Math.round(advance / printDisplayScale) * printDisplayScale;
        }
        return {shapedValue, run, glyphs, width, displayWidth};
      });
      let displayWidth = 0;
      for (const line of lines) {
        tick();
        width = Math.max(width, line.width);
        displayWidth = Math.max(displayWidth, line.displayWidth);
      }
      let indent = 0, displayIndent = 0;
      if (cellBox.style.indent && alignment !== "center") {
        // GOFont averages the individually measured digits, with a one-pixel minimum.
        let digitWidth = 0, displayDigitWidth = 0;
        for (const digit of "0123456789") {
          tick();
          if (!supported.has(digit.codePointAt(0)!)) unsupported("font coverage");
          const digits = shaper.shape(metrics, digit);
          let advance = 0, displayAdvance = 0;
          for (const position of digits.positions) {
            tick();
            const amount = position.xAdvance * cellBox.style.size / metrics.unitsPerEm;
            if (!Number.isFinite(amount) || amount < 0) unsupported("supplied font advances");
            advance += Math.round(amount);
            displayAdvance += Math.round(amount / printDisplayScale);
          }
          digitWidth += Math.max(1, advance);
          displayDigitWidth += Math.max(1, displayAdvance);
        }
        indent = Math.min(65535, Math.round(cellBox.style.indent * Math.floor((digitWidth * 1024 + 5) / 10) / 1024)) * printDisplayScale;
        displayIndent = Math.min(65535, Math.round(cellBox.style.indent * Math.floor((displayDigitWidth * 1024 + 5) / 10) / 1024)) * printDisplayScale;
      }
      const wraps = cellBox.style.verticalAlignment === "justify" || cellBox.style.verticalAlignment === "distributed";
      const overflows = width + indent > cellBox.width - 5;
      if (wraps && overflows) unsupported("wrapped text layout");
      if (overflows && cellBox.overflow === undefined || !Number.isFinite(height)) unsupported("default-style text layout");
      const overflow = cellBox.overflow?.(displayWidth + displayIndent);
      const clipLeft = x + 4 - (overflow?.left ?? 0);
      const clipWidth = Math.max(0, cellBox.width + (overflow?.left ?? 0) + (overflow?.right ?? 0) - 4);
      // print_page_cells adds 2pt;the cell painter adds half a grid plus its scaled 3px text margin.
      x += 2 + 0.5 + 3 * printDisplayScale + (alignment === "left" ? 0 : (cellBox.width - 5) / (alignment === "center" ? 2 : 1));
      if (alignment === "center" && overflow && (overflow.left > 0 || overflow.right > 0)) {
        // Native spanning centers are passed in points, then scaled by the painter.
        x += 2.5 + (printDisplayScale - 1) * (cellBox.width / 2 + overflow.left);
      }
      // Native print layout removes the 1pt grid, then applies the scaled top margin.
      const verticalSpace = Math.max(0, cellBox.height - 1 - height);
      const verticalOffset = (cellBox.style.verticalAlignment === "top" || cellBox.style.verticalAlignment === "justify") ? 0 : verticalSpace / (cellBox.style.verticalAlignment === "center" || cellBox.style.verticalAlignment === "distributed" ? 2 : 1);
      baseline = page.getHeight() - y - printDisplayScale - verticalOffset - ascent;
      x -= alignment === "left" ? -indent : alignment === "center" ? width / 2 : width + indent;
      const lineSpacing = cellBox.style.verticalAlignment === "justify" && lines.length > 1 ?
        Math.floor(verticalSpace / printDisplayScale * 1024 / (lines.length - 1)) / 1024 * printDisplayScale : 0;
      const blockX = x, firstBaseline = baseline;
      const resource = page.node.newFontDictionary(font.name, font.ref);
      // Positioned marks can be reordered by text extractors; retain the logical cell string.
      page.pushOperators(pushGraphicsState());
      if (cellBox.style.foregroundAlpha !== 1) {
        const alpha = page.node.newExtGState("CellAlpha", pdf.context.obj({Type: "ExtGState", ca: cellBox.style.foregroundAlpha}));
        page.pushOperators(setGraphicsState(alpha));
      }
      if (overflows || height > cellBox.height - 1) page.pushOperators(
        pdfRectangle(clipLeft, page.getHeight() - y - cellBox.height, clipWidth, cellBox.height), clip(), endPath());
      page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence,
        [PDFName.of("Span"), pdf.context.obj({ActualText: PDFHexString.fromText(value)}).toString()]));
      for (const [lineIndex, line] of lines.entries()) {
        const {run, glyphs, shapedValue} = line;
        if (!run) continue;
        // Pango hints centered lines to whole display pixels when layout and
        // line widths are integral; an implicit wrapping width need not be.
        const centeredOffset = (width - line.width) / 2;
        x = blockX + (alignment === "left" ? 0 : alignment === "right" ? width - line.width :
          wraps && !Number.isInteger((cellBox.width - 5) / printDisplayScale) ? centeredOffset :
            Math.round(centeredOffset / printDisplayScale) * printDisplayScale);
        baseline = firstBaseline - lineIndex * (lineHeight + lineSpacing);
        // Encode the same shaped run that supplies the positioned glyphs.
        const layout = metrics.layout;
        let encoded: string;
        try {
          metrics.layout = () => run;
          encoded = font.encodeText(shapedValue).asString();
        } finally { metrics.layout = layout; }
        if (encoded.length !== glyphs.length * 4) unsupported("supplied font glyph mapping");
        page.pushOperators(beginText(), setFontAndSize(resource, size), setFillingRgbColor(...cellBox.style.foreground));
        for (const [index, glyph] of glyphs.entries()) {
          tick();
          page.pushOperators(setTextMatrix(1, 0, 0, 1, x + glyph.x, baseline + glyph.y), showText(PDFHexString.of(encoded.slice(index * 4, index * 4 + 4))));
        }
        page.pushOperators(endText());
        if (cellBox.style.underline || cellBox.style.strikeThrough) {
          // Pango uses font underline metrics and the union of positioned ink bounds.
          const scale = size / metrics.unitsPerEm;
          const thickness = metrics.underlineThickness ? metrics.underlineThickness * scale : printDisplayScale;
          const position = metrics.underlinePosition ? metrics.underlinePosition * scale : -printDisplayScale;
          let inkLeft = Infinity, inkRight = -Infinity, inkBottom = Infinity;
          for (const [index, glyph] of run.glyphs.entries()) {
            tick();
            const box = glyph.bbox, origin = glyphs[index]!;
            if (!Number.isFinite(box.minX)) continue; // Spaces have no ink.
            inkLeft = Math.min(inkLeft, origin.x + box.minX * scale);
            inkRight = Math.max(inkRight, origin.x + box.maxX * scale);
            inkBottom = Math.min(inkBottom, origin.y + box.minY * scale);
          }
          const low = cellBox.style.underline === 3;
          const lineY = baseline + (low ? Math.min(0, inkBottom) - 2 * thickness : position - thickness);
          if (low) page.pushOperators(pdfRectangle(clipLeft, page.getHeight() - y - cellBox.height,
            clipWidth, cellBox.height), clip(), endPath());
          for (let decoration = 0; decoration < (cellBox.style.underline === 0 ? 0 : cellBox.style.underline === 2 || cellBox.style.underline === 4 ? 2 : 1); decoration++) {
            tick();
            page.drawRectangle({x: x + Math.min(0, inkLeft), y: lineY - decoration * 2 * thickness,
              width: Math.max(line.width, Number.isFinite(inkRight - inkLeft) ? inkRight - inkLeft : 0),
              height: thickness, color: rgb(...cellBox.style.foreground)});
          }
          if (cellBox.style.strikeThrough && Number.isFinite(inkRight - inkLeft)) {
            // Fontkit decodes these standard OS/2 fields, but omits them from its declaration.
            const os2 = metrics["OS/2"] as {yStrikeoutSize?: number; yStrikeoutPosition?: number} | undefined;
            const strikeThickness = os2?.yStrikeoutSize ? os2.yStrikeoutSize * scale : printDisplayScale;
            const strikePosition = os2?.yStrikeoutPosition ? os2.yStrikeoutPosition * scale : ascent / 2;
            tick();
            page.drawRectangle({x: x + inkLeft, y: baseline + strikePosition - strikeThickness,
              width: inkRight - inkLeft, height: strikeThickness, color: rgb(...cellBox.style.foreground)});
          }
        }
      }
      page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent), popGraphicsState());
      return;
    }
    page.drawText(value, { x: x - (alignment === "left" ? 0 : width / (alignment === "center" ? 2 : 1)), y: baseline, size, font });
  };
  const printedFormulaText = new WeakMap<Sheet["cells"][number], string>();
  const effectiveColumns = (sheet: Sheet): readonly AxisMetadata[] | undefined => {
    if (sheet.columns?.length || sheet.view?.defaultColumnWidth !== undefined) return sheet.columns;
    const isDelimited = /\.(?:csv|tsv)$/i.test(sheet.name) || /\.(?:csv|tsv)$/i.test(context.inputFilename ?? "");
    const hasUnconfiguredWideCells = (!sheet.columns || sheet.columns.length === 0) &&
      sheet.view?.defaultColumnWidth === undefined &&
      sheet.cells.every(c => normalizePdfCellStyle(c) === undefined) &&
      sheet.cells.some(c => {
        const txt = c.displayedText ?? (c.value.kind === "blank" ? "" : String(c.value.value));
        return txt.length >= 9 && !["\n", "\r", "\u2028", "\u2029"].some(separator => txt.includes(separator));
      });
    if (!isDelimited && !hasUnconfiguredWideCells) return sheet.columns;
    
    const existingByCol = new Map((sheet.columns ?? []).map(c => [c.index, c]));
    const fallback = typeof sheet.view?.defaultColumnWidth === "number" ? sheet.view.defaultColumnWidth : 48;
    const maxWidthByCol = new Map<number, number>();
    for (const cell of sheet.cells) {
      const raw = sheetViewFlag(sheet, "displayFormulas") && cell.formula ? printedFormulaText.get(cell) ?? cell.formula : cell.displayedText ?? (cell.value.kind === "blank" ? "" : cell.value.kind === "boolean" ? (cell.value.value ? "TRUE" : "FALSE") : String(cell.value.value));
      if (!raw || ["\n", "\r", "\u2028", "\u2029"].some(separator => raw.includes(separator))) continue;
      const needed = Math.max(fallback, raw.length * 6 + 14);
      const prev = maxWidthByCol.get(cell.column) ?? fallback;
      if (needed > prev) maxWidthByCol.set(cell.column, needed);
    }
    for (const [idx, c] of existingByCol) {
      const cur = maxWidthByCol.get(idx) ?? fallback;
      maxWidthByCol.set(idx, Math.max(cur, c.sizePoints ?? fallback));
    }
    const cols = [...maxWidthByCol.entries()].filter(([index, sizePoints]) => sizePoints > fallback || existingByCol.has(index)).sort((a, b) => a[0] - b[0]).map(([index, sizePoints]) => ({ ...existingByCol.get(index), index, sizePoints }));
    return cols.length ? cols : sheet.columns;
  };
  const metrics = (sheet: Sheet) => {
    const axis = (entries: readonly AxisMetadata[] | undefined, fallback: number, scale = 1) => (index: number) => {
      let start = index * fallback, size = fallback;
      for (const entry of entries ?? []) { tick(); if (entry.index < index) start += (entry.hidden ? 0 : entry.sizePoints ?? fallback) - fallback; if (entry.index === index) size = entry.hidden ? 0 : entry.sizePoints ?? fallback; }
      return { start: start * scale, size: size * scale };
    };
    return { column: axis(effectiveColumns(sheet), typeof sheet.view?.defaultColumnWidth === "number" ? sheet.view.defaultColumnWidth : 48, sheetViewFlag(sheet, "displayFormulas") ? 2 : 1), row: axis(sheet.rows, typeof sheet.view?.defaultRowHeight === "number" ? sheet.view.defaultRowHeight : 12.75) };
  };
  const drawObject = async (page: PDFPage, object: SheetObject, x: number, y: number, width: number, height: number) => {
    tick();
    if (object.kind === "graph") {
      const fill = graphBackground(object.graph);
      if (fill) page.drawRectangle({ x, y: page.getHeight() - y - height, width, height, color: rgb(...[1, 3, 5].map(offset => Number.parseInt(fill.slice(offset, offset + 2), 16) / 255) as [number, number, number]) });
    } else if (object.kind === "image") {
      const image = object.payload.children.find(node => node.name === "Content" && node.namespace === "");
      if (!image) unsupported("image payload");
      const encoded = image.text.split(" ").join("").split("\n").join("").split("\r").join("").split("\t").join("");
      tick(encoded.length);
      let bytes: Uint8Array;
      try {
        const binary = atob(encoded);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch { return unsupported("image encoding"); }
      tick();
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let rasterWidth = 0, rasterHeight = 0;
      const png = bytes[0] === 137;
      if (png) {
        if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) unsupported("PNG header");
        rasterWidth = view.getUint32(16); rasterHeight = view.getUint32(20);
      } else if (bytes[0] === 255 && bytes[1] === 216) {
        let offset = 2;
        while (offset + 4 <= bytes.length) {
          tick();
          if (bytes[offset] !== 255) unsupported("JPEG header");
          const marker = bytes[offset + 1]!, length = view.getUint16(offset + 2);
          if (length < 2 || offset + 2 + length > bytes.length) unsupported("JPEG header");
          if ([0xc0, 0xc1, 0xc2].includes(marker)) {
            if (length < 8) unsupported("JPEG dimensions");
            rasterHeight = view.getUint16(offset + 5); rasterWidth = view.getUint16(offset + 7); break;
          }
          offset += length + 2;
        }
      } else unsupported("image format");
      if (!rasterWidth || !rasterHeight) unsupported("image dimensions");
      tick(rasterWidth * rasterHeight * 16); // Admit scanlines, RGB, alpha and inflater buffers.
      if (png) {
        let decoded: ReturnType<typeof decodePng>;
        try { decoded = decodePng(bytes, tick); }
        catch (error) {
          if (!(error instanceof PdfError)) throw error;
          if (error.code === "E_LIMIT") throw new SsconvertError("resource-limit", "ssconvert PDF PNG decoding limit exceeded");
          return unsupported("PNG decoding");
        }
        const mask = decoded.alpha === undefined ? undefined : pdf.context.register(pdf.context.flateStream(decoded.alpha, { Type: "XObject", Subtype: "Image", Width: rasterWidth, Height: rasterHeight, BitsPerComponent: 8, ColorSpace: "DeviceGray" }));
        const image = pdf.context.register(pdf.context.flateStream(decoded.rgb, { Type: "XObject", Subtype: "Image", Width: rasterWidth, Height: rasterHeight, BitsPerComponent: 8, ColorSpace: "DeviceRGB", SMask: mask }));
        const key = page.node.newXObject("Image", image);
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, x, page.getHeight() - y - height), drawPdfObject(key), popGraphicsState());
      } else {
        const embedded = await pdf.embedJpg(bytes);
        tick();
        if (embedded.width !== rasterWidth || embedded.height !== rasterHeight) unsupported("image dimension mismatch");
        page.drawImage(embedded, { x, y: page.getHeight() - y - height, width, height });
      }
    } else unsupported(`object ${object.sourceType}`);
  };
  const first = settings.objects[0];
  const rectangleFor = (sheet: Sheet, object: SheetObject) => {
    if (object.anchor.mode !== "2" && object.anchor.mode !== "absolute" && (sheet.rows?.some(row => row.hidden) || sheet.columns?.some(column => column.hidden))) unsupported("hidden-axis object placement");
    return objectRectangle(object, metrics(sheet), context);
  };
  if (first) {
    const rectangle = rectangleFor(first.sheet, first.object);
    const fit = settings.fit && first.object.kind === "graph";
    const paper = fit ? [Math.max(1, Math.abs(rectangle.width)), Math.max(1, Math.abs(rectangle.height))] : settings.paper ?? papers.iso_a4!;
    tick();
    const page = pdf.addPage([paper[0]!, paper[1]!]);
    await drawObject(page, first.object, fit ? 0 : 72, fit ? 0 : 72, Math.abs(rectangle.width), Math.abs(rectangle.height));
  } else {
    const chosen = settings.sheets.length ? settings.sheets : selection?.sheets;
    const printedSheets: {
      sheet: Sheet;
      print: ReturnType<typeof sheetPrintSettings>;
      positions: ReturnType<typeof metrics>;
      objects: { object: SheetObject; rectangle: ReturnType<typeof rectangleFor> }[];
      layout: ReturnType<typeof layoutPrintPages>;
    }[] = [];
    let pageCount = 0, nextPageNumber = 1;
    for (const sheet of book.sheets) {
      tick();
      if (chosen && !chosen.includes(sheet.id) || sheet.visibility && sheet.visibility !== "visible") continue;
      const print = sheetPrintSettings(sheet, context);
      if (!chosen && print.doNotPrint) continue;
      if (sheet.merges?.length || sheet.cells.some(cell => cell.richText)) unsupported("styled or merged cells");
      const showFormulas = sheetViewFlag(sheet, "displayFormulas");
      const arrayGroups = new Map<string, string>();
      if (showFormulas) for (const group of sheet.formulaGroups ?? []) {
        tick();
        if (group.kind !== "array") continue;
        // Native array elements serialize the corner expression at its anchor.
        const formula = renderPrintFormula(book, sheet, {row: group.range.startRow, column: group.range.startColumn,
          formula: group.expression, arrayStringLiterals: group.arrayStringLiterals ?? false}, context, tick);
        if (formula !== undefined) arrayGroups.set(group.id, "{" + formula + "}");
      }
      for (const cell of sheet.cells) {
        if (showFormulas) {
          const formula = (cell.formulaGroup ? arrayGroups.get(cell.formulaGroup) : undefined) ?? renderPrintFormula(book, sheet, cell, context, tick);
          if (formula !== undefined) printedFormulaText.set(cell, formula);
        }
        const normalizedStyle = normalizePdfCellStyle(cell);
        if (normalizedStyle) {
          tick();
          if (!context.fonts) unsupported("styled or merged cells");
          cellPrintStyle(normalizedStyle, tick);
        }
      }
      const storedPaper = print.paper === undefined ? undefined : papers[paperName(print.paper)];
      if (settings.paper === undefined && print.paper !== undefined && storedPaper === undefined) unsupported("persisted paper size");
      const positions = metrics(sheet), paper = settings.paper ?? storedPaper ?? papers.iso_a4!;
      const objects = sheetObjects(sheet, context).map(object => ({ object, rectangle: rectangleFor(sheet, object) }));
      let area = getCellsExtent(sheet);
      for (const { rectangle } of objects) {
        tick();
        if (rectangle.width < 0 || rectangle.height < 0 || rectangle.x < 0 || rectangle.y < 0) unsupported("mirrored or negative workbook object placement");
        const last = (axis: "row" | "column", endpoint: number) => {
          let index = 0;
          while (true) {
            tick();
            const position = positions[axis](index);
            if (position.start + position.size >= endpoint) return index;
            index++;
          }
        };
        const endRow = last("row", rectangle.y + rectangle.height), endColumn = last("column", rectangle.x + rectangle.width);
        area = { startRow: 0, startColumn: 0, endRow: Math.max(area.endRow, endRow), endColumn: Math.max(area.endColumn, endColumn) };
      }
      if (area.endRow < area.startRow || area.endColumn < area.startColumn) continue;
      const startPage = print.firstPageNumber ?? nextPageNumber;
      const layout = layoutPrintPages({ area, startPage, defaultRowPoints: typeof sheet.view?.defaultRowHeight === "number" ? sheet.view.defaultRowHeight : 12.75,
        defaultColumnPoints: typeof sheet.view?.defaultColumnWidth === "number" ? sheet.view.defaultColumnWidth : 48,
        ...(sheet.rows ? { rows: sheet.rows } : {}), ...(effectiveColumns(sheet) ? { columns: effectiveColumns(sheet)! } : {}),
        paper: { widthPoints: paper[0], heightPoints: paper[1] }, margins: print.margins, displayFormulas: sheetViewFlag(sheet, "displayFormulas"),
        rowBreaks: print.rowBreaks, columnBreaks: print.columnBreaks,
        orientation: settings.orientation ?? print.orientation, scale: settings.scale ?? print.scale, centerHorizontally: print.centerHorizontally,
        centerVertically: print.centerVertically, acrossThenDown: print.acrossThenDown }, context);
      tick(layout.pages.length);
      nextPageNumber = startPage + layout.pages.length;
      pageCount += layout.pages.length;
      if (!Number.isSafeInteger(pageCount)) throw new SsconvertError("resource-limit", "ssconvert PDF page count limit exceeded");
      printedSheets.push({ sheet, print, positions, objects, layout });
    }
    for (const { sheet, print, positions, objects, layout } of printedSheets) {
      const textSpan = createPrintSpans(sheet, positions.column, tick);
      const showFormulas = sheetViewFlag(sheet, "displayFormulas"), hideZero = sheetViewFlag(sheet, "hideZero");
      for (const geometry of layout.pages) {
        tick();
        const page = pdf.addPage([layout.widthPoints, layout.heightPoints]);
        const headerInfo = { page: geometry.number, pages: pageCount, sheetName: sheet.name, filename: context.inputFilename ?? "", path: "", title: "" };
        for (const [formats, y, enabled] of [[print.header, print.headerPoints, print.margins.top > print.headerPoints],
          [print.footer, layout.heightPoints - print.footerPoints - 10, print.margins.bottom > print.footerPoints]] as const) {
          if (!enabled) continue;
          for (const [key, x, alignment] of [["Left", print.margins.left, "left"],
            ["Middle", (print.margins.left + layout.widthPoints - print.margins.right) / 2, "center"],
            ["Right", layout.widthPoints - print.margins.right, "right"]] as const)
            await text(page, renderPrintHeaderFooter(formats[key], headerInfo, context), x, y, 10, alignment);
        }
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(layout.scaleX, 0, 0, layout.scaleY,
          geometry.originX * (1 - layout.scaleX), (page.getHeight() - geometry.originY) * (1 - layout.scaleY)));
        // Paint all cell backgrounds before any spanning text.
        for (const cell of sheet.cells) {
          tick();
          if (cell.row < geometry.area.startRow || cell.row > geometry.area.endRow || cell.column < geometry.area.startColumn || cell.column > geometry.area.endColumn) continue;
          const width = positions.column(cell.column).size, height = positions.row(cell.row).size;
          if (!width || !height) continue;
          const normalized = normalizePdfCellStyle(cell), style = normalized ? cellPrintStyle(normalized, tick) : undefined;
          if (!style?.background) continue;
          const x = geometry.originX + positions.column(cell.column).start - positions.column(geometry.area.startColumn).start;
          const y = geometry.originY + positions.row(cell.row).start - positions.row(geometry.area.startRow).start;
          page.drawRectangle({ x: x + 2, y: page.getHeight() - y - height - 0.2,
            width: width + 0.2, height: height + 0.2, color: rgb(...style.background),
            ...(style.backgroundAlpha === 1 ? {} : {opacity: style.backgroundAlpha}) });
        }
        for (const cell of sheet.cells) {
          tick();
          if (cell.row < geometry.area.startRow || cell.row > geometry.area.endRow || cell.column < geometry.area.startColumn || cell.column > geometry.area.endColumn || sheet.rows?.some(row => row.index === cell.row && row.hidden) || sheet.columns?.some(column => column.index === cell.column && column.hidden)) continue;
          const formula = showFormulas ? printedFormulaText.get(cell) ?? cell.formula : undefined;
          // gnm_cell_is_zero includes booleans and a strict 64-epsilon numeric tolerance.
          if (!formula && hideZero && (cell.value.kind === "number" ? Math.abs(cell.value.value) < 64 * Number.EPSILON :
            cell.value.kind === "boolean" && !cell.value.value)) continue;
          const value = formula ?? (cell.displayedText !== undefined && !cell.style && !context.formatting ? cell.displayedText :
            await formatting.format(cell.value, cell.format ?? "General", context, {unicodeMinus: cell.value.kind === "number"}));
          tick();
          const x = geometry.originX + positions.column(cell.column).start - positions.column(geometry.area.startColumn).start;
          const y = geometry.originY + positions.row(cell.row).start - positions.row(geometry.area.startRow).start;
          const normalizedStyle = normalizePdfCellStyle(cell);
          const style = cellPrintStyle(normalizedStyle, tick);
          const width = positions.column(cell.column).size, height = positions.row(cell.row).size;
          const alignment = style.alignment === "general" ? formula ? "left" : cell.value.kind === "number" ? "right" :
            cell.value.kind === "boolean" || cell.value.kind === "error" ? "center" : "left" : style.alignment;
          const overflow = formula || cell.value.kind === "string" ? (displayWidth: number) => {
            const required = alignment === "center" ? width + Math.max(0, (displayWidth - width + 5 * printDisplayScale) / 2) : Infinity;
            return {
              left: alignment === "left" ? 0 : textSpan(cell, x - geometry.originX + width, "left", required) - width,
              right: alignment === "right" ? 0 : textSpan(cell,
                Math.max(width, (layout.widthPoints - print.margins.right - geometry.originX) / layout.scaleX - (x - geometry.originX)), "right", required) - width
            };
          } : undefined;
          await text(page, value, x, y, style.size * printDisplayScale, alignment,
            {width, height, style, ...(overflow === undefined ? {} : {overflow})});
        }
        for (const { object, rectangle } of objects) {
          tick();
          const left = positions.column(geometry.area.startColumn).start, top = positions.row(geometry.area.startRow).start;
          const lastColumn = positions.column(geometry.area.endColumn), lastRow = positions.row(geometry.area.endRow);
          const right = lastColumn.start + lastColumn.size, bottom = lastRow.start + lastRow.size;
          if (rectangle.x >= right || rectangle.y >= bottom || rectangle.x + rectangle.width <= left || rectangle.y + rectangle.height <= top) continue;
          const spanning = rectangle.x < left || rectangle.y < top || rectangle.x + rectangle.width > right || rectangle.y + rectangle.height > bottom;
          if (spanning && (object.anchor.mode === "2" || object.anchor.mode === "absolute")) unsupported("absolute workbook objects spanning pages");
          // print_page_cells starts after GNM_COL_MARGIN (2pt). The object
          // painter adds half a point for the leading gridline and clips to
          // the printed cell range, including when an object crosses pages.
          const baseX = geometry.originX + 2, baseY = geometry.originY;
          page.pushOperators(pushGraphicsState(), pdfRectangle(baseX, page.getHeight() - baseY - (bottom - top), right - left, bottom - top), clip(), endPath());
          try {
            await drawObject(page, object, baseX + 0.5 + rectangle.x - left, baseY + 0.5 + rectangle.y - top, rectangle.width, rectangle.height);
          } finally {
            page.pushOperators(popGraphicsState());
          }
        }
        page.pushOperators(popGraphicsState());
      }
    }
  }
  tick();
  await pdf.flush();
  tick();
  let bytes: Uint8Array;
  try {
    bytes = await serializePdf(pdf.context, { outputBytes: context.limits.outputBytes,
      objects: Math.min(1000000, context.limits.workbookWork ?? context.limits.inputBytes),
      work: tick, cooperate: async () => { tick(); await new Promise<void>(resolve => setTimeout(resolve, 0)); tick(); } });
  } catch (error) {
    if (error instanceof PdfError) {
      if (error.code === "E_LIMIT") throw new SsconvertError("resource-limit", "ssconvert PDF serialization limit exceeded");
      unsupported("serialization capability");
    }
    throw error;
  }
  tick();
  if (bytes.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
  return bytes;
  } finally { shaper.dispose(); }
}
