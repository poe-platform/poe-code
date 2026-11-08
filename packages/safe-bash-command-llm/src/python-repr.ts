import {yieldTurn} from "safe-bash-contracts/yield";
import {validateJsonData} from "./json-data.js";
import {isPythonPrintable} from "./python-printable.js";
import {floatText} from "./embed-output.js";

/** Python repr for admitted JSON controls, emitted in bounded UTF-8 chunks. */
export async function* pythonRepr(value: unknown, signal: AbortSignal): AsyncIterable<Uint8Array> {
  validateJsonData(value, "Invalid tool arguments");
  function* string(value: string): Generator<string> {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    yield quote;
    for (const char of value) {
      const point = char.codePointAt(0)!;
      yield char === quote || char === "\\" ? "\\" + char
        : char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t"
        : isPythonPrintable(point) ? char
        : "\\" + (point < 256 ? "x" + point.toString(16).padStart(2, "0")
          : point < 65536 ? "u" + point.toString(16).padStart(4, "0")
          : "U" + point.toString(16).padStart(8, "0"));
    }
    yield quote;
  }
  function* parts(value: unknown): Generator<string> {
    if (value === null) {yield "None"; return;}
    if (typeof value === "boolean") {yield value ? "True" : "False"; return;}
    if (typeof value === "string") {yield* string(value); return;}
    if (typeof value === "number") {
      const json = JSON.stringify(value);
      yield json.includes(".") || json.includes("e") ? floatText(value) : json;
      return;
    }
    if (Array.isArray(value)) {
      yield "[";
      for (let index = 0; index < value.length; index++) {if (index) yield ", "; yield* parts(value[index]);}
      yield "]"; return;
    }
    yield "{"; let first = true;
    const object = value as Record<string, unknown>;
    for (const key in object) if (Object.hasOwn(object, key)) {
      if (!first) yield ", "; first = false;
      yield* string(key); yield ": "; yield* parts(object[key]);
    }
    yield "}";
  }
  const encoder = new TextEncoder(); let chunk = "", steps = 0;
  for (const part of parts(value)) {
    if (++steps % 256 === 0) await yieldTurn(signal);
    signal.throwIfAborted(); chunk += part;
    if (chunk.length >= 2048) {yield encoder.encode(chunk); chunk = "";}
  }
  if (chunk) yield encoder.encode(chunk);
}
