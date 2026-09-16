import { renderPdf, suppliedDefaultFont, PdfError, type LayoutBlock, type Paragraph, type TextRun, type PdfLimits } from "@poe-code/pdf";
import { PandocError } from "./errors.js";
import type { Block, Inline } from "./ast-types.js";
import type { WriterCapability, Limits } from "./types.js";

/** AST adapter only: all geometry, font operations and pagination live in pdf. */
export const pdfWriter: WriterCapability = {
  format: "pdf",
  async write(document, ctx) {
    const fail = (message: string): never => { throw new PandocError("E_CAPABILITY", ctx.operation ?? "write", message, "pdf"); };
    if (document.direction === "rtl" || document.direction === "auto") fail("PDF profile requires explicit LTR text");
    const runs = async (nodes: readonly Inline[], size = 12, link?: string): Promise<TextRun[]> => {
      const result: TextRun[] = [];
      for (const node of nodes) {
        await ctx.cooperate(); ctx.charge("references", 1);
        if (node.t === "Str" || node.t === "Space" || node.t === "SoftBreak" || node.t === "LineBreak" || node.t === "Code") {
          const text = node.t === "Str" ? node.c : node.t === "Code" ? node.c[1] : node.t === "LineBreak" ? "\n" : " ";
          ctx.charge("retainedBytes", text.length * 2 + 64); result.push({text, size, ...(link === undefined ? {} : {link})});
        } else if (node.t === "Link") result.push(...await runs(node.c[1], size, node.c[2][0]));
        else if (node.t === "Span") result.push(...await runs(node.c[1], size, link));
        else fail(`PDF inline ${node.t} is outside the supported profile`);
      }
      return result;
    };
    const blocks: LayoutBlock[] = [];
    const visit = async (nodes: readonly Block[]): Promise<void> => {
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
          } else blocks.push({kind: "paragraph", runs: await runs(node.c)});
        } else if (node.t === "Header") blocks.push({kind: "paragraph", runs: await runs(node.c[2], 24 - node.c[0] * 2), keepTogether: true});
        else if (node.t === "CodeBlock") blocks.push({kind: "paragraph", runs: [{text: node.c[1], size: 10}]});
        else if (node.t === "Div") await visit(node.c[1]);
        else if (node.t === "LineBlock") for (const line of node.c) blocks.push({kind: "paragraph", runs: await runs(line), spaceAfter: 0});
        else if (node.t === "Table") {
          if (node.c[1][0]?.length || node.c[1][1].length) fail("PDF table captions are outside the supported profile");
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
          blocks.push({kind: "table", rows, widths: widths.map(width => width / total)});
        } else fail(`PDF block ${node.t} is outside the supported profile`);
      }
    };
    await visit(document.blocks);
    // Shared reservations occur before work in the engine. Output is admitted by
    // Session.finish once, so do not double-charge publication bytes here.
    const budgetMap: Partial<Record<keyof PdfLimits, keyof Limits>> = {fontBytes: "binaryBytes", fonts: "fonts", glyphs: "glyphs", pages: "pages", objects: "objects", images: "images", imageBytes: "binaryBytes", decodedImageBytes: "retainedBytes", layoutWork: "layoutWork"};
    ctx.bound("fonts", 1);
    const font = suppliedDefaultFont(size => {ctx.bound("binaryBytes", size); ctx.charge("retainedBytes", size * 2);});
    try {
      const bytes = await renderPdf({blocks, fonts: [font]}, {signal: ctx.signal, yield: () => ctx.cooperate(256), limits: {outputBytes: ctx.limits.outputBytes}, charge: (key, amount) => {
        const mapped = budgetMap[key]; if (mapped) ctx.charge(mapped, amount);
        if (key === "fontBytes" || key === "imageBytes") ctx.charge("retainedBytes", amount);
        if (key === "glyphs") ctx.charge("retainedBytes", amount * 96);
      }});
      return {kind: "binary", bytes};
    } catch (error) { if (error instanceof PdfError) throw new PandocError(error.code, ctx.operation ?? "write", error.message, "pdf"); throw error; }
  }
};
