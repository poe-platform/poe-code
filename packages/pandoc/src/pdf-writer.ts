import { renderPdf, suppliedDefaultFont, PdfError, type LayoutBlock, type Paragraph, type TextRun, type PdfLimits, type PdfMetadata } from "@poe-code/pdf";
import { PandocError } from "./errors.js";
import type { Block, Inline, MetaValue } from "./ast-types.js";
import type { WriterCapability, Limits } from "./types.js";

/** AST adapter only: all geometry, font operations and pagination live in pdf. */
export const pdfWriter: WriterCapability = {
  format: "pdf",
  math: "source",
  async write(document, ctx) {
    const fail = (message: string): never => { throw new PandocError("E_CAPABILITY", ctx.operation ?? "write", message, "pdf"); };
    if (document.direction === "rtl" || document.direction === "auto") fail("PDF profile requires explicit LTR text");
    const notes: {number: number; blocks: readonly Block[]}[] = [];
    const runs = async (nodes: readonly Inline[], size = ctx.pdf?.fontSize ?? 12, link?: string): Promise<TextRun[]> => {
      const result: TextRun[] = [];
      for (const node of nodes) {
        await ctx.cooperate(); ctx.charge("references", 1);
        if (node.t === "Str" || node.t === "Space" || node.t === "SoftBreak" || node.t === "LineBreak" || node.t === "Code") {
          const text = node.t === "Str" ? node.c : node.t === "Code" ? node.c[1] : node.t === "LineBreak" ? "\n" : " ";
          ctx.charge("retainedBytes", text.length * 2 + 64); result.push({text, size, ...(link === undefined ? {} : {link})});
        } else if (node.t === "Link") result.push(...await runs(node.c[1], size, node.c[2][0]));
        else if (node.t === "Span") result.push(...await runs(node.c[1], size, link));
        else if (node.t === "Math") {
          if (!ctx.lossy) fail("PDF math requires explicit lossy source projection");
          ctx.report({code: "W_TABLE_LOSS", operation: ctx.operation ?? "write", format: "pdf", message: "Rendered readable math source; no mathematical typesetting"});
          const text = `[math source: ${node.c[1]}]`; ctx.charge("retainedBytes", text.length * 2 + 64); result.push({text, size});
        } else if (node.t === "Note") {
          ctx.charge("retainedBytes", 64); const number = notes.length + 1; notes.push({number, blocks: node.c}); result.push({text: `[${number}]`, size});
        } else if (node.t === "Emph" || node.t === "Strong" || node.t === "Underline" || node.t === "Strikeout" || node.t === "SmallCaps") fail(`PDF ${node.t} needs an explicit styled font resource`);
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
          if (node.c.length === 1 && node.c[0]!.t === "Image") {
            const image = node.c[0]!; const bytes = document.resources.find(resource => resource.id === image.c[2][0])?.bytes;
            if (!bytes) fail("PDF image requires a supplied resolved resource");
            const attrs = new Map(image.c[0][2]);
            const width = Number(attrs.get("width")); const height = Number(attrs.get("height"));
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) fail("PDF images require numeric width and height in points");
            const media = bytes![0] === 137 ? "png" : bytes![0] === 255 ? "jpeg" : fail("PDF image must be PNG or JPEG");
            blocks.push({kind: "image", bytes: bytes!, media, width, height});
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
        else if (node.t === "Table") {
          if (node.c[1][1].length) await visit(node.c[1][1], indent);
          else if (node.c[1][0]?.length) blocks.push({kind: "paragraph", runs: await runs(node.c[1][0]), indent, keepWithNext: true});
          if (indent) fail("PDF nested tables require an explicit full-width block");
          const specs = node.c[2]; if (!specs.length) fail("Empty PDF table");
          if (specs.some(spec => !["AlignDefault", "AlignLeft"].includes(spec[0]))) fail("PDF profile supports left-aligned tables only");
          const widths = specs.map(spec => spec[1].t === "ColWidth" ? spec[1].c : 1 / specs.length);
          const total = widths.reduce((a, b) => a + b, 0);
          const rows: Paragraph[][] = [];
          const astRows = [...node.c[3][1], ...node.c[4].flatMap(body => [...body[2], ...body[3]]), ...node.c[5][1]];
          for (const row of astRows) {
            const cells: Paragraph[] = [];
            for (const cell of row[1]) {
              if (cell[2] !== 1 || cell[3] !== 1 || !["AlignDefault", "AlignLeft"].includes(cell[1])) fail("PDF profile requires unspanned left-aligned cells");
              const content: TextRun[] = [];
              for (const block of cell[4]) { if (block.t === "Para" || block.t === "Plain") { if (content.length) content.push({text: "\n"}); content.push(...await runs(block.c)); } else fail("PDF cells require paragraphs"); }
              cells.push({kind: "paragraph", runs: content});
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
    ctx.bound("fonts", ctx.pdfFonts?.length ?? 1);
    const fonts = ctx.pdfFonts ?? [suppliedDefaultFont(size => {ctx.bound("binaryBytes", size); ctx.charge("retainedBytes", size * 2);})];
    try {
      const bytes = await renderPdf({blocks, fonts, metadata: metadata satisfies PdfMetadata, ...(ctx.pdf?.lineHeight === undefined ? {} : {lineHeight: ctx.pdf.lineHeight}), ...(ctx.pdfPage === undefined ? {} : {page: ctx.pdfPage})}, {signal: ctx.signal, yield: () => ctx.cooperate(256), limits: {outputBytes: ctx.limits.outputBytes}, charge: (key, amount) => {
        const mapped = budgetMap[key]; if (mapped && !(key === "fontBytes" && ctx.pdfFonts !== undefined)) ctx.charge(mapped, amount);
        if (key === "fontBytes" || key === "imageBytes") ctx.charge("retainedBytes", amount);
        if (key === "glyphs") ctx.charge("retainedBytes", amount * 96);
      }});
      return {kind: "binary", bytes};
    } catch (error) { if (error instanceof PdfError) throw new PandocError(error.code, ctx.operation ?? "write", error.message, "pdf"); throw error; }
  }
};
