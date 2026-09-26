import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ToolTestOptions } from "../solver.js";
import { formatA1, type Cell, type CellRange, type CellValue, type ImportedValue, type SheetSize, type UnsupportedRecord, type Workbook } from "../workbook.js";
import { dateSerial, gregorian, serialDate, shiftMonths } from "../formulas/functions/dates.js";
import { criterion } from "../formulas/functions/database.js";
import { rendered } from "../formulas/values.js";
import { recalculateWithDiagnostics } from "../formulas/diagnostics.js";
import { quoteNativeSheet } from "../formulas/serialization.js";
import { fakeTrunc } from "../formulas/functions/floating-point.js";

/** Persist chart expressions in the authoritative Gnumeric object tree. */
export function kaplanMeierChart(name: string, rows: number, probability: number, ticks: boolean,
  size: SheetSize, context: CapabilityContext): UnsupportedRecord {
  let work = 0;
  const node = (name: string, attributes: Record<string, string> = {}, children: ImportedValue[] = [], text = "", namespace = ""): ImportedValue => {
    context.signal.throwIfAborted();
    work += 1 + text.length + Object.entries(attributes).reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    if (work > context.limits.operations) throw new SsconvertError("resource-limit", "ssconvert analysis chart exceeds workbook limits");
    return { name, namespace, text, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value })), children };
  };
  const property = (name: string, value: string) => node("property", { name }, [], value);
  const style = (children: ImportedValue[]) => node("property", { name: "style", type: "GogStyle" }, children);
  const line = () => node("line", { "auto-dash": "1", "auto-width": "1", "auto-color": "1" });
  const fill = () => node("fill", { type: "none", "auto-type": "1", "is-auto": "1", "auto-fore": "1" });
  const axis = (role: string) => node("GogObject", { role }, [property("metrics-unit", "none"), property("pos-str", "low"),
    style([line(), node("font", { "auto-color": "1", "auto-font": "1", "auto-scale": "1" }), node("text_layout")]), property("id", "1"), node("data")]);
  const times = `${quoteNativeSheet(name)}!$A$3:$A$${rows + 2}`, probabilities = `$${formatA1(0, probability).slice(0, -1)}$3:$${formatA1(0, probability).slice(0, -1)}$${rows + 2}`;
  const censures = `$D$3:$D$${rows + 2}`;
  const series = (id: number, tick: boolean) => node("GogObject", { role: "Series" }, [property("fill-type", "y-origin"), property("interpolation", "step-start"),
    style([tick ? node("line", { "auto-dash": "0", dash: "none", "auto-width": "1", "auto-color": "1" }) : line(), fill(),
      node("marker", { "auto-shape": "0", shape: tick ? "triangle-down" : "none", "auto-outline": "1", "auto-fill": "1", size: "5" })]), property("id", String(id)),
    node("data", {}, [node("dimension", { id: "0", type: "GnmGODataVector" }, [], times),
      node("dimension", { id: "1", type: "GnmGODataVector" }, [], tick ? `${probabilities}/${censures}*${censures}` : `${quoteNativeSheet(name)}!${probabilities}`)])]);
  const plot = node("GogObject", { role: "Plot", type: "GogXYPlot" }, [property("default-style-has-fill", "FALSE"), property("interpolation", "step-start"),
    property("y-axis", "1"), property("x-axis", "1"), property("vary-style-by-element", "FALSE"), property("id", "1"), series(1, false), ...(ticks ? [series(2, true)] : [])]);
  const graph = node("GogObject", { type: "GogGraph" }, [property("height-pts", "242.25"), property("width-pts", "262.29166666666663"),
    property("theme-name", "Default"), property("padding-pts", "7.086614173228346"),
    style([node("outline", { "auto-dash": "1", "auto-width": "1", "auto-color": "1" }), fill()]), property("anchor", "top-left"), property("alignment", "fill"),
    node("GogObject", { role: "Chart" }, [property("ypos", "0"), property("padding-pts", "7.086614173228346"),
      style([node("outline", { "auto-dash": "1", "auto-width": "1", "auto-color": "1" }),
        node("fill", { type: "pattern", "auto-type": "1", "is-auto": "1", "auto-fore": "1" },
          [node("pattern", { type: "solid", fore: "0:0:0:FF", back: "FF:FF:FF:FF", "auto-pattern": "1" })])]),
      property("id", "1"), axis("X-Axis"), axis("Y-Axis"), plot])]);
  const namespace = "http://www.gnumeric.org/v10.dtd";
  return { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: node("Objects", {}, [node("SheetObjectGraph", {
    ObjectBound: `A2:${formatA1(Math.min(20, size.rows - 1), Math.min(5, size.columns - 1), size)}`, ObjectOffset: "0 0 0 0", Direction: "255", Print: "1"
  }, [graph], "", namespace)], "", namespace) };
}

/** Value-copy utilities use the same workbook and injected capabilities as analysis. */
export async function analysisUtility(book: Workbook, tool: string, options: ToolTestOptions,
  context: CapabilityContext, add: (cell: Cell) => void,
  merges: { startRow: number; endRow: number; startColumn: number; endColumn: number }[]): Promise<void> {
  const p = options.properties;
  let operations = 0;
  const tick = () => {
    context.signal.throwIfAborted();
    if (++operations > context.limits.operations) throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
  };
  const number = (row: number, column: number, value: number, format?: string) => add({ row, column,
    value: Number.isFinite(value) ? { kind: "number", value } : { kind: "error", value: "#NUM!" }, ...(format ? { format } : {}) });
  if (tool === "fill-series") {
    const start = Number(p["start-value"]), stop = Number(p["stop-value"]), type = Number(p.type), unit = Number(p["date-unit"]);
    let step = Number(p["step-value"]), count = 1;
    if (type === 2 && unit !== 0) {
      step = p["is-step-set"] ? Math.sign(step) * Math.floor(Math.abs(step) + 0.5) : 1;
      if (p["is-stop-set"]) {
        const from = serialDate(step < 0 ? stop : start, { book }), to = serialDate(step < 0 ? start : stop, { book });
        if (!from || !to) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: invalid fill-series date");
        if (unit === 1) { const days = (to.getTime() - from.getTime()) / 86400000; count = Math.max(1, Math.trunc(days / 7) * 5 + 1 + days % 7); }
        else {
          let distance = to.getUTCFullYear() - from.getUTCFullYear();
          if (unit === 2) distance = distance * 12 + to.getUTCMonth() - from.getUTCMonth();
          const normalized = gregorian(from.getUTCFullYear(), to.getUTCMonth() + 1, Math.min(to.getUTCDate(), gregorian(from.getUTCFullYear(), to.getUTCMonth() + 2, 0).getUTCDate()));
          count = Math.max(1, Math.trunc((distance + (from <= normalized ? 1 : 0)) / step));
        }
      }
    } else if (p["is-step-set"] && p["is-stop-set"]) {
      count = Math.max(1, Math.floor(Number.EPSILON + 1 + (type === 1 ? Math.log(stop / start) / Math.log(step) : (stop - start) / step)));
    }
    if (!Number.isFinite(count) || count > context.limits.cells || count > context.limits.operations)
      throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
    let value = start;
    for (let i = 0; i < count; i++) {
      tick();
      if (type === 2 && unit !== 0) {
        const date = serialDate(start, { book });
        if (!date) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: invalid fill-series date");
        if (unit === 1) {
          const steps = Math.sign(i * step) * Math.floor(Math.abs(i * step) + 0.5), weekday = date.getUTCDay() || 7;
          date.setUTCDate(date.getUTCDate() + Math.trunc(steps / 5) * 7 + steps % 5 + (weekday + steps % 5 > 5 ? 2 : 0));
          value = dateSerial(date, { book });
        } else value = dateSerial(shiftMonths(date, i * step * (unit === 3 ? 12 : 1)), { book });
      }
      number(p["series-in-rows"] ? 0 : i, p["series-in-rows"] ? i : 0, value, type === 2 ? "[$-f8f2]m/d/yy" : undefined);
      value = type === 1 ? value * step : value + step;
    }
    return;
  }
  const pair = [options.x, options.y];
  if (pair.some(range => !range || "kind" in range)) throw new SsconvertError("invalid-request", "Analysis tool failed");
  const [database, criteria] = pair as [CellRange, CellRange];
  if (pair.some(range => range && !("kind" in range) && range.endSheet && range.endSheet !== range.sheet))
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: analysis sheet span");
  const calculated = await recalculateWithDiagnostics(book, context, true);
  const lookup = new Map(calculated.sheets.flatMap(sheet => sheet.cells.map(cell => [`${sheet.id}:${cell.row}:${cell.column}`, cell] as const)));
  const read = (range: CellRange, row: number, column: number): CellValue => { tick(); return lookup.get(`${range.sheet}:${row}:${column}`)?.value ?? { kind: "blank" }; };
  const text = (row: number, column: number, value: string, italic = false) => add({ row, column, value: { kind: "string", value }, ...(italic ? { style: { italic: true } } : {}) });
  text(0, 0, "Advanced Filter:", true); text(1, 0, "Source Range:", true); text(2, 0, "Criteria Range:", true);
  const rangeName = (range: CellRange) => {
    const sheet = book.sheets.find(sheet => sheet.id === range.sheet);
    if (!sheet) throw new SsconvertError("invalid-request", "Analysis tool failed");
    return `${sheet.name}!`;
  };
  // Metadata is a global human-readable range name, not a live expression.
  for (const [row, range] of [[1, database], [2, criteria]] as const)
    text(row, 1, rangeName(range) + `${formatA1(range.startRow, range.startColumn)}:${formatA1(range.endRow, range.endColumn)}`);
  const fields: number[] = [];
  const asciiFold = (value: string) => Array.from(value, character => character >= "A" && character <= "Z" ? character.toLowerCase() : character).join("");
  let invalid = criteria.startRow === criteria.endRow;
  for (let c = criteria.startColumn; c <= criteria.endColumn; c++) {
    const header = read(criteria, criteria.startRow, c); let mapped = -1;
    if (header.kind === "number") mapped = database.startColumn + fakeTrunc(header.value) - 1;
    else if (header.kind === "string") for (let d = database.startColumn; d <= database.endColumn; d++) {
      if (asciiFold(rendered(read(database, database.startRow, d))) === asciiFold(header.value)) { mapped = d; break; }
    }
    if (mapped === -1) invalid = true;
    fields.push(mapped);
  }
  const conditions: { column: number; value: CellValue }[][] = [];
  for (let r = criteria.startRow + 1; r <= criteria.endRow; r++) {
    const row: { column: number; value: CellValue }[] = [];
    for (let c = criteria.startColumn; c <= criteria.endColumn; c++) {
      const value = read(criteria, r, c);
      if (value.kind !== "blank") row.push({ column: fields[c - criteria.startColumn]!, value });
    }
    conditions.push(row);
  }
  const rows: number[] = [];
  if (!invalid) for (let r = database.startRow + 1; r <= database.endRow; r++) {
    tick();
    if (!conditions.some(row => row.every(condition => {
      const cell = lookup.get(`${database.sheet}:${r}:${condition.column}`);
      return !cell || criterion(cell.value, condition.value, { context, book, tick });
    }))) continue;
    const duplicate = p["unique-only-flag"] && rows.some(previous => {
      for (let c = database.startColumn; c <= database.endColumn; c++) {
        tick();
        const a = lookup.get(`${database.sheet}:${r}:${c}`), b = lookup.get(`${database.sheet}:${previous}:${c}`);
        if (a && b && rendered(a.value) !== rendered(b.value)) return false;
      }
      return true;
    });
    if (!duplicate) rows.push(r);
  }
  if (invalid || !rows.length) {
    text(3, 0, invalid ? "The given criteria are invalid." : "No matching records were found.");
    merges.push({ startRow: 3, endRow: 3, startColumn: 0, endColumn: 1 }); return;
  }
  for (const [i, r] of [database.startRow, ...rows].entries()) for (let c = database.startColumn; c <= database.endColumn; c++)
    add({ row: i + 3, column: c - database.startColumn, value: read(database, r, c) });
}
