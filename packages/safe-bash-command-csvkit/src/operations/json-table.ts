import type { Runtime } from "../runtime.js";
import { repr } from "../cli/lexical.js";
import { CsvkitDiagnostic } from "../errors.js";
import { Decimal } from "../types/decimal.js";

import { externalSort } from "../table/external.js";
import { readReplayTable, type TableValue } from "../table/index.js";
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
  const table = await readReplayTable(runtime, undefined, undefined, true);
  if (runtime.options.streamOutput && runtime.options.key !== null) throw new CsvkitDiagnostic("ValueError: key and newline may not be specified together.");
  if (runtime.options.streamOutput && runtime.options.indent !== null) throw new CsvkitDiagnostic("ValueError: newline and indent may not be specified together.");
  const jsonify = (value: TableValue): string | number | boolean | null => {
    if (typeof value !== "object" || value === null) return value;
    if (value.kind === "decimal") return value.value.includes("NaN") ? NaN : Number(value.value);
    if (value.kind === "datetime") return value.value.replace(" ", "T");
    return pythonValueText(value);
  };
  const key = runtime.options.key === null ? undefined : String(runtime.options.key);
  const column = key === undefined ? -1 : table.headers.indexOf(key);
  if (key !== undefined && column < 0 && table.count) throw new CsvkitDiagnostic(`KeyError: ${repr(key)}`);
  const rowKey = (row: readonly TableValue[]): string => {
    const cell = row[column]!;
    return cell === null ? "None" : typeof cell === "object" && cell.kind === "decimal" ? Decimal.parse(cell.value).normalized().toString() : pythonValueText(cell);
  };
  if (key !== undefined) {
    if (runtime.storage) {
      async function* keys() { let index = 0; for await (const row of table.rows()) yield { value: rowKey(row), index: index++ }; }
      const sorted = await externalSort(runtime.storage, keys(), (a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0, runtime.step);
      let previous: string | undefined;
      let duplicate: { value: string; index: number } | undefined;
      for await (const item of sorted.read()) {
        if (item.value === previous && (!duplicate || item.index < duplicate.index)) duplicate = item;
        previous = item.value;
      }
      await sorted.close();
      if (duplicate) throw new CsvkitDiagnostic(`ValueError: Value ${duplicate.value} is not unique in the key column.`);
    } else {
      const seen = new Set<string>();
      for await (const row of table.rows()) {
        const value = rowKey(row);
        if (seen.has(value)) throw new CsvkitDiagnostic(`ValueError: Value ${value} is not unique in the key column.`);
        runtime.retain(96 + value.length * 2); seen.add(value);
      }
    }
  }
  if (indent !== null) runtime.retain(indent * 6);
  const stream = Boolean(runtime.options.streamOutput);
  if (!stream) await runtime.write(key === undefined ? "[" : "{");
  let index = 0;
  for await (const row of table.rows()) {
    runtime.step();
    const value = new Map<string, JsonValue>(table.headers.map((name, index) => [name, jsonify(row[index]!)]));
    if (!stream) {
      if (index) await runtime.write(indent === null ? ", " : ",");
      if (indent !== null) await runtime.write("\n" + " ".repeat(indent));
      if (key !== undefined) { await emit(rowKey(row), runtime, indent, 1); await runtime.write(": "); }
    }
    await emit(value, runtime, indent, stream ? 0 : 1);
    if (stream) await runtime.write("\n");
    index++;
  }
  if (!stream) {
    if (index && indent !== null) await runtime.write("\n");
    await runtime.write(key === undefined ? "]" : "}");
  }
  await table.close();
  return 0;
}
