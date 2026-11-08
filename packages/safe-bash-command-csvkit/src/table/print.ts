import type { Runtime } from "../runtime.js";
import type { TypedTable } from "./types.js";
import type { ReplayTable } from "./index.js";
import { Decimal } from "../types/decimal.js";
import { pythonValueText } from "../csv.js";
import { CsvkitDiagnostic } from "../errors.js";

function numberText(value: string, places: number, ellipsis: string): string {
  const d = Decimal.parse(value);
  if (d.special === "Infinity" || Math.abs(Number(d.toString())) === Infinity) return value;
  places = Math.max(0, places);
  if (d.special) {
    const digits = "NaN" + d.payload;
    let grouped = "";
    for (let i = 0; i < digits.length; i++) {
      if (i && (digits.length - i) % 3 === 0) grouped += ",";
      grouped += digits[i];
    }
    return grouped + (places ? "." + "0".repeat(places) : "") + ellipsis;
  }
  let coefficient = d.coefficient;
  const shift = d.exponent + places;
  if (shift >= 0) coefficient *= 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    const rest = coefficient % divisor;
    coefficient /= divisor;
    if (rest * 2n > divisor || rest * 2n === divisor && coefficient % 2n !== 0n) coefficient++;
  }
  if (coefficient.toString().length > 28) throw new CsvkitDiagnostic("InvalidOperation: [<class 'decimal.InvalidOperation'>]");
  const digits = coefficient.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  let grouped = "";
  for (let i = 0; i < whole.length; i++) {
    if (i && (whole.length - i) % 3 === 0) grouped += ",";
    grouped += whole[i];
  }
  return (d.negative ? "-" : "") + grouped + (places ? "." + digits.slice(-places) : "") + ellipsis;
}

/** Literal Agate 1.14.2 print_table defaults as overridden by CSVLook.main. */
export async function printTable(runtime: Runtime, table: TypedTable | ReplayTable): Promise<void> {
  const o = runtime.options;
  const maxColumns = o.max_columns === null ? table.headers.length : Number(o.max_columns);
  const width = o.max_column_width === null ? undefined : Number(o.max_column_width);
  const maxPrecision = o.max_precision === null ? 3 : Number(o.max_precision);
  const length = (value: string): number => {
    let size = 0;
    for (const ignoredChar of value) { runtime.step(); size++; }
    return size;
  };
  const truncate = (value: string): string => {
    runtime.step(); runtime.retain(32 + value.length * 16);
    const chars = Array.from(value);
    return width !== undefined && chars.length > width ? chars.slice(0, width - 3).join("") + "..." : value;
  };
  const names = table.headers.slice(0, maxColumns).map(truncate);
  if (maxColumns < table.headers.length) names.push("...");
  const widths = names.map(length);
  const data = table.rows;
  const source = (): AsyncIterable<readonly import("./types.js").TableValue[]> => typeof data === "function" ? data() : (async function* () { yield* data; })();
  const precisions = table.columns.map(() => ({ whole: 1, places: 0 }));
  for await (const row of source()) for (let index = 0; index < row.length; index++) {
    const value = row[index];
    if (index >= maxColumns || value === null || typeof value !== "object" || value.kind !== "decimal") continue;
    const decimal = Decimal.parse(value.value).normalized();
    if (decimal.special || Math.abs(Number(decimal.toString())) === Infinity) continue;
    const state = precisions[index]!;
    state.places = Math.max(state.places, -decimal.exponent);
    state.whole = Math.max(state.whole, decimal.coefficient.toString().length + decimal.exponent);
  }
  const formats = table.columns.map((column, index) => {
    runtime.step();
    if (index >= maxColumns || column.type !== "Number") return undefined;
    const state = precisions[index]!;
    const places = Math.min(state.places, 28 - state.whole);
    return { places: Math.min(places, maxPrecision), ellipsis: places > maxPrecision && !o.no_number_ellipsis ? "…" : "" };
  });
  const cells = (row: readonly import("./types.js").TableValue[]): string[] => {
    const result: string[] = [];
    for (const [j, value] of row.entries()) {
      runtime.step();
      const format = formats[j];
      const text = truncate(j >= maxColumns ? "..." : value === null ? "" : format && typeof value === "object" && value.kind === "decimal" ? numberText(value.value, format.places, format.ellipsis) : pythonValueText(value).replaceAll("\n", "↵"));
      result.push(text);
      if (j >= maxColumns) break;
    }
    return result;
  };
  for await (const row of source()) for (const [j, text] of cells(row).entries()) widths[j] = Math.max(widths[j]!, length(text));
  const writeRow = async (cells: readonly string[]): Promise<void> => {
    const fields = cells.map((cell, j) => {
      runtime.step();
      if (!table.columns[j]) throw new CsvkitDiagnostic("IndexError: tuple index out of range");
      const spaces = widths[j]! - length(cell);
      runtime.retain(16 + Math.max(0, spaces) * 2);
      const padding = " ".repeat(Math.max(0, spaces));
      return table.columns[j]!.type === "Text" ? " " + cell + padding + " " : " " + padding + cell + " ";
    });
    await runtime.write("|" + fields.join("|") + "|\n");
  };
  await writeRow(names);
  await runtime.write("| " + widths.map(size => { runtime.step(); runtime.retain(size * 2); return "-".repeat(size); }).join(" | ") + " |\n");
  for await (const row of source()) await writeRow(cells(row));
}
