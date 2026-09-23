import { PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle as pdfRectangle, clip, endPath, drawObject as drawPdfObject, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit, {type Font} from "@pdf-lib/fontkit";
import { admitTrueTypeFont, suppliedDefaultFont, serializePdf, decodePng, PdfError } from "@poe-code/pdf";
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
import { cellPrintStyle, type CellPrintStyle } from "../rendering/print/cell-style.js";
import { sheetPrintSettings } from "../rendering/print/settings.js";

// Native default display DPI for the admitted materialized Gnumeric style profile.
const printDisplayScale = 72 / 96;

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
        const name = paperName(value);
        if (!Object.hasOwn(papers, name)) {
          if (value === "") throw new SsconvertError("invalid-request", "ssconvert: Unknown paper size");
          unsupported("unqualified named-paper warning profile");
        }
        paper = papers[name]!;
      }
    } else if (key === "sheet" || key === "active-sheet") {
      const sheet = key === "active-sheet" ? book.sheets.find(sheet => sheet.id === book.activeSheet) ?? book.sheets[0] : book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(value));
      if (!sheet) throw new SsconvertError("invalid-request", `ssconvert: Unknown sheet "${value}"`);
      sheets.push(sheet.id);
    } else throw new SsconvertError("invalid-request", `ssconvert: Invalid export option "${key}" for format Gnumeric_pdf:pdf_assistant`);
  }
  return { paper, fit, objects, sheets };
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
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setProducer("ssconvert JavaScript PDF writer");
  const fonts = new Map<boolean, {font: PDFFont; metrics: Font; ascentRatio: number; descentRatio: number}>();
  let fontBytes = 0;
  const text = async (page: PDFPage, value: string, x: number, y: number, size = 10, alignment: "left" | "center" | "right" = "left", cellBox?: { width: number; height: number; style: CellPrintStyle }) => {
    tick(value.length);
    if (!value) return;
    const bold = cellBox?.style.bold ?? false;
    let selected = fonts.get(bold);
    if (!selected) {
      pdf.registerFontkit(fontkit);
      let bytes: Uint8Array;
      if (context.fonts) {
        const supplied = await context.fonts.resolve(Object.freeze({ family: "Sans", bold, italic: false,
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
        pdf.registerFontkit({ create: () => parsed });
        selected = {font: await pdf.embedFont(bytes, { subset: true }), metrics: parsed,
          ascentRatio: parsed.ascent / parsed.unitsPerEm, descentRatio: -parsed.descent / parsed.unitsPerEm};
        fonts.set(bold, selected);
      }
      catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof SsconvertError) throw error;
        unsupported("supplied font parsing");
      }
      tick();
    }
    const {font, metrics, ascentRatio, descentRatio} = selected;
    if (cellBox && (value.includes("\n") || value.includes("\r"))) unsupported("default-style text layout");
    const supported = new Set(font.getCharacterSet());
    for (const scalar of value) if (!supported.has(scalar.codePointAt(0)!)) unsupported("font coverage");
    let baseline = page.getHeight() - y - size;
    let width = cellBox ? 0 : font.widthOfTextAtSize(value, size);
    if (cellBox) {
      const ascent = ascentRatio * size, height = ascent + descentRatio * size;
      const glyphs: {x: number; y: number}[] = [];
      // Pango rounds shaped advances in display pixels before print scaling.
      for (const position of metrics.layout(value).positions) {
        tick();
        const advance = position.xAdvance * cellBox.style.size / metrics.unitsPerEm;
        if (!Number.isFinite(advance) || advance < 0 || !Number.isFinite(position.xOffset) || !Number.isFinite(position.yOffset) || position.yAdvance !== 0) unsupported("supplied font advances");
        glyphs.push({x: width + position.xOffset * size / metrics.unitsPerEm, y: position.yOffset * size / metrics.unitsPerEm});
        width += Math.round(advance) * printDisplayScale;
      }
      if (width > cellBox.width - 5 || height > cellBox.height - (1 - printDisplayScale)) unsupported("default-style text layout");
      // print_page_cells adds 2pt;the cell painter adds half a grid plus its scaled 3px text margin.
      x += 2 + 0.5 + 3 * printDisplayScale + (alignment === "left" ? 0 : (cellBox.width - 5) / (alignment === "center" ? 2 : 1));
      baseline = page.getHeight() - y - cellBox.height + (1 - printDisplayScale) + height - ascent;
      x -= alignment === "left" ? 0 : width / (alignment === "center" ? 2 : 1);
      const encoded = font.encodeText(value).asString();
      if (encoded.length !== glyphs.length * 4) unsupported("supplied font glyph mapping");
      const resource = page.node.newFontDictionary(font.name, font.ref);
      // Positioned marks can be reordered by text extractors; retain the logical cell string.
      page.pushOperators(pushGraphicsState(), PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence,
        [PDFName.of("Span"), pdf.context.obj({ActualText: PDFHexString.fromText(value)}).toString()]),
      beginText(), setFontAndSize(resource, size), setFillingRgbColor(...cellBox.style.foreground));
      for (const [index, glyph] of glyphs.entries()) {
        tick();
        page.pushOperators(setTextMatrix(1, 0, 0, 1, x + glyph.x, baseline + glyph.y), showText(PDFHexString.of(encoded.slice(index * 4, index * 4 + 4))));
      }
      page.pushOperators(endText(), PDFOperator.of(PDFOperatorNames.EndMarkedContent), popGraphicsState());
      return;
    }
    page.drawText(value, { x: x - (alignment === "left" ? 0 : width / (alignment === "center" ? 2 : 1)), y: baseline, size, font });
  };
  const metrics = (sheet: Sheet) => {
    const axis = (entries: readonly AxisMetadata[] | undefined, fallback: number) => (index: number) => {
      let start = index * fallback, size = fallback;
      for (const entry of entries ?? []) { tick(); if (entry.index < index) start += (entry.hidden ? 0 : entry.sizePoints ?? fallback) - fallback; if (entry.index === index) size = entry.sizePoints ?? fallback; }
      return { start, size };
    };
    return { column: axis(sheet.columns, typeof sheet.view?.defaultColumnWidth === "number" ? sheet.view.defaultColumnWidth : 48), row: axis(sheet.rows, typeof sheet.view?.defaultRowHeight === "number" ? sheet.view.defaultRowHeight : 12.75) };
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
      try { bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0)); } catch { return unsupported("image encoding"); }
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
    let pageCount = 0;
    for (const sheet of book.sheets) {
      tick();
      if (chosen && !chosen.includes(sheet.id) || sheet.visibility && sheet.visibility !== "visible") continue;
      const print = sheetPrintSettings(sheet, context);
      if (!chosen && print.doNotPrint) continue;
      if (sheet.merges?.length || sheet.cells.some(cell => cell.richText)) unsupported("styled or merged cells");
      for (const cell of sheet.cells) if (cell.style) {
        tick();
        if (!context.fonts) unsupported("styled or merged cells");
        cellPrintStyle(cell.style, tick);
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
      const layout = layoutPrintPages({ area, startPage: pageCount + 1, defaultRowPoints: typeof sheet.view?.defaultRowHeight === "number" ? sheet.view.defaultRowHeight : 12.75,
        defaultColumnPoints: typeof sheet.view?.defaultColumnWidth === "number" ? sheet.view.defaultColumnWidth : 48,
        ...(sheet.rows ? { rows: sheet.rows } : {}), ...(sheet.columns ? { columns: sheet.columns } : {}),
        paper: { widthPoints: paper[0], heightPoints: paper[1] }, margins: print.margins,
        rowBreaks: print.rowBreaks, columnBreaks: print.columnBreaks,
        orientation: print.orientation, scale: print.scale, centerHorizontally: print.centerHorizontally,
        centerVertically: print.centerVertically, acrossThenDown: print.acrossThenDown }, context);
      tick(layout.pages.length);
      pageCount += layout.pages.length;
      if (!Number.isSafeInteger(pageCount)) throw new SsconvertError("resource-limit", "ssconvert PDF page count limit exceeded");
      printedSheets.push({ sheet, print, positions, objects, layout });
    }
    for (const { sheet, print, positions, objects, layout } of printedSheets) {
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
        for (const cell of sheet.cells) {
          tick();
          if (cell.row < geometry.area.startRow || cell.row > geometry.area.endRow || cell.column < geometry.area.startColumn || cell.column > geometry.area.endColumn || sheet.rows?.some(row => row.index === cell.row && row.hidden) || sheet.columns?.some(column => column.index === cell.column && column.hidden)) continue;
          const value = cell.style || context.formatting ? await formatting.format(cell.value, cell.format ?? "General", context, {unicodeMinus: cell.value.kind === "number"}) : cell.displayedText ?? (cell.value.kind === "blank" ? "" : cell.value.kind === "boolean" ? cell.value.value ? "TRUE" : "FALSE" : String(cell.value.value));
          tick();
          const x = geometry.originX + positions.column(cell.column).start - positions.column(geometry.area.startColumn).start;
          const y = geometry.originY + positions.row(cell.row).start - positions.row(geometry.area.startRow).start;
          const style = cell.style ? cellPrintStyle(cell.style, tick) : undefined;
          const width = positions.column(cell.column).size, height = positions.row(cell.row).size;
          if (style?.background) page.drawRectangle({x: x + 2, y: page.getHeight() - y - height - 0.2,
            width: width + 0.2, height: height + 0.2, color: rgb(...style.background)});
          const alignment = style?.alignment === "general" ? cell.value.kind === "number" ? "right" :
            cell.value.kind === "boolean" || cell.value.kind === "error" ? "center" : "left" : style?.alignment ?? "left";
          await text(page, value, x, y, style ? style.size * printDisplayScale : 10, alignment,
            style ? {width, height, style} : undefined);
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
}
