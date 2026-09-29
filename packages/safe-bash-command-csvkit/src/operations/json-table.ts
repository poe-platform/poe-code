import type { Runtime } from "../runtime.js";
import { repr } from "../cli/lexical.js";
import { CsvkitDiagnostic } from "../errors.js";
import { Decimal } from "../types/decimal.js";

import { readTable, type TableValue } from "../table/index.js";
import { pythonValueText } from "../csv.js";

export type JsonValue = string | number | boolean | null | { readonly token: string } | readonly JsonValue[] | ReadonlyMap<string, JsonValue>;

function jsonString(value: string, runtime: Runtime): string {
  if (runtime.context.limits.maxRetainedBytes !== Infinity) {
    // Admit the unescaped string and quotes first, then extra escape code units,
    // before JSON.stringify creates the retained serialization.
    runtime.retain((value.length + 2) * 2);
    for (let index = 0; index < value.length; index++) {
      runtime.step();
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92 || code >= 8 && code <= 10 || code === 12 || code === 13) runtime.retain(2);
      else if (code < 32) runtime.retain(10);
      else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) index++;
      else if (code >= 0xd800 && code <= 0xdfff) runtime.retain(10);
    }
  }
  return JSON.stringify(value);
}

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
  // Finite limits admit each token before publication, retaining the accepted
  // prefix if a later token is refused. Unlimited payloads remain batched below.
  if (runtime.context.limits.maxOutputBytes !== Infinity || runtime.context.limits.maxWork !== Infinity || runtime.context.limits.maxRetainedBytes !== Infinity) {
    runtime.step();
    if (typeof value === "number") { await runtime.write(floatText(value)); return; }
    if (value === null || typeof value === "string" || typeof value === "boolean") { await runtime.write(typeof value === "string" ? jsonString(value, runtime) : JSON.stringify(value)); return; }
    if ("token" in value) { runtime.retain(value.token.length * 2); await runtime.write(value.token); return; }
    const object = value instanceof Map;
    const size = object ? value.size : (value as readonly JsonValue[]).length;
    runtime.retain(size * 32);
    await runtime.write(object ? "{" : "[");
    let index = 0;
    const entries = object ? value.entries() : (value as readonly JsonValue[]).entries();
    for (const [key, child] of entries) {
      if (index++) await runtime.write(indent === null ? ", " : ",");
      if (indent !== null) await runtime.write("\n" + " ".repeat(indent * (depth + 1)));
      if (object) await runtime.write(jsonString(key as string, runtime) + ": ");
      await emit(child, runtime, indent, depth + 1);
    }
    if (size && indent !== null) await runtime.write("\n" + " ".repeat(indent * depth));
    await runtime.write(object ? "}" : "]");
    return;
  }
  let buf = "";
  const flushIfNeeded = async (): Promise<void> => {
    if (buf.length >= 32768) {
      const out = buf;
      buf = "";
      await runtime.write(out);
    }
  };
  const visitSync = (cur: JsonValue, d: number): void => {
    runtime.step();
    if (typeof cur === "number") { buf += floatText(cur); return; }
    if (cur === null || typeof cur === "string" || typeof cur === "boolean") { buf += typeof cur === "string" ? jsonString(cur, runtime) : JSON.stringify(cur); return; }
    if ("token" in cur) { buf += cur.token; return; }
    if (cur instanceof Map) {
      runtime.retain(cur.size * 32);
      buf += "{";
      let index = 0;
      const childPad = indent !== null ? "\n" + " ".repeat(indent * (d + 1)) : "";
      for (const [key, child] of cur.entries()) {
        if (index++) buf += indent === null ? ", " : ",";
        if (indent !== null) buf += childPad;
        buf += jsonString(key, runtime) + ": ";
        visitSync(child, d + 1);
      }
      if (cur.size && indent !== null) buf += "\n" + " ".repeat(indent * d);
      buf += "}";
      return;
    }
    const arr = cur as readonly JsonValue[];
    runtime.retain(arr.length * 32);
    buf += "[";
    const childPad = indent !== null ? "\n" + " ".repeat(indent * (d + 1)) : "";
    for (let index = 0; index < arr.length; index++) {
      if (index) buf += indent === null ? ", " : ",";
      if (indent !== null) buf += childPad;
      visitSync(arr[index]!, d + 1);
    }
    if (arr.length && indent !== null) buf += "\n" + " ".repeat(indent * d);
    buf += "]";
  };
  const visitAsync = async (cur: JsonValue, d: number): Promise<void> => {
    if (cur instanceof Map) {
      runtime.step();
      runtime.retain(cur.size * 32);
      await runtime.write("{");
      let index = 0;
      const childPad = indent !== null ? "\n" + " ".repeat(indent * (d + 1)) : "";
      for (const [key, child] of cur.entries()) {
        if (index++) buf += indent === null ? ", " : ",";
        if (indent !== null) buf += childPad;
        buf += jsonString(key, runtime) + ": ";
        visitSync(child, d + 1);
        if (buf.length >= 32768) await flushIfNeeded();
      }
      if (cur.size && indent !== null) buf += "\n" + " ".repeat(indent * d);
      buf += "}";
      return;
    }
    if (Array.isArray(cur)) {
      const arr = cur as readonly JsonValue[];
      runtime.step();
      runtime.retain(arr.length * 32);
      await runtime.write("[");
      const childPad = indent !== null ? "\n" + " ".repeat(indent * (d + 1)) : "";
      for (let index = 0; index < arr.length; index++) {
        if (index) buf += indent === null ? ", " : ",";
        if (indent !== null) buf += childPad;
        visitSync(arr[index]!, d + 1);
        if (buf.length >= 32768) await flushIfNeeded();
      }
      if (arr.length && indent !== null) buf += "\n" + " ".repeat(indent * d);
      buf += "]";
      return;
    }
    visitSync(cur, d);
  };
  await visitAsync(value, depth);
  if (buf.length > 0) await runtime.write(buf);
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
