import type {CapabilityContext} from "safe-bash-command-ssconvert";
import type {Block, Row} from "./ast-types.js";
import type {ReaderCapability} from "./types.js";
import {PandocError} from "./errors.js";
const attr = ["", [], []] as const;
export const xlsxReader: ReaderCapability = {format: "xlsx", async read(input, ctx) {
  const l = ctx.limits;
  const context: CapabilityContext = {signal: ctx.signal ?? new AbortController().signal, own() {},
    environment: {env: {}, locale: "C", timezone: "UTC"}, limits: {
      inputBytes: l.inputBytes, outputBytes: l.outputBytes, cells: l.tableCells, sheets: l.parts, operations: l.work,
      compressedBytes: l.compressedBytes, inflatedBytes: Math.min(l.expandedBytes, l.retainedBytes), zipEntries: l.parts,
      xmlDepth: l.xmlDepth, workbookNodes: l.xmlNodes, workbookTextBytes: l.text, workbookWork: l.work}};
  try {
    const {readXlsx} = await import("safe-bash-command-ssconvert");
    ctx.checkpoint();
    const workbook = await readXlsx(input.bytes, context);
    const blocks: Block[] = [];
    for (const sheet of workbook.sheets) {
      await ctx.cooperate();
      blocks.push({t: "Header", c: [1, attr, [{t: "Str", c: sheet.name}]]});
      if (!sheet.cells.length) continue;
      let height = 0, width = 0;
      for (const cell of sheet.cells) {ctx.checkpoint(); height = Math.max(height, cell.row + 1); width = Math.max(width, cell.column + 1);}
      ctx.bound("tableRows", height); ctx.bound("tableColumns", width); ctx.charge("tableCells", height * width);
      ctx.charge("retainedBytes", height * width * 128);
      const cells = new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
      const rows: Row[] = [];
      for (let r = 0; r < height; r++) {
        const row: Row[1][number][] = [];
        for (let c = 0; c < width; c++) {
          await ctx.cooperate();
          const cell = cells.get(`${r}:${c}`);
          const value = cell?.cachedResult ?? cell?.value;
          const text = cell?.displayedText ?? (value && value.kind !== "blank" ? String(value.value) : "");
          ctx.bound("tableFieldText", text.length);
          row.push([attr, "AlignDefault", 1, 1, text ? [{t: "Plain", c: [{t: "Str", c: text}]}] : []]);
        }
        rows.push([attr, row]);
      }
      blocks.push({t: "Table", c: [attr, [null, []], Array.from({length: width}, () => ["AlignDefault", {t: "ColWidthDefault"}]), [attr, []], [[attr, 0, [], rows]], [attr, []]]});
    }
    return {blocks, metadata: {}, resources: []};
  } catch (error) {
    if (error instanceof PandocError) throw error;
    if (ctx.signal?.aborted) ctx.signal.throwIfAborted();
    const code = (error as {code?: string}).code;
    throw new PandocError(code === "resource-limit" ? "E_LIMIT" : code === "unsupported-feature" ? "E_UNSUPPORTED_FEATURE" : "E_PARSE", "read", error instanceof Error ? error.message : "Invalid XLSX", "xlsx");
  }
}};
