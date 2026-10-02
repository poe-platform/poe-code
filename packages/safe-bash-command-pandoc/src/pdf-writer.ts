import type { LayoutBlock, Paragraph, TextRun, PdfLimits, PdfMetadata, StandardFontName, StandardFont } from "safe-bash-pdf-engine";
import { PandocError } from "./errors.js";
import type { Block, Inline, MetaValue } from "./ast-types.js";
import type { WriterCapability, Limits } from "./types.js";

function pdfRasterDimensions(bytes: Uint8Array, media: "png" | "jpeg", fail: (message: string) => never): {width: number; height: number} {
  if (media === "png") {
    if (bytes.length < 24) fail("Invalid PNG image header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false) * 0.75;
    const height = view.getUint32(20, false) * 0.75;
    if (width <= 0 || height <= 0) fail("Invalid PNG dimensions");
    return {width, height};
  }
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2 || i + 2 + len > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = ((bytes[i + 5]! << 8) | bytes[i + 6]!) * 0.75;
      const width = ((bytes[i + 7]! << 8) | bytes[i + 8]!) * 0.75;
      if (width > 0 && height > 0) return {width, height};
    }
    i += 2 + len;
  }
  return {width: 240, height: 160};
}

function parsePdfDimension(value: string | undefined, natural: number, maxWidth: number, fail: (message: string) => never): number {
  if (value === undefined) return natural;
  const trimmed = value.trim();
  const direct = Number(trimmed);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (trimmed.endsWith("%")) {
    const pct = Number(trimmed.slice(0, -1));
    if (Number.isFinite(pct) && pct > 0) return (maxWidth * pct) / 100;
  }
  const units: Record<string, number> = {in: 72, pt: 1, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75};
  const unit = Object.keys(units).find(u => trimmed.endsWith(u));
  const num = unit ? Number(trimmed.slice(0, -unit.length)) : NaN;
  const result = unit ? num * units[unit]! : NaN;
  if (!Number.isFinite(result) || result <= 0) fail("PDF images require numeric width and height in points");
  return result;
}

/** AST adapter only: all geometry, font operations and pagination live in pdf. */
export const pdfWriter: WriterCapability = {
  format: "pdf",
  math: "source",
  imageResources: "embed",
  async write(document, ctx) {
    const { renderPdf, suppliedDefaultFont, PdfError } = await import("safe-bash-pdf-engine");
    const fail = (message: string): never => { throw new PandocError("E_CAPABILITY", ctx.operation ?? "write", message, "pdf"); };
    if (document.direction === "rtl" || document.direction === "auto") fail("PDF profile requires explicit LTR text");
    const styledFonts = new Map<StandardFontName, StandardFont>();
    const notes: {number: number; blocks: readonly Block[]}[] = [];
    const runs = async (nodes: readonly Inline[], size = ctx.pdf?.fontSize ?? 12, link?: string, style: Pick<TextRun, "bold" | "italic" | "strikeout" | "underline"> = {}): Promise<TextRun[]> => {
      const result: TextRun[] = [];
      for (const node of nodes) {
        await ctx.cooperate(); ctx.charge("references", 1);
        if (node.t === "Str" || node.t === "Space" || node.t === "SoftBreak" || node.t === "LineBreak" || node.t === "Code") {
          const text = node.t === "Str" ? node.c : node.t === "Code" ? node.c[1] : node.t === "LineBreak" ? "\n" : " ";
          let font: string | undefined;
          if (!ctx.pdfFonts && (style.bold || style.italic || node.t === "Code")) {
            const family = node.t === "Code" ? "Courier" : "Helvetica";
            const name = (family + (style.bold && style.italic ? "-BoldOblique" : style.bold ? "-Bold" : style.italic ? "-Oblique" : "")) as StandardFontName;
            font = `standard:${name}`;
            styledFonts.set(name, {id: font, standard: name});
          }
          ctx.charge("retainedBytes", text.length * 2 + 64); result.push({text, size, ...style, ...(font === undefined ? {} : {font}), ...(link === undefined ? {} : {link})});
        } else if (node.t === "Link") result.push(...await runs(node.c[1], size, node.c[2][0], style));
        else if (node.t === "Span" || node.t === "Cite") result.push(...await runs(node.c[1], size, link, style));
        else if (node.t === "Math") {
          if (!ctx.lossy) fail("PDF math requires explicit lossy source projection");
          ctx.report({code: "W_TABLE_LOSS", operation: ctx.operation ?? "write", format: "pdf", message: "Rendered readable math source; no mathematical typesetting"});
          const text = `[math source: ${node.c[1]}]`; ctx.charge("retainedBytes", text.length * 2 + 64); result.push({text, size});
        } else if (node.t === "Note") {
          ctx.charge("retainedBytes", 64); const number = notes.length + 1; notes.push({number, blocks: node.c}); result.push({text: `[${number}]`, size});
        } else if (node.t === "Emph" || node.t === "Strong" || node.t === "Underline" || node.t === "Strikeout") {
          const key = ({Emph: "italic", Strong: "bold", Underline: "underline", Strikeout: "strikeout"} as const)[node.t];
          result.push(...await runs(node.c, size, link, {...style, [key]: true}));
        }
        else fail(`PDF inline ${node.t} is outside the supported profile`);
      }
      return result;
    };
    const metaText = async (value: MetaValue): Promise<string> => {
      if (value.t === "MetaString") return value.c;
      if (value.t === "MetaInlines") return (await runs(value.c)).map(run => run.text).join("");
      return fail("PDF descriptive metadata requires text or plain inlines");
    };
    const metadata: {title?: string; author?: string; subject?: string; keywords?: readonly string[]} = {};
    for (const key of ["title", "author", "subject", "keywords"] as const) {
      const value = document.metadata[key]; if (value === undefined) continue;
      const values = value.t === "MetaList" ? value.c : [value]; const text: string[] = [];
      for (const item of values) {await ctx.cooperate(); ctx.charge("references", 1); text.push(await metaText(item));}
      const length = text.reduce((sum, part) => sum + part.length + 2, 0); ctx.charge("retainedBytes", length * 2);
      if (key === "keywords") metadata.keywords = text;
      else metadata[key] = text.join(key === "author" ? "; " : " ");
    }
    const blocks: LayoutBlock[] = [];
    const visit = async (nodes: readonly Block[], indent = 0): Promise<void> => {
      for (const node of nodes) {
        await ctx.cooperate(); ctx.charge("references", 1); ctx.charge("retainedBytes", 64);
        if (node.t === "Para" || node.t === "Plain") {
          if (node.c.length > 1 && node.c.some(child => child.t === "Image")) {
            const fragments: Block[] = [];
            let pending: Inline[] = [];
            for (const child of node.c) {
              if (child.t === "Image") {
                if (pending.some(p => p.t !== "Space" && p.t !== "SoftBreak")) fragments.push({t: "Para", c: pending});
                fragments.push({t: "Para", c: [child]});
                pending = [];
              } else pending.push(child);
            }
            if (pending.some(p => p.t !== "Space" && p.t !== "SoftBreak")) fragments.push({t: "Para", c: pending});
            await visit(fragments, indent);
          } else if (node.c.length === 1 && node.c[0]!.t === "Image") {
            const image = node.c[0]!;
            const bytes = document.resources.find(resource => resource.id === image.c[2][0])?.bytes
              ?? await ctx.resources?.resolve(image.c[2][0], undefined, ctx.signal);
            if (!bytes) fail("PDF image requires a supplied resolved resource");
            const resolvedBytes = bytes!;
            const media = resolvedBytes[0] === 137 ? "png" : resolvedBytes[0] === 255 ? "jpeg" : fail("PDF image must be PNG or JPEG");
            const natural = pdfRasterDimensions(resolvedBytes, media, fail);
            const maxWidth = Math.max(72, (ctx.pdfPage?.width ?? 612) - (ctx.pdfPage?.margin ?? 72) * 2 - indent);
            const attrs = new Map(image.c[0][2]);
            let width = parsePdfDimension(attrs.get("width"), natural.width, maxWidth, fail);
            let height = parsePdfDimension(attrs.get("height"), natural.height, maxWidth, fail);
            if (attrs.has("width") && !attrs.has("height")) height = width * (natural.height / natural.width);
            else if (attrs.has("height") && !attrs.has("width")) width = height * (natural.width / natural.height);
            else if (!attrs.has("width") && !attrs.has("height") && width > maxWidth) {
              const scale = maxWidth / width;
              width *= scale;
              height *= scale;
            }
            blocks.push({kind: "image", bytes: resolvedBytes, media, width, height});
          } else blocks.push({kind: "paragraph", runs: await runs(node.c), indent});
        } else if (node.t === "Header") {
          const content = await runs(node.c[2], 24 - node.c[0] * 2);
          ctx.charge("retainedBytes", content.reduce((sum, run) => sum + run.text.length * 2, 0));
          blocks.push({kind: "paragraph", runs: content, outline: content.map(run => run.text).join(""), keepTogether: true, keepWithNext: true, indent});
        }
        else if (node.t === "CodeBlock") blocks.push({kind: "paragraph", runs: [{text: node.c[1], size: 10}], indent});
        else if (node.t === "Div") await visit(node.c[1], indent);
        else if (node.t === "BlockQuote") await visit(node.c, indent + 18);
        else if (node.t === "BulletList" || node.t === "OrderedList") {
          if (node.t === "OrderedList" && !["Decimal", "DefaultStyle"].includes(node.c[0][1])) fail("PDF ordered list requires decimal style");
          const items = node.t === "BulletList" ? node.c : node.c[1];
          for (let i = 0; i < items.length; i++) {
            const start = blocks.length; await visit(items[i]!, indent + 18);
            const first = blocks[start]; const number = node.t === "OrderedList" ? node.c[0][0] + i : 0;
            const marker = node.t === "BulletList" ? "- " : node.c[0][2] === "TwoParens" ? `(${number}) ` : node.c[0][2] === "OneParen" ? `${number}) ` : `${number}. `;
            if (first?.kind === "paragraph") blocks[start] = {...first, runs: [{text: marker}, ...first.runs]};
            else blocks.splice(start, 0, {kind: "paragraph", runs: [{text: marker.trim()}], indent: indent + 18, spaceAfter: 0, keepWithNext: true});
          }
        } else if (node.t === "Figure") {
          await visit(node.c[2], indent);
          if (node.c[1][1].length) await visit(node.c[1][1], indent);
          else if (node.c[1][0]?.length) blocks.push({kind: "paragraph", runs: await runs(node.c[1][0]), indent});
        }
        else if (node.t === "LineBlock") for (const line of node.c) blocks.push({kind: "paragraph", runs: await runs(line), spaceAfter: 0, indent});
        else if (node.t === "HorizontalRule") blocks.push({kind: "rule", indent});
        else if (node.t === "Table") {
          if (node.c[1][1].length) await visit(node.c[1][1], indent);
          else if (node.c[1][0]?.length) blocks.push({kind: "paragraph", runs: await runs(node.c[1][0]), indent, keepWithNext: true});
          if (indent) fail("PDF nested tables require an explicit full-width block");
          const specs = node.c[2]; if (!specs.length) fail("Empty PDF table");
          const widths = specs.map(spec => spec[1].t === "ColWidth" ? spec[1].c : 1 / specs.length);
          const total = widths.reduce((a, b) => a + b, 0);
          const rows: Paragraph[][] = [];
          const astRows = [...node.c[3][1], ...node.c[4].flatMap(body => [...body[2], ...body[3]]), ...node.c[5][1]];
          for (const row of astRows) {
            const cells: Paragraph[] = [];
            for (const [column, cell] of row[1].entries()) {
              if (cell[2] !== 1 || cell[3] !== 1) fail("PDF profile requires unspanned cells");
              const content: TextRun[] = [];
              for (const block of cell[4]) { if (block.t === "Para" || block.t === "Plain") { if (content.length) content.push({text: "\n"}); content.push(...await runs(block.c)); } else fail("PDF cells require paragraphs"); }
              const alignment = cell[1] === "AlignDefault" ? specs[column]![0] : cell[1];
              const align = ({AlignDefault: "left", AlignLeft: "left", AlignCenter: "center", AlignRight: "right"} as const)[alignment];
              cells.push({kind: "paragraph", runs: content, align});
            }
            rows.push(cells);
          }
          if (node.c[4].some(body => body[1] || body[2].length)) fail("PDF intermediate table headers/row headers are outside the supported profile");
          blocks.push({kind: "table", rows, widths: widths.map(width => width / total), headerRows: node.c[3][1].length, rowSplit: "lines"});
        } else fail(`PDF block ${node.t} is outside the supported profile`);
      }
    };
    await visit(document.blocks);
    if (notes.length) {
      blocks.push({kind: "paragraph", runs: [{text: "Notes", size: 16}], keepTogether: true, keepWithNext: true});
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i]!; const start = blocks.length; await visit(note.blocks);
        const first = blocks[start];
        if (first?.kind === "paragraph") blocks[start] = {...first, runs: [{text: `[${note.number}] `}, ...first.runs]};
        else blocks.splice(start, 0, {kind: "paragraph", runs: [{text: `[${note.number}]`}], keepWithNext: true});
      }
    }
    // Shared reservations occur before work in the engine. Output is admitted by
    // Session.finish once, so do not double-charge publication bytes here.
    const budgetMap: Partial<Record<keyof PdfLimits, keyof Limits>> = {fontBytes: "binaryBytes", fonts: "fonts", glyphs: "glyphs", pages: "pages", objects: "objects", images: "images", imageBytes: "binaryBytes", decodedImageBytes: "retainedBytes", layoutWork: "layoutWork"};
    ctx.bound("fonts", (ctx.pdfFonts?.length ?? 1) + styledFonts.size);
    const fonts = [...(ctx.pdfFonts ?? [suppliedDefaultFont(size => {ctx.bound("binaryBytes", size); ctx.charge("retainedBytes", size * 2);})]), ...styledFonts.values()];
    try {
      const bytes = await renderPdf({blocks, fonts, metadata: metadata satisfies PdfMetadata, ...(ctx.pdf?.lineHeight === undefined ? {} : {lineHeight: ctx.pdf.lineHeight}), ...(ctx.pdfPage === undefined ? {} : {page: ctx.pdfPage})}, {signal: ctx.signal, yield: () => ctx.cooperate(256), limits: {outputBytes: ctx.limits.outputBytes}, charge: (key, amount) => {
        const mapped = budgetMap[key]; if (mapped && !(key === "fontBytes" && ctx.pdfFonts !== undefined)) ctx.charge(mapped, amount);
        if (key === "fontBytes" || key === "imageBytes") ctx.charge("retainedBytes", amount);
        if (key === "glyphs") ctx.charge("retainedBytes", amount * 96);
      }});
      return {kind: "binary", bytes};
    } catch (error) {
      // A sibling engine may normalize a trusted callback throw as a font error.
      // Preserve this session's sticky budget/cancellation failure first.
      ctx.checkpoint(0);
      if (error instanceof PdfError) throw new PandocError(error.code, ctx.operation ?? "write", error.message, "pdf");
      throw error;
    }
  }
};
