import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { AnalysisRequest } from "../solver.js";
import { DEFAULT_SHEET_SIZE, formatA1, type Cell, type CellRange, type Workbook } from "../workbook.js";
import { quoteNativeSheet } from "../formulas/serialization.js";
import { recalculateWithDiagnostics } from "../formulas/diagnostics.js";
import { statisticalAnalysis } from "./statistical.js";

/** The protocol is shared by built-in tools and explicitly injected analysis engines. */
export async function runAnalysisTool(book: Workbook, request: AnalysisRequest, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  const options = request.toolOptions;
  if (options && request.tool !== "moving-average")
    return statisticalAnalysis(book, request.tool, options, context);
  if (!options || request.tool !== "moving-average")
    throw new SsconvertError("unsupported-feature", `Unsupported ssconvert analysis tool: ${request.tool}`);
  const properties = options.properties;
  if (properties["show-graph"])
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: moving-average variant");
  const source = book.sheets.find(sheet => sheet.id === options.sheet)!;
  const input = options.data;
  if (input?.endSheet !== undefined && input.endSheet !== input.sheet)
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: analysis sheet span");
  const sourceSheet = input ? book.sheets.find(sheet => sheet.id === input.sheet)! : source;
  const size = source.size ?? DEFAULT_SHEET_SIZE;
  const rowGroups = properties["group-by"] === 0;
  const cut = properties["group-by"] === 0 || properties["group-by"] === 1;
  const groups = input ? cut ? rowGroups ? input.endRow - input.startRow + 1 : input.endColumn - input.startColumn + 1 : 1 : 0;
  const labels = properties.labels === true;
  const dataWindow = (range: CellRange): CellRange => {
    if (!labels) return range;
    // Gnumeric normalizes even the reversed window resulting from a lone label.
    const start = (rowGroups ? range.startColumn : range.startRow) + 1;
    const end = rowGroups ? range.endColumn : range.endRow;
    return { ...range, ...(rowGroups
      ? { startColumn: Math.min(start, end), endColumn: Math.max(start, end) }
      : { startRow: Math.min(start, end), endRow: Math.max(start, end) }) };
  };
  const window = input ? dataWindow(input) : undefined;
  const height = window ? rowGroups ? window.endColumn - window.startColumn + 1 : window.endRow - window.startRow + 1 : 0;
  const stride = properties["std-error-flag"] ? 2 : 1;
  const outputGroups = Math.min(groups, Math.ceil(size.columns / stride));
  const outputHeight = Math.min(height, size.rows - 1);
  let existingCells = 0;
  for (const sheet of book.sheets) existingCells += sheet.cells.length;
  for (const sheet of book.detachedSheets ?? []) existingCells += sheet.cells.length;
  if (book.sheets.length + (book.detachedSheets?.length ?? 0) >= context.limits.sheets || outputGroups * stride * (outputHeight + 1) > context.limits.cells - existingCells)
    throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
  const cells: Cell[] = [];
  const interval = Number(properties.interval), offset = Number(properties.offset);
  const mode = Number(properties["ma-type"]);
  if ((mode === 2 || mode === 3) && (mode === 2 ? interval : 15) * outputGroups * outputHeight > context.limits.operations)
    throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
  const absolute = (row: number, column: number) => {
    const address = formatA1(row, column, sourceSheet.size);
    let split = 0;
    while (split < address.length && address[split]! >= "A" && address[split]! <= "Z") split++;
    return "$" + address.slice(0, split) + "$" + address.slice(split);
  };
  const text = (range: CellRange) => quoteNativeSheet(sourceSheet.name) + "!" + absolute(range.startRow, range.startColumn) + (range.startRow === range.endRow && range.startColumn === range.endColumn ? "" : ":" + absolute(range.endRow, range.endColumn));
  const formula = (row: number, column: number, expression: string) => cells.push({ row, column,
    value: { kind: "blank" }, formula: expression, formulaDirty: true });
  for (let group = 0; group < outputGroups; group++) {
    const column = group * stride;
    context.signal.throwIfAborted();
    const originalRange = { ...input!,
      ...(cut ? rowGroups ? { startRow: input!.startRow + group, endRow: input!.startRow + group }
        : { startColumn: input!.startColumn + group, endColumn: input!.startColumn + group } : {}) };
    if (labels) {
      cells.push({ row: 0, column, value: { kind: "blank" },
        formula: `=index(${text(originalRange)})`, formulaDirty: true, style: { italic: true } });
    } else cells.push({ row: 0, column, value: { kind: "string", value: `${rowGroups ? "Row" : "Column"} ${group + 1}` } });
    const range = dataWindow(originalRange);
    const average = (move: number, count: number) => `average(offset(${text(range)},${rowGroups ? 0 : move},${rowGroups ? move : 0},${rowGroups ? 1 : count},${rowGroups ? count : 1}))`;
    for (let row = 1; row <= outputHeight; row++) {
      context.signal.throwIfAborted();
      const move = row - interval + (mode === 2 ? 0 : offset);
      if (mode === 1) formula(row, column, `=${average(0, row)}`);
      else if (move < 0 || move >= height - interval + 1 || mode === 4 && move === 0)
        cells.push({ row, column, value: { kind: "error", value: "#N/A" } });
      else if (mode === 4) formula(row, column, `=average(${average(move - 1, interval)},${average(move, interval)})`);
      else if (mode === 2 || mode === 3) {
        const weights = mode === 2 ? Array.from({ length: interval }, (_, i) => i + 1) : [-3,-6,-5,3,21,45,67,74,67,46,21,3,-5,-6,-3];
        const terms = weights.map((weight, i) => `${weight}*index(${text(range)},${rowGroups ? 1 : move + i + 1},${rowGroups ? move + i + 1 : 1})`).reverse();
        formula(row, column, `=sum(${terms.join(",")})/${mode === 2 ? (interval * (interval + 1)) / 2 : 319}`);
      } else formula(row, column, `=${average(move, interval)}`);
    }
    if (stride === 2 && column + 1 < size.columns) {
      cells.push({ row: 0, column: column + 1, value: { kind: "string", value: "Standard Error" }, style: { italic: true } });
      const base = mode === 1 ? 0 : mode === 2 ? interval - 1 : mode === 4 ? interval - offset : interval - offset - 1;
      for (let row = 1; row <= outputHeight; row++) {
        context.signal.throwIfAborted();
        const count = row - base, denominator = count - Number(properties.df);
        if (row <= base || row > height - offset || denominator <= 0) cells.push({ row, column: column + 1, value: { kind: "error", value: "#N/A" } });
        else {
          const first = formatA1(base + 1,column,size), last = formatA1(row,column,size);
          formula(row, column + 1, `=sqrt(sumxmy2(offset(${text(range)},${rowGroups ? 0 : base},${rowGroups ? base : 0},${rowGroups ? 1 : count},${rowGroups ? count : 1}),${first === last ? first : `${first}:${last}`})/${denominator})`);
        }
      }
    }
  }
  let id = options.outputSheetName;
  while (book.sheets.some(sheet => sheet.id === id) || book.detachedSheets?.some(sheet => sheet.id === id)) id += "_";
  let result: Workbook = { ...book, activeSheet: id, sheets: [...book.sheets, { id, name: options.outputSheetName, size, cells }] };
  if (!options.putFormulas) {
    result = await recalculateWithDiagnostics(result, context, true);
    result = { ...result, sheets: result.sheets.map(sheet => sheet.id !== id ? sheet : { ...sheet,
      cells: sheet.cells.map(cell => { const { formula: ignoredFormula, formulaDirty: ignoredDirty, cachedResult: ignoredCache, ...value } = cell; return value; }) }) };
  }
  context.signal.throwIfAborted();
  return result;
}
