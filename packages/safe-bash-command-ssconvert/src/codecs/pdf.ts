import {printBidiRuns} from "@poe-code/spreadsheet-engine/rendering/print/bidi-runs";
import {rotatedPrintLayout} from "@poe-code/spreadsheet-engine/rendering/print/rotated-text";
import {printSharedBorders} from "@poe-code/spreadsheet-engine/rendering/print/shared-borders";
import {printBorderStrokes} from "@poe-code/spreadsheet-engine/rendering/print/diagonal-borders";
import {createPrintBlankStyles} from "@poe-code/spreadsheet-engine/rendering/print/blank-styles";
import {printDiagonalBorders} from "@poe-code/spreadsheet-engine/rendering/print/diagonal-borders";
import {createPrintMerges} from "@poe-code/spreadsheet-engine/rendering/print/merges";
import {justifyPrintLine} from "@poe-code/spreadsheet-engine/rendering/print/justify-line";
import {wrapPrintLine} from "@poe-code/spreadsheet-engine/rendering/print/wrap-lines";
import { PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, rgb, moveTo, lineTo, closePath, fill as fillPath, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle as pdfRectangle, clip, endPath, drawObject as drawPdfObject, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor, setGraphicsState, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit, {type Font} from "@pdf-lib/fontkit";
import { admitTrueTypeFont, suppliedDefaultFont, serializePdf, decodePng, PdfError } from "safe-bash-pdf-engine";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { createFormattingCapability } from "../formatting.js";
import { exportOptionPairs } from "../cli/export-options.js";
import { foldSheetName } from "../workbook/case-fold.js";
import { getCellsExtent, type Workbook, type Sheet, type AxisMetadata, type Range } from "../workbook.js";
import { sheetObjects, type SheetObject } from "../objects/index.js";
import { objectRectangle } from "../objects/layout.js";
import { graphBackground } from "../rendering/images/scene.js";
import { layoutPrintPages } from "../rendering/print/layout.js";
import { renderPrintHeaderFooter } from "../rendering/print/header-footer.js";
import { nextPrintTabStop, mirrorPrintTabRuns } from "@poe-code/spreadsheet-engine/rendering/print/tab-layout";
import { splitPrintLines, fillPrintNewlines, fillPrintItems } from "@poe-code/spreadsheet-engine/rendering/print/text-lines";
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
  const fonts = new Map<string, {font: PDFFont; metrics: Font; shear: number; bytes: Uint8Array; shaped: boolean; supported: ReadonlySet<number>; ascentRatio: number; descentRatio: number}>();
  let fontBytes = 0;
  const selectFont = async (family: string, bold: boolean, italic: boolean) => {
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
        // A resolver can supply an upright fallback for an italic request.
        // Match Cairo's synthetic oblique matrix without slanting italic faces twice.
        const head = parsed.head as {macStyle?: {italic?: boolean}} | undefined;
        const os2 = parsed["OS/2"] as {fsSelection?: {italic?: boolean; oblique?: boolean}} | undefined;
        const shear = italic && !head?.macStyle?.italic && !os2?.fsSelection?.italic && !os2?.fsSelection?.oblique ? 0.2 : 0;
        selected = {font: embeddedFont, metrics: parsed, shear, bytes, shaped: true, supported: new Set(embeddedFont.getCharacterSet()),
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
    return selected;
  };
  const text = async (page: PDFPage, value: string, x: number, y: number, size = 10, alignment: "left" | "center" | "right" = "left", cellBox?: { width: number; height: number; style: CellPrintStyle; generalNumber?: number; zoom?: number; wrap?: boolean; fillString?: boolean; overflow?: (displayWidth: number) => {left: number; right: number} }) => {
    tick(value.length);
    if (!value) return;
    const bold = cellBox?.style.bold ?? false, italic = cellBox?.style.italic ?? false, family = cellBox?.style.family ?? "Sans";
    const selected = await selectFont(family, bold, italic);
    const {font, metrics, shear, supported, ascentRatio, descentRatio} = selected;
    const rotation = cellBox?.style.rotation ?? 0;
    const cellX = x, cellY = y;
    if (cellBox?.generalNumber !== undefined && !rotation) {
      const defaultFont = await selectFont("Sans", false, false);
      // Screen row height is rounded ascent + descent, plus the one-pixel grid.
      const pixelScale = (Math.ceil(defaultFont.ascentRatio * 10 / printDisplayScale) +
        Math.ceil(defaultFont.descentRatio * 10 / printDisplayScale) + 1) / 12.75;
      const available = Math.max(0, Math.floor(cellBox.width * pixelScale * (cellBox.zoom ?? 1) + 0.5) - 5);
      const measure = (text: string) => {
        let width = 0;
        for (const position of shaper.shape(metrics, text).positions) {
          tick();
          width += Math.round(position.xAdvance * cellBox.style.size / metrics.unitsPerEm);
        }
        return width;
      };
      value = await formatting.format({kind: "number", value: cellBox.generalNumber}, "General", context,
        {unicodeMinus: true, generalLayout: {width: available, measure}});
    }
    if (cellBox?.style.alignment === "fill" && cellBox.fillString && value.includes("\n")) {
      value = fillPrintNewlines(value, shaper.shape(metrics, value).direction === "rtl", tick);
    }
    const singleParagraph = cellBox?.style.alignment === "fill";
    const tabbedFill = singleParagraph && value.includes("\t");
    const separatorFill = singleParagraph && (value.includes("\u2028") || value.includes("\r"));
    const vectorFill = tabbedFill || separatorFill;
    const markerOnly = separatorFill && value.split("\u2028").join("").split("\u2029").join("").split("\r").join("") === "";
    const paragraphs = cellBox && !singleParagraph ? splitPrintLines(value, tick) : [{text: value, forced: false}];
    const shapedLines = paragraphs.map(line => cellBox ? normalizeFontText(line.text, supported, tick) : line.text);
    for (const line of shapedLines) for (const scalar of line) {
      tick();
      if (!(singleParagraph && (scalar === "\u2029" || scalar === "\u2028" || scalar === "\r" || scalar === "\t")) && !supported.has(scalar.codePointAt(0)!)) unsupported("font coverage");
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
      let ascent = ascentRatio * size, lineHeight = ascent + descentRatio * size;
      let tabWidth = 0, displayTabWidth = 0;
      if (tabbedFill) {
        if (!supported.has(32)) unsupported("font coverage");
        for (const position of shaper.shape(metrics, " ").positions) {
          tick();
          const advance = position.xAdvance * cellBox.style.size / metrics.unitsPerEm;
          tabWidth += Math.round(advance) * printDisplayScale * 8;
          displayTabWidth += Math.round(advance / printDisplayScale) * printDisplayScale * 8;
        }
        if (!(tabWidth > 0) || !Number.isFinite(tabWidth) || !(displayTabWidth > 0) || !Number.isFinite(displayTabWidth)) unsupported("supplied font advances");
      }
      let separator: {width: number; displayWidth: number; inkLeft: number; inkRight: number; inkBottom: number; points: readonly (readonly [number, number])[];
        frame: {x: number; y: number; width: number; height: number; stroke: number};
        digits: readonly {text: string; x: number; y: number}[]; mini: Awaited<ReturnType<typeof selectFont>>; miniSize: number} | undefined;
      if (separatorFill) {
        // Pango 1.56.3 measures control boxes with a smaller monospace font.
        // U+2028 uses those metrics for a vector arrow; CR prints its hex value.
        const mini = await selectFont("monospace", bold, italic);
        const miniSize = Math.round(cellBox.style.size / 2.2 * 1024) / 1024;
        let digitWidth = 0, digitHeight = 0;
        for (const digit of "0123456789ABCDEF") {
          tick();
          if (!mini.supported.has(digit.codePointAt(0)!)) unsupported("font coverage");
          const box = mini.metrics.glyphForCodePoint(digit.codePointAt(0)!).bbox;
          digitWidth = Math.max(digitWidth, (box.maxX - box.minX) / mini.metrics.unitsPerEm * miniSize);
          digitHeight = Math.max(digitHeight, (box.maxY - box.minY) / mini.metrics.unitsPerEm * miniSize);
        }
        const pad = Math.min((ascentRatio + descentRatio) * cellBox.style.size / 43, miniSize);
        const boxHeight = 5 * pad + 2 * digitHeight;
        const fontAscent = ascentRatio * cellBox.style.size, fontDescent = descentRatio * cellBox.style.size;
        const boxDescent = boxHeight <= fontAscent ? 2 * pad : boxHeight <= fontAscent + fontDescent - 2 * pad ?
          2 * pad + boxHeight - fontAscent : fontDescent * boxHeight / (fontAscent + fontDescent);
        if (markerOnly) {
          ascent = Math.trunc((boxHeight + pad - boxDescent) * 1024) / 1024 * printDisplayScale;
          lineHeight = Math.trunc((boxHeight + 2 * pad) * 1024) / 1024 * printDisplayScale;
        }
        const logicalWidth = Math.trunc((7 * pad + 2 * digitWidth) * 1024) / 1024;
        const width = Math.round(logicalWidth) * printDisplayScale;
        const length = width * 0.6, tip = Math.min(digitWidth * printDisplayScale, length * 0.75);
        const halfLine = pad * printDisplayScale / 2, halfTip = 5 * halfLine;
        const height = length - tip / 2;
        const x = width * 0.2, y = ((5 * pad + 2 * digitHeight) * printDisplayScale - length) / 2;
        const frameWidth = (5 * pad + 2 * digitWidth) * printDisplayScale;
        const frameLeft = Math.floor((width - frameWidth) / (2 * pad * printDisplayScale)) * pad * printDisplayScale;
        separator = {width, mini, miniSize: miniSize * printDisplayScale,
          frame: {x: frameLeft + 3 * halfLine, y: (-boxDescent + pad / 2) * printDisplayScale,
            width: frameWidth - pad * printDisplayScale, height: (boxHeight - pad) * printDisplayScale, stroke: pad * printDisplayScale},
          digits: [..."000D"].map((text, index) => ({text,
            x: frameLeft + (3 * pad + index % 2 * (digitWidth + pad)) * printDisplayScale,
            y: (-boxDescent + 2 * pad + (index < 2 ? digitHeight + pad : 0)) * printDisplayScale})),
          inkLeft: pad * printDisplayScale, inkRight: (6 * pad + 2 * digitWidth) * printDisplayScale,
          inkBottom: -boxDescent * printDisplayScale, displayWidth: Math.round(logicalWidth / printDisplayScale) * printDisplayScale,
          points: [[x,y],[x+tip,y+halfTip],[x+tip,y+halfLine],[x+length-halfLine,y+halfLine],
            [x+length-halfLine,y+height],[x+length+halfLine,y+height],[x+length+halfLine,y-halfLine],
            [x+tip,y-halfLine],[x+tip,y-halfTip]]};
      }
      const shapeLine = (shapedValue: string) => {
        const glyphs: {x: number; y: number}[] = [];
        const markers: {x: number; carriageReturn: boolean}[] = [];
        let width = 0, displayWidth = 0;
        const advances: number[] = [];
        const runs: ReturnType<typeof shaper.shape>[] = [];
        // Native Fill itemization separates paragraph boundaries and tabs.
        // Tabs use shared stops across the entire repeated line.
        const rtlFill = singleParagraph && shaper.shape(metrics, shapedValue).direction === "rtl";
        const rtlTabs = rtlFill && tabbedFill;
        const bidiTabs = tabbedFill && !["\r", "\u2028", "\u2029"].some(control => shapedValue.includes(control));
        const tabPositions: {x: number}[] = [];
        const tabRuns: {start: number; end: number; first: number; last: number}[] = [];
        const chunks = singleParagraph ? shapedValue.split("\t") : [shapedValue];
        for (const [index, chunk] of chunks.entries()) {
          tick();
          if (index > 0) {
            width = nextPrintTabStop(width, tabWidth);
            displayWidth = nextPrintTabStop(displayWidth, displayTabWidth);
          }
          const start = width, first = tabPositions.length;
          const parts = singleParagraph ? fillPrintItems(chunk, rtlFill, tick) : [chunk];
          for (const part of parts) {
            tick();
            // Repeated edge separators can leave a copy separator alone.
            // It has no paint or advance and must not imply an LTR text run.
            if (!part || rtlFill && part.split("\u200b").join("") === "") continue;
            if ((part === "\u2028" || part === "\r") && separator) {
              const marker = {x: width, carriageReturn: part === "\r"};
              markers.push(marker);
              if (rtlTabs) tabPositions.push(marker);
              width += separator.width;
              displayWidth += separator.displayWidth;
              continue;
            }
            const items = bidiTabs ? printBidiRuns(part, rtlFill ? "rtl" : "ltr", tick) : [{text: part}];
            for (const item of items) {
              const run = shaper.shape(metrics, item.text);
              if ("direction" in item && run.direction !== item.direction) unsupported("bidirectional shaping direction");
              runs.push(run);
              for (const position of run.positions) {
                tick();
                const advance = position.xAdvance * cellBox.style.size / metrics.unitsPerEm;
                if (!Number.isFinite(advance) || advance < 0 || !Number.isFinite(position.xOffset) || !Number.isFinite(position.yOffset) || position.yAdvance !== 0) unsupported("supplied font advances");
                const glyph = {x: width + Math.round(position.xOffset * cellBox.style.size / metrics.unitsPerEm) * printDisplayScale,
                  y: -Math.round(-position.yOffset * cellBox.style.size / metrics.unitsPerEm) * printDisplayScale};
                glyphs.push(glyph);
                if (rtlTabs) tabPositions.push(glyph);
                advances.push(Math.round(advance));
                width += Math.round(advance) * printDisplayScale;
                displayWidth += Math.round(advance / printDisplayScale) * printDisplayScale;
              }
            }
          }
          if (rtlTabs) tabRuns.push({start, end: width, first, last: tabPositions.length});
        }
        if (rtlTabs) mirrorPrintTabRuns(tabPositions, tabRuns, width, tick);
        if (!bidiTabs && runs.length > 1 && runs.some(run => run.direction === "rtl") && !(rtlFill && runs.every(run => run.direction === "rtl"))) unsupported("bidirectional fill layout");
        const run = runs.length < 2 ? runs[0] : Object.create(runs[0]!, {
          glyphs: {value: runs.flatMap(run => run.glyphs)}, positions: {value: runs.flatMap(run => run.positions)}
        }) as NonNullable<typeof runs[0]>;
        return {shapedValue, run, glyphs, width, displayWidth, advances, markers};
      };
      let indent = 0, displayIndent = 0;
      if (cellBox.style.indent && alignment !== "center" && cellBox.style.alignment !== "fill" && cellBox.style.alignment !== "justify" && cellBox.style.alignment !== "distributed") {
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
      const bordered = cellBox.style.borders?.some(border => ["Top", "Bottom", "Left", "Right"].includes(border.side)) ?? false;
      const fill = cellBox.style.alignment === "fill";
      let fillLayout: ReturnType<typeof rotatedPrintLayout> | undefined;
      if (fill) {
        if (shaper.shape(metrics, value).direction === "rtl") {
          alignment = "right";
        }
        if (shapedLines.length !== 1) unsupported("fill control-character layout");
        const naturalWidth = shapeLine(shapedLines[0]!).width;
        if (rotation && !bordered) fillLayout = rotatedPrintLayout({angle: rotation, widths: [naturalWidth], ascent, lineHeight,
          width: cellBox.width, height: cellBox.height, indent: 0, bordered, alignment, vertical: cellBox.style.verticalAlignment}, tick);
        const repeatWidth = fillLayout?.width ?? naturalWidth;
        const copies = rotation && bordered ? 1 : repeatWidth > 0 ? Math.floor((cellBox.width - 5) / repeatWidth) : 1;
        if (copies >= 2) {
          // Copy separators have ordinary font extents. Native retains the
          // original Fill height but paints the repeated line with its new baseline.
          if (separatorFill) ascent = ascentRatio * size;
          tick(copies * (value.length + 1));
          if (!supported.has(0x200b)) unsupported("font coverage");
          shapedLines[0] = Array.from({length: copies}, () => shapedLines[0]!).join("​");
          value = value.repeat(copies);
        }
        if (fillLayout && alignment === "right") {
          fillLayout = rotatedPrintLayout({angle: rotation, widths: [naturalWidth], ascent, lineHeight,
            horizontalWidth: shapeLine(shapedLines[0]!).width, width: cellBox.width, height: cellBox.height,
            indent: 0, bordered, alignment, vertical: cellBox.style.verticalAlignment}, tick);
        }
      }
      const wraps = cellBox.wrap === true && (!rotation || bordered);
      const wrapWidth = rotation ? Math.max(0, cellBox.width - 5 - indent) * Math.cos(rotation * Math.PI / 180) + (cellBox.height - 1) * Math.abs(Math.sin(rotation * Math.PI / 180)) : Math.max(0, cellBox.width - 5 - indent);
      const lines = (wraps ? paragraphs.flatMap(line => wrapPrintLine(line.text, wrapWidth,
        candidate => shapeLine(normalizeFontText(candidate, supported, tick)).width, tick).map((part, index, parts) => ({...part, justify: line.forced || index < parts.length - 1}))) : shapedLines.map(text => ({text, hyphen: false, justify: false})))
        .map(line => {
          if (line.hyphen && !supported.has(0x2010)) unsupported("font coverage");
          const paintText = line.hyphen && line.text.endsWith("­") ? line.text.slice(0, -1) : line.text;
          const shaped = normalizeFontText(paintText + (line.hyphen ? "‐" : ""), supported, tick);
          const logicalText = line.text.split("​").join("").split("⁠").join("");
          const result = shapeLine(shaped);
          if (line.justify && result.run && (cellBox.style.alignment === "justify" || cellBox.style.alignment === "distributed")) {
            const expanded = justifyPrintLine(shaped, result.run, result.advances, (wrapWidth - result.width) / printDisplayScale, tick);
            for (const [index, glyph] of result.glyphs.entries()) {tick(); glyph.x += expanded.offsets[index]! * printDisplayScale;}
            result.width += expanded.added * printDisplayScale;
          }
          return {...result, logicalText, marked: line.hyphen || shaped !== logicalText};
        });
      const height = lineHeight * lines.length;
      let displayWidth = 0;
      for (const line of lines) {
        tick();
        width = Math.max(width, line.width);
        displayWidth = Math.max(displayWidth, line.displayWidth);
      }
      const overflows = width + indent > cellBox.width - 5;
      if (!rotation && overflows && !fill && !wraps && cellBox.overflow === undefined && cellBox.generalNumber === undefined || !Number.isFinite(height)) unsupported("default-style text layout");
      const overflow = rotation ? undefined : cellBox.overflow?.(displayWidth + displayIndent);
      const clipLeft = x + 4 - (overflow?.left ?? 0);
      const clipWidth = Math.max(0, cellBox.width + (overflow?.left ?? 0) + (overflow?.right ?? 0) - 4);
      // print_page_cells adds 2pt;the cell painter adds half a grid plus its scaled 3px text margin.
      x += 2 + 0.5 + 3 * printDisplayScale + (alignment === "left" ? 0 : (cellBox.width - 5) / (alignment === "center" ? 2 : 1));
      if (alignment === "center" && cellBox.style.alignment !== "distributed" && overflow && (overflow.left > 0 || overflow.right > 0)) {
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
      const rotated = fillLayout?.origins ?? (rotation ? rotatedPrintLayout({angle: rotation, ...(wraps ? {layoutWidth: wrapWidth} : {}), widths: lines.map(line => line.width), ascent, lineHeight,
        width: cellBox.width, height: cellBox.height, indent, bordered, alignment, vertical: cellBox.style.verticalAlignment}, tick).origins : undefined);
      // Cairo emits no paint or extractable glyphs at zero foreground alpha.
      // Keep the layout calculations above so spans and neighboring cells agree.
      if (cellBox.style.foregroundAlpha === 0) return;
      const blockX = x, firstBaseline = baseline;
      const resource = page.node.newFontDictionary(font.name, font.ref);
      // Positioned marks can be reordered by text extractors; retain the logical cell string.
      page.pushOperators(pushGraphicsState());
      if (cellBox.style.foregroundAlpha !== 1) {
        const alpha = page.node.newExtGState("CellAlpha", pdf.context.obj({Type: "ExtGState", ca: cellBox.style.foregroundAlpha, CA: cellBox.style.foregroundAlpha}));
        page.pushOperators(setGraphicsState(alpha));
      }
      if (!rotation && (overflows || height > cellBox.height - 1)) page.pushOperators(
        pdfRectangle(clipLeft, page.getHeight() - y - cellBox.height, clipWidth, cellBox.height), clip(), endPath());
      if (!wraps && !rotation && !vectorFill) page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence,
        [PDFName.of("Span"), pdf.context.obj({ActualText: PDFHexString.fromText(value)}).toString()]));
      for (const [lineIndex, line] of lines.entries()) {
        const {run, glyphs, shapedValue} = line;
        if (!run && !line.markers.length) continue;
        // Pango hints centered lines to whole display pixels when layout and
        // line widths are integral; an implicit wrapping width need not be.
        const centeredOffset = (width - line.width) / 2;
        x = blockX + (alignment === "left" ? 0 : alignment === "right" ? width - line.width :
          wraps && !Number.isInteger((cellBox.width - 5) / printDisplayScale) ? centeredOffset :
            Math.round(centeredOffset / printDisplayScale) * printDisplayScale);
        baseline = firstBaseline - lineIndex * (lineHeight + lineSpacing);
        if (rotated) {
          const angle = rotation * Math.PI / 180, origin = rotated[lineIndex]!;
          page.pushOperators(pushGraphicsState(), concatTransformationMatrix(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), cellX + 2.5 + origin.x, page.getHeight() - cellY - origin.y));
          x = 0; baseline = 0;
        }
        if ((wraps || rotation) && line.marked && !vectorFill) page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence,
          [PDFName.of("Span"), pdf.context.obj({ActualText: PDFHexString.fromText(line.logicalText)}).toString()]));
        // Encode the same shaped run that supplies the positioned glyphs.
        const layout = metrics.layout;
        let encoded = "";
        try {
          if (run) {
            metrics.layout = () => run;
            encoded = font.encodeText(shapedValue).asString();
          }
        } finally { metrics.layout = layout; }
        if (encoded.length !== glyphs.length * 4) unsupported("supplied font glyph mapping");
        page.pushOperators(beginText(), setFontAndSize(resource, size), setFillingRgbColor(...cellBox.style.foreground));
        for (const [index, glyph] of glyphs.entries()) {
          tick();
          const points = run!.glyphs[index]!.codePoints;
          if (vectorFill && !rotation && overflows) {
            // Cairo omits wholly clipped glyphs; emitting them would expose
            // invisible tab overflow to PDF text extractors.
            const box = run!.glyphs[index]!.bbox, scale = size / metrics.unitsPerEm;
            const left = x + glyph.x + (box.minX + Math.min(shear * box.minY, shear * box.maxY)) * scale;
            const right = x + glyph.x + (box.maxX + Math.max(shear * box.minY, shear * box.maxY)) * scale;
            if (left >= clipLeft + clipWidth || right <= clipLeft) continue;
          }
          if (vectorFill && points.length > 0 && points.every(point => point === 0x200b) && run!.positions[index]!.xAdvance === 0) continue;
          page.pushOperators(setTextMatrix(1, 0, shear, 1, x + glyph.x, baseline + glyph.y), showText(PDFHexString.of(encoded.slice(index * 4, index * 4 + 4))));
        }
        page.pushOperators(endText());
        if ((wraps || rotation) && line.marked && !vectorFill) page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
        if (separator) {
          const miniResource = line.markers.some(marker => marker.carriageReturn) ? page.node.newFontDictionary(separator.mini.font.name, separator.mini.font.ref) : undefined;
          for (const marker of line.markers) {
            tick(separator.points.length);
            if (marker.carriageReturn) {
              if (!rotation) page.pushOperators(pushGraphicsState(), pdfRectangle(clipLeft, page.getHeight() - y - cellBox.height,
                clipWidth, cellBox.height), clip(), endPath());
              const frame = separator.frame;
              page.drawRectangle({x: x + marker.x + frame.x, y: baseline + frame.y, width: frame.width, height: frame.height,
                borderWidth: frame.stroke, borderColor: rgb(...cellBox.style.foreground)});
              page.pushOperators(beginText(), setFontAndSize(miniResource!, separator.miniSize));
              for (const digit of separator.digits) {
                tick();
                page.pushOperators(setTextMatrix(1, 0, separator.mini.shear, 1, x + marker.x + digit.x, baseline + digit.y), showText(separator.mini.font.encodeText(digit.text)));
              }
              page.pushOperators(endText());
              if (!rotation) page.pushOperators(popGraphicsState());
            } else page.pushOperators(...separator.points.map(([px, py], index) => (index ? lineTo : moveTo)(x + marker.x + px, baseline + py)), closePath(), fillPath());
          }
        }
        if (cellBox.style.underline || cellBox.style.strikeThrough) {
          // Pango uses font underline metrics and the union of positioned ink bounds.
          const scale = size / metrics.unitsPerEm;
          const thickness = metrics.underlineThickness ? metrics.underlineThickness * scale : printDisplayScale;
          const position = metrics.underlinePosition ? metrics.underlinePosition * scale : -printDisplayScale;
          let inkLeft = Infinity, inkRight = -Infinity, inkBottom = Infinity;
          for (const [index, glyph] of (run?.glyphs ?? []).entries()) {
            tick();
            const box = glyph.bbox, origin = glyphs[index]!;
            if (!Number.isFinite(box.minX)) continue; // Spaces have no ink.
            inkLeft = Math.min(inkLeft, origin.x + (box.minX + shear * box.minY) * scale);
            inkRight = Math.max(inkRight, origin.x + (box.maxX + shear * box.maxY) * scale);
            inkBottom = Math.min(inkBottom, origin.y + box.minY * scale);
          }
          if (separator) for (const {x: offset} of line.markers) {
            tick();
            inkLeft = Math.min(inkLeft, offset + separator.inkLeft);
            inkRight = Math.max(inkRight, offset + separator.inkRight);
            inkBottom = Math.min(inkBottom, separator.inkBottom);
          }
          const low = cellBox.style.underline === 3;
          const lineY = baseline + (low ? Math.min(0, inkBottom) - 2 * thickness : position - thickness);
          if (low && !rotation) page.pushOperators(pdfRectangle(clipLeft, page.getHeight() - y - cellBox.height,
            clipWidth, cellBox.height), clip(), endPath());
          for (let decoration = 0; decoration < (cellBox.style.underline === 0 ? 0 : cellBox.style.underline === 2 || cellBox.style.underline === 4 ? 2 : 1); decoration++) {
            tick();
            const decorationY = lineY - decoration * 2 * thickness;
            // A marker-only bottom-aligned line can put its underline beyond
            // the cell edge. Native clips that paint, but leaves rotated lines free.
            const bottom = separator && !rotation ? Math.max(decorationY, page.getHeight() - y - cellBox.height) : decorationY;
            const top = separator && !rotation ? Math.min(decorationY + thickness, page.getHeight() - y) : decorationY + thickness;
            if (top <= bottom) continue;
            page.drawRectangle({x: x + Math.min(0, inkLeft), y: bottom,
              width: Math.max(line.width, Number.isFinite(inkRight - inkLeft) ? inkRight - inkLeft : 0),
              height: top - bottom, color: rgb(...cellBox.style.foreground)});
          }
          if (cellBox.style.strikeThrough && Number.isFinite(inkRight - inkLeft)) {
            // Fontkit decodes these standard OS/2 fields, but omits them from its declaration.
            const os2 = metrics["OS/2"] as {yStrikeoutSize?: number; yStrikeoutPosition?: number} | undefined;
            const strikeThickness = os2?.yStrikeoutSize ? os2.yStrikeoutSize * scale : printDisplayScale;
            const strikePosition = os2?.yStrikeoutPosition ? os2.yStrikeoutPosition * scale : ascent / 2;
            tick();
            page.drawRectangle({x: x + inkLeft, y: baseline + strikePosition - strikeThickness,
              width: markerOnly ? inkRight : inkRight - inkLeft, height: strikeThickness, color: rgb(...cellBox.style.foreground)});
          }
        }
        if (rotated) page.pushOperators(popGraphicsState());
      }
      if (!wraps && !rotation && !vectorFill) page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
      page.pushOperators(popGraphicsState());
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
      hiddenRows: ReadonlySet<number>;
      hiddenColumns: ReadonlySet<number>;
      cells: readonly Sheet["cells"][number][];
      mergedCells: ReadonlyMap<Sheet["cells"][number], Range>;
      blankCells: ReturnType<typeof createPrintBlankStyles>;
    }[] = [];
    let pageCount = 0, nextPageNumber = 1;
    for (const sheet of book.sheets) {
      tick();
      if (chosen && !chosen.includes(sheet.id) || sheet.visibility && sheet.visibility !== "visible") continue;
      const print = sheetPrintSettings(sheet, context);
      if (!chosen && print.doNotPrint) continue;
      if (sheet.cells.some(cell => cell.richText)) unsupported("styled or merged cells");
      const mergeRows = createPrintMerges(sheet.merges ?? [], tick);
      const mergedCells = new Map<Sheet["cells"][number], Range>();
      const blankCells = createPrintBlankStyles(sheet, mergeRows, tick);
      const cells = sheet.cells.filter(cell => {
        const merge = mergeRows(cell.row).find(range => {tick(); return range.startColumn <= cell.column && range.endColumn >= cell.column;});
        if (!merge) return true;
        if (cell.row !== merge.startRow || cell.column !== merge.startColumn) return false;
        mergedCells.set(cell, merge);
        return true;
      });
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
      const hiddenRows = new Set<number>(), hiddenColumns = new Set<number>();
      for (const row of sheet.rows ?? []) { tick(); if (row.hidden) hiddenRows.add(row.index); }
      for (const column of sheet.columns ?? []) { tick(); if (column.hidden) hiddenColumns.add(column.index); }
      // Native print areas exclude hidden and empty-valued allocated cells.
      // Empty strings still count; stored VALUE_EMPTY cells do not.
      let area = getCellsExtent({...sheet, cells: cells.filter(cell => {
        tick(); return cell.value.kind !== "blank" && !hiddenRows.has(cell.row) && !hiddenColumns.has(cell.column);
      })});
      for (const [cell, range] of mergedCells) {
        tick();
        if (cell.value.kind === "blank" || hiddenRows.has(cell.row) || hiddenColumns.has(cell.column)) continue;
        area = {...area, endRow: Math.max(area.endRow, range.endRow), endColumn: Math.max(area.endColumn, range.endColumn)};
      }
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
      const emptyArea = area.endRow < area.startRow || area.endColumn < area.startColumn;
      if (emptyArea)
        area = {startRow: 0, startColumn: 0, endRow: 0, endColumn: 0};
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
      printedSheets.push({ sheet, print, positions, objects, layout, hiddenRows, hiddenColumns, cells: emptyArea ? cells.filter(cell => {tick(); return !hiddenRows.has(cell.row);}) : cells, mergedCells, blankCells });
    }
    for (const { sheet, print, positions, objects, layout, hiddenRows, hiddenColumns, cells, mergedCells, blankCells } of printedSheets) {
      const indexedCells = new Map<string, Sheet["cells"][number]>();
      for (const cell of sheet.cells) {tick(); indexedCells.set(`${cell.row}:${cell.column}`, cell);}
      const textSpan = createPrintSpans({...sheet, cells}, positions.column, tick);
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
        const pageColumn = positions.column(geometry.area.startColumn), pageLastColumn = positions.column(geometry.area.endColumn);
        const pageRow = positions.row(geometry.area.startRow), pageLastRow = positions.row(geometry.area.endRow);
        const mergedClip = [pushGraphicsState(), pdfRectangle(geometry.originX + 2,
          page.getHeight() - geometry.originY - (pageLastRow.start + pageLastRow.size - pageRow.start),
          pageLastColumn.start + pageLastColumn.size - pageColumn.start + 0.2,
          pageLastRow.start + pageLastRow.size - pageRow.start + 0.2), clip(), endPath()];
        const spans = new Map<number, {left: number; right: number}[]>();
        const paintedCells = [...cells.map(cell => ({cell, merge: mergedCells.get(cell)})), ...blankCells.blankCells(geometry.area)].flatMap(({cell, merge}) => {
          tick();
          const range = merge ?? {startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column};
          if (range.endRow < geometry.area.startRow || range.startRow > geometry.area.endRow || range.endColumn < geometry.area.startColumn || range.startColumn > geometry.area.endColumn || !merge && hiddenRows.has(cell.row) || hiddenColumns.has(cell.column)) return [];
          const firstColumn = positions.column(range.startColumn), lastColumn = positions.column(range.endColumn);
          const firstRow = positions.row(range.startRow), lastRow = positions.row(range.endRow);
          const width = merge ? lastColumn.start + lastColumn.size - firstColumn.start : firstColumn.size;
          const height = merge ? lastRow.start + lastRow.size - firstRow.start : firstRow.size;
          if (!width || !height) return [];
          const style = cellPrintStyle(normalizePdfCellStyle(cell), tick);
          return [{cell, merge, width, height, style,
            x: geometry.originX + firstColumn.start - pageColumn.start,
            y: geometry.originY + firstRow.start - pageRow.start}];
        });
        // Paint all cell backgrounds before any spanning text.
        const backgrounds = [...paintedCells].sort((a, b) => {tick(); return a.cell.row - b.cell.row || a.cell.column - b.cell.column;});
        for (const {merge, width, height, style, x, y} of backgrounds) {
          tick();
          if (!style.background) continue;
          if (merge) page.pushOperators(...mergedClip);
          page.drawRectangle({ x: x + 2, y: page.getHeight() - y - height - 0.2,
            width: width + 0.2, height: height + 0.2, color: rgb(...style.background),
            ...(style.backgroundAlpha === 1 ? {} : {opacity: style.backgroundAlpha}) });
          if (merge) page.pushOperators(popGraphicsState());
        }
        const drawDiagonals = ({width, height, style, x, y}: typeof paintedCells[number]) => {
          for (const line of printDiagonalBorders(style.borders ?? [], width, height, tick)) {
            tick();
            page.drawLine({start: {x: x + 2 + line.x1, y: page.getHeight() - y - line.y1},
              end: {x: x + 2 + line.x2, y: page.getHeight() - y - line.y2}, thickness: line.width,
              color: rgb(...line.border.color), opacity: line.border.alpha,
              ...("dash" in line ? {dashArray: [...line.dash]} : {}), ...("phase" in line ? {dashPhase: line.phase} : {})});
          }
        };
        for (const painted of paintedCells) if (!painted.merge) drawDiagonals(painted);
        for (const {cell, merge, width, height, style, x, y} of paintedCells) {
          tick();
          const formula = showFormulas ? printedFormulaText.get(cell) ?? cell.formula : undefined;
          // gnm_cell_is_zero includes booleans and a strict 64-epsilon numeric tolerance.
          if (!formula && hideZero && (cell.value.kind === "number" ? Math.abs(cell.value.value) < 64 * Number.EPSILON :
            cell.value.kind === "boolean" && !cell.value.value)) continue;
          const generalNumber = !formula && cell.value.kind === "number" && (cell.format === undefined || cell.format === "General") &&
            (context.formatting !== undefined || cell.displayedText === undefined) ? cell.value.value : undefined;
          const value = generalNumber !== undefined ? String(generalNumber) : formula ?? (cell.displayedText !== undefined && !cell.style && !context.formatting ? cell.displayedText :
            await formatting.format(cell.value, cell.format ?? "General", context, {unicodeMinus: cell.value.kind === "number"}));
          tick();
          const alignment = style.alignment === "fill" || style.alignment === "justify" ? "left" : style.alignment === "distributed" ? "center" : style.alignment === "general" ? formula ? "left" : cell.value.kind === "number" ? "right" :
            cell.value.kind === "boolean" || cell.value.kind === "error" ? "center" : "left" : style.alignment;
          const wrap = (style.alignment !== "fill" || Boolean(style.rotation)) && Boolean(formula || cell.value.kind === "string") && (style.wrap === true || style.alignment === "justify" || style.verticalAlignment === "justify" || style.verticalAlignment === "distributed");
          const overflow = !merge && style.alignment !== "fill" && !wrap && (formula || cell.value.kind === "string") ? (displayWidth: number) => {
            const required = alignment === "center" ? width + Math.max(0, (displayWidth - width + 5 * printDisplayScale) / 2) : Infinity;
            const extent = {
              left: alignment === "left" ? 0 : textSpan(cell, x - geometry.originX + width, "left", required) - width,
              right: alignment === "right" ? 0 : textSpan(cell,
                Math.max(width, (layout.widthPoints - print.margins.right - geometry.originX) / layout.scaleX - (x - geometry.originX)), "right", required) - width
            };
            const needed = width + Math.max(0, displayWidth - width + 5 * printDisplayScale) / (alignment === "center" ? 2 : 1);
            const left = alignment === "left" ? 0 : textSpan(cell, width + extent.left, "left", needed) - width;
            const right = alignment === "right" ? 0 : textSpan(cell, width + extent.right, "right", needed) - width;
            if (left > 0 || right > 0) {
              const start = positions.column(cell.column).start;
              const row = spans.get(cell.row) ?? [];
              row.push({left: start - left, right: start + width + right}); spans.set(cell.row, row);
            }
            return extent;
          } : undefined;
          if (merge) page.pushOperators(...mergedClip);
          await text(page, value, x, y, style.size * printDisplayScale, alignment,
            {width, height, style, wrap, fillString: !formula && cell.value.kind === "string",
              ...(generalNumber === undefined ? {} : {generalNumber, zoom: Number(sheet.view?.zoom ?? 1)}),
              ...(merge ? {overflow: () => ({left: 0, right: 0})} : overflow === undefined ? {} : {overflow})});
          if (merge) page.pushOperators(popGraphicsState());
        }
        // Native merged diagonals are painted after the corner text.
        for (const painted of paintedCells) if (painted.merge) {
          page.pushOperators(...mergedClip);
          drawDiagonals(painted);
          page.pushOperators(popGraphicsState());
        }
        for (const line of printSharedBorders(geometry.area, {
          borders(row, column) {
            tick(); const cell = indexedCells.get(`${row}:${column}`);
            return cellPrintStyle(cell ? normalizePdfCellStyle(cell) : blankCells.styleAt(row, column), tick).borders ?? [];
          }, column: positions.column, row: positions.row, hiddenRows, hiddenColumns,
          merges: sheet.merges ?? [], spans
        }, tick)) {
          tick(); const stroke = printBorderStrokes[line.border.style]!;
          page.drawLine({start: {x: geometry.originX + 2 + line.x1, y: page.getHeight() - geometry.originY - line.y1},
            end: {x: geometry.originX + 2 + line.x2, y: page.getHeight() - geometry.originY - line.y2},
            thickness: stroke.width, color: rgb(...line.border.color), opacity: line.border.alpha,
            ...("dash" in stroke ? {dashArray: [...stroke.dash]} : {}), ...("phase" in stroke ? {dashPhase: stroke.phase} : {})});
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
