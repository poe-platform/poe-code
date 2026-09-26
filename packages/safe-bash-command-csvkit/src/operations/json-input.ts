import type { Runtime } from "../runtime.js";
import { decodeJson, jsonNumberText, type JsonInput } from "../json-input.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { repr } from "../cli/parser.js";
import { csvifiedRow } from "./input-table.js";
import { jsonInputTable, type JsonCell } from "./json-input-table.js";
import { normalizeHeaders } from "../table/headers.js";
import { warningText } from "../diagnostics/index.js";

/** JSON and NDJSON share Agate's ordered flatten/union semantics. */
export async function jsonConversion(runtime: Runtime, newline: boolean): Promise<number> {
  const o = runtime.options;
  if (newline && o.key !== null) throw new CsvkitDiagnostic("ValueError: key and newline may not be specified together.");
  const text = await runtime.text(undefined, 0);
  let input: JsonInput;
  if (newline) {
    const rows: JsonInput[] = [];
    let start = 0;
    for (let position = 0; position < text.length; position++) {
      runtime.step();
      if (text[position] !== "\n") continue;
      rows.push(decodeJson(text.slice(start, position + 1), runtime));
      runtime.retain(16);
      start = position + 1;
    }
    if (start < text.length) rows.push(decodeJson(text.slice(start), runtime));
    input = rows;
  } else input = decodeJson(text, runtime);
  if (input instanceof Map) {
    if (!o.key) throw new CsvkitDiagnostic("TypeError: When converting a JSON document with a top-level dictionary element, a key must be specified.");
    const key = String(o.key);
    if (!input.has(key)) throw new CsvkitDiagnostic(`KeyError: ${repr(key)}`);
    input = input.get(key)!;
  }
  if (typeof input === "string" || input instanceof Map) {
    input = input instanceof Map ? [...input.keys()] : Array.from(input);
  }
  if (!Array.isArray(input)) {
    const type = input === null ? 'NoneType' : typeof input === 'boolean' ? 'bool' : ['NaN', 'Infinity', '-Infinity'].includes(input.token) ? 'float' : [...input.token].some(char => '.eE'.includes(char)) ? 'decimal.Decimal' : 'int';
    throw new CsvkitDiagnostic(`TypeError: '${type}' object is not iterable`);
  }
  const headers: string[] = [];
  const known = new Set<string>();
  const rows: Map<string, JsonCell>[] = [];
  const flatten = (value: JsonInput, path: string, row: Map<string, JsonCell>): void => {
    runtime.step();
    if (value instanceof Map || Array.isArray(value)) {
      const entries = value instanceof Map ? value.entries() : value.entries();
      for (const [key, child] of entries) flatten(child, path + String(key) + "/", row);
      return;
    }
    let start = 0; let end = path.length;
    while (path[start] === "/") start++;
    while (end > start && path[end - 1] === "/") end--;
    const name = path.slice(start, end);
    const cell = value === null ? null : typeof value === "string" ? value : typeof value === "boolean" ? value ? "True" : "False" : jsonNumberText(value, runtime);
    if (cell !== null && Array.from(cell).length > runtime.context.limits.maxFieldCharacters) throw new CsvkitBlocked("JSON output field budget exceeded");
    runtime.retain(64 + name.length * 2 + (cell?.length ?? 0) * 2);
    row.set(name, value);
  };
  for (const item of input) {
    runtime.step(); runtime.retain(64);
    const row = new Map<string, JsonCell>(); flatten(item, "", row);
    for (const name of row.keys()) if (!known.has(name)) {
      if (headers.length >= runtime.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
      known.add(name); headers.push(name); runtime.retain(32);
    }
    runtime.admitRecord({ cells: [...row.values()].map(cell => cell === null ? "" : typeof cell === "string" ? cell : typeof cell === "boolean" ? cell ? "True" : "False" : jsonNumberText(cell, runtime)), line: rows.length + 1 });
    rows.push(row);
  }
  if (!headers.length && rows.length && !runtime.context.columnWarnings?.suppressWarnings) {
    const utilsPath = runtime.context.columnWarnings?.utilsPath;
    if (!utilsPath) throw new CsvkitBlocked("JSON empty-column warning provenance");
    // The frozen Agate package places from_object beside the injected utils module.
    const path = utilsPath.slice(0, utilsPath.lastIndexOf("/") + 1) + "table/from_object.py";
    await runtime.write(warningText({ path, line: 93, category: "RuntimeWarning",
      message: 'Column names not specified. "()" will be used as names.',
      source: "return Table(rows, column_names, row_names=row_names, column_types=column_types)" }), "stderr");
  }
  const names = await normalizeHeaders(headers, runtime);
  const table = jsonInputTable(runtime, names, rows.map(row => headers.map(name => row.get(name) ?? null)));
  await runtime.row(table.headers);
  for (const row of table.rows) await runtime.row(csvifiedRow(row));
  return 0;
}
