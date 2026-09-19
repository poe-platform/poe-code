import type { Runtime } from "../runtime.js";
import { repr } from "../cli/parser.js";
import { CsvkitDiagnostic } from "../errors.js";
import { Decimal } from "../types/decimal.js";

import { readTable, type TableValue } from "../table/index.js";
import { pythonValueText } from "../csv.js";

export type JsonValue = string | number | boolean | null | { readonly token: string } | readonly JsonValue[] | ReadonlyMap<string, JsonValue>;

/** CPython repr(float): shortest digits, scientific thresholds and signed zero. */
export function floatText(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value < 0 ? "-Infinity" : "Infinity";
  if (Object.is(value, -0)) return "-0.0";
  const exponent = Number(value.toExponential().split("e")[1]);
  if (value !== 0 && (exponent < -4 || exponent >= 16)) {
    const [digits, power] = value.toExponential().split("e");
    const exp = Number(power);
    return digits + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  }
  return String(value) + (Number.isInteger(value) ? ".0" : "");
}

/** Preserve Python's spacing and insertion order, including numeric object keys. */
export async function emit(value: JsonValue, runtime: Runtime, indent: number | null, depth = 0): Promise<void> {
  runtime.step();
  if (typeof value === "number") { await runtime.write(floatText(value)); return; }
  if (value === null || (typeof value === "string" || typeof value === "boolean")) { await runtime.write(JSON.stringify(value)); return; }
  if ("token" in value) { await runtime.write(value.token); return; }
  const object = value instanceof Map;
  const entries: readonly (readonly [string | null, JsonValue])[] = object
    ? [...value.entries()]
    : (value as readonly JsonValue[]).map(item => [null, item] as const);
  runtime.retain(entries.length * 32);
  await runtime.write(object ? "{" : "[");
  for (const [index, [key, child]] of entries.entries()) {
    if (index) await runtime.write(indent === null ? ", " : ",");
    if (indent !== null) await runtime.write("\n" + " ".repeat(indent * (depth + 1)));
    if (key !== null) await runtime.write(JSON.stringify(key) + ": ");
    await emit(child, runtime, indent, depth + 1);
  }
  if (entries.length && indent !== null) await runtime.write("\n" + " ".repeat(indent * depth));
  await runtime.write(object ? "}" : "]");
}

export async function jsonTable(runtime: Runtime, indent: number | null): Promise<number> {
  const table = await readTable(runtime, undefined, undefined, true);
  if (runtime.options.streamOutput && runtime.options.key !== null) throw new CsvkitDiagnostic("ValueError: key and newline may not be specified together.");
  if (runtime.options.streamOutput && runtime.options.indent !== null) throw new CsvkitDiagnostic("ValueError: newline and indent may not be specified together.");
  const jsonify = (value: TableValue): string | number | boolean | null => {
    if (typeof value !== "object" || value === null) return value;
    if (value.kind === "decimal") return value.value.includes("NaN") ? NaN : Number(value.value);
    if (value.kind === "datetime") return value.value.replace(" ", "T");
    return pythonValueText(value);
  };
  const rows = table.rows.map(row => {
    runtime.step(); runtime.retain(64 + table.headers.length * 64);
    return new Map<string, JsonValue>(table.headers.map((name, index) => [name, jsonify(row[index]!)]));
  });
  let output: JsonValue = rows;
  if (runtime.options.key !== null) {
    const key = String(runtime.options.key);
    const column = table.headers.indexOf(key);
    if (column < 0 && rows.length) throw new CsvkitDiagnostic(`KeyError: ${repr(key)}`);
    const keyed = new Map<string, JsonValue>();
    for (const [index, row] of table.rows.entries()) {
      runtime.step();
      const cell = row[column]!;
      const value = cell === null ? "None" : typeof cell === "object" && cell.kind === "decimal" ? Decimal.parse(cell.value).normalized().toString() : pythonValueText(cell);
      if (keyed.has(value)) throw new CsvkitDiagnostic(`ValueError: Value ${value} is not unique in the key column.`);
      keyed.set(value, rows[index]!);
      runtime.retain(96);
    }
    output = keyed;
  }
  // The constructed tree has at most three container levels. Admit multiplied
  // padding before repeat allocates, even when a table happens to be empty.
  if (indent !== null) runtime.retain(indent * 6);
  if (runtime.options.streamOutput) {
    for (const row of rows) {
      await emit(row, runtime, indent);
      await runtime.write("\n");
    }
    return 0;
  }
  await emit(output, runtime, indent);
  return 0;
}
