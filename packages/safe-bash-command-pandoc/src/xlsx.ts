import type {CapabilityContext} from "@poe-code/spreadsheet-engine";
import type {Block, Row} from "./ast-types.js";
import type {ReaderCapability} from "./types.js";
import {PandocError} from "./errors.js";
import {literalInlines} from "./literal-inlines.js";
const attr = ["", [], []] as const;
export const xlsxReader: ReaderCapability = {format: "xlsx", async read(input, ctx) {
  const l = ctx.limits;
  const context: CapabilityContext = {signal: ctx.signal ?? new AbortController().signal, own() {},
    environment: {env: {}, locale: "C", timezone: "UTC"}, limits: {
      inputBytes: l.inputBytes, outputBytes: l.outputBytes, cells: l.tableCells, sheets: l.parts, operations: l.work,
      compressedBytes: l.compressedBytes, inflatedBytes: Math.min(l.expandedBytes, l.retainedBytes), zipEntries: l.parts,
      xmlDepth: l.xmlDepth, workbookNodes: l.xmlNodes, workbookTextBytes: l.text, workbookWork: l.work}};
  try {
    if (input.bytes.length < 22) throw new PandocError("E_PARSE", "read", "Truncated XLSX archive", "xlsx");
    const {readXlsx} = await import("@poe-code/spreadsheet-format-xlsx/xlsx");
    const {recalculateWorkbook} = await import("@poe-code/spreadsheet-engine/formulas/recalculation");
    ctx.checkpoint();
    const workbook = await recalculateWorkbook(await readXlsx(input.bytes, context), context, {force: false, ignoreCalculationMode: true});
    const blocks: Block[] = [];
    let nodes = 0;
    for (const sheet of workbook.sheets) {
      await ctx.cooperate();
      ctx.bound("nodes", ++nodes);
      const title = await literalInlines(sheet.name, ctx, nodes);
      nodes += title.length;
      blocks.push({t: "Header", c: [1, attr, title]});
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
          const inlines = await literalInlines(text, ctx, nodes);
          nodes += inlines.length;
          if (inlines.length) ctx.bound("nodes", ++nodes);
          row.push([attr, "AlignDefault", 1, 1, inlines.length ? [{t: "Plain", c: inlines}] : []]);
        }
        rows.push([attr, row]);
      }
      ctx.bound("nodes", ++nodes);
      const head = rows.shift()!;
      blocks.push({t: "Table", c: [attr, [null, []], Array.from({length: width}, () => ["AlignDefault", {t: "ColWidthDefault"}]), [attr, [head]], [[attr, 0, [], rows]], [attr, []]]});
    }
    return {blocks, metadata: {}, resources: []};
  } catch (error) {
    if (error instanceof PandocError) throw error;
    if (ctx.signal?.aborted) ctx.signal.throwIfAborted();
    const code = (error as {code?: string}).code;
    throw new PandocError(code === "resource-limit" ? "E_LIMIT" : code === "unsupported-feature" ? "E_UNSUPPORTED_FEATURE" : "E_PARSE", "read", error instanceof Error ? error.message : "Invalid XLSX", "xlsx");
  }
}};
