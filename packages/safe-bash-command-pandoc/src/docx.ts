import type {Paragraph, DocxBlock, DocxRunInput, DocumentModelContext} from "docx";
import type {Block, Inline, Row} from "./ast-types.js";
import type {AdapterContext, ReaderCapability, WriterCapability} from "./types.js";
import {PandocError} from "./errors.js";
const attr = ["", [], []] as const;
async function modelContext(ctx: AdapterContext): Promise<DocumentModelContext> {
  const {DocumentBudget} = await import("docx");
  const l = ctx.limits;
  const signal = ctx.signal ?? new AbortController().signal;
  return {signal, budget: new DocumentBudget({compressedInput: l.compressedBytes, expandedPackage: l.expandedBytes,
    zipEntries: l.parts, xmlPartBytes: l.binaryBytes, xmlNodes: l.xmlNodes, xmlDepth: l.xmlDepth,
    retainedBytes: l.retainedBytes, serializedOutput: l.outputBytes, work: l.work,
    tableCells: l.tableCells, tableRows: l.tableRows, tableColumns: l.tableColumns}, signal, async () => ctx.cooperate())};
}
async function guarded<T>(ctx: AdapterContext, action: () => Promise<T>): Promise<T> {
  try {return await action();} catch (error) {
    if (error instanceof PandocError) throw error;
    const code = (error as {code?: string}).code;
    throw new PandocError(code === "cancelled" ? "E_CANCELLED" : code === "limit-exceeded" ? "E_LIMIT" : "E_PARSE",
      ctx.operation ?? "convert", error instanceof Error ? error.message : "Invalid DOCX", "docx");
  }
}
export const docxReader: ReaderCapability = {format: "docx", async read(input, ctx) {
  return guarded(ctx, async () => {
    const {Document: openDocument, Paragraph, Run} = await import("docx");
    const model = await openDocument(input.bytes, await modelContext(ctx));
    const paragraph = (p: Paragraph): Block => {
      const inlines: Inline[] = [];
      for (const item of p.iter_inner_content()) {
        ctx.checkpoint();
        const runs = item instanceof Run ? [item] : item.runs;
        const content = runs.map(run => {
          let inline: Inline = {t: "Str", c: run.text};
          if (run.bold) inline = {t: "Strong", c: [inline]};
          if (run.italic) inline = {t: "Emph", c: [inline]};
          return inline;
        });
        if (item instanceof Run) inlines.push(...content);
        else inlines.push({t: "Link", c: [attr, content, [item.url, ""]]});
      }
      const name = p.style?.name ?? "";
      const level = name.startsWith("Heading ") ? Number(name.slice(8)) : 0;
      return level >= 1 && level <= 6 ? {t: "Header", c: [level, attr, inlines]} : {t: "Para", c: inlines};
    };
    const blocks: Block[] = [];
    for (const item of model.iter_inner_content()) {
      await ctx.cooperate();
      if (item instanceof Paragraph) blocks.push(paragraph(item));
      else {
        const rows: Row[] = [];
        for (const row of item.rows) rows.push([attr, row.cells.map(cell => [attr, "AlignDefault", 1, 1, cell.paragraphs.map(paragraph)])]);
        blocks.push({t: "Table", c: [attr, [null, []], Array.from({length: item.columns.length}, () => ["AlignDefault", {t: "ColWidthDefault"}]), [attr, []], [[attr, 0, [], rows]], [attr, []]]});
      }
    }
    return {blocks, metadata: {}, resources: []};
  });
}};
export const docxWriter: WriterCapability = {format: "docx", async write(document, ctx) {
  return guarded(ctx, async () => {
    const blocks: DocxBlock[] = [];
    const runs = (nodes: readonly Inline[], bold = false, italic = false): DocxRunInput[] => {
      const result: DocxRunInput[] = [];
      for (const node of nodes) {
        ctx.checkpoint();
        if (node.t === "Strong") result.push(...runs(node.c, true, italic));
        else if (node.t === "Emph") result.push(...runs(node.c, bold, true));
        else if (node.t === "Span") result.push(...runs(node.c[1], bold, italic));
        else {
          let text: string;
          if (node.t === "Str") text = node.c;
          else if (node.t === "Space" || node.t === "SoftBreak") text = " ";
          else if (node.t === "LineBreak") text = "\n";
          else if (node.t === "Code") text = node.c[1];
          else throw new PandocError("E_UNSUPPORTED_FEATURE", "write", `Unsupported DOCX inline: ${node.t}`, "docx");
          result.push({text, bold, italic});
        }
      }
      return result;
    };
    for (const block of document.blocks) {
      await ctx.cooperate();
      if (block.t === "Header") blocks.push({kind: "paragraph", level: block.c[0], runs: runs(block.c[2])});
      else if (block.t === "Para" || block.t === "Plain") blocks.push({kind: "paragraph", runs: runs(block.c)});
      else if (block.t === "CodeBlock") blocks.push({kind: "paragraph", text: block.c[1]});
      else throw new PandocError("E_UNSUPPORTED_FEATURE", "write", `Unsupported DOCX block: ${block.t}`, "docx");
    }
    const {createDocumentArchive, writeDocumentArchive} = await import("docx");
    const mc = await modelContext(ctx);
    const archiveContext = {signal: mc.signal!, budget: mc.budget!};
    const archive = await createDocumentArchive({content: {version: 1, blocks}}, archiveContext);
    const chunks: Uint8Array[] = []; let size = 0;
    await writeDocumentArchive(archive, {async write(bytes) {size += bytes.length; ctx.bound("outputBytes", size); ctx.charge("retainedBytes", bytes.length); chunks.push(new Uint8Array(bytes));}}, {order: "name", compression: "store"}, archiveContext);
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    return {kind: "binary", bytes};
  });
}};
