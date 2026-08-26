import { readBytes, type ByteSource } from "../../contracts/index.js";
import { Budget, JqError, JqLimitError, object, objectKeys, objectSize, put, scalarJson, wellFormed, type Json } from "./limits.js";

export function parseJson(text: string, budget: Budget): Json {
  budget.text(text);
  let offset = 0;
  const fail = (): never => { throw new JqError(`invalid JSON input at offset ${offset}`); };
  const space = (): void => { while (offset < text.length && /[\x20\t\r\n]/u.test(text[offset]!)) offset++; };
  const string = (): string => {
    const start = offset++;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset++]!;
      if (!escaped && character === '"') {
        let result: string;
        try { result = JSON.parse(text.slice(start, offset)) as string; } catch { return fail(); }
        if (!wellFormed(result)) return fail();
        return result;
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    return fail();
  };
  const parseValue = (depth: number): Json => {
    budget.step(); space();
    const character = text[offset];
    if (character === '"') return string();
    if (character === "[" || character === "{") {
      if (depth + 1 > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      offset++; space();
      const result = character === "[" ? [] as Json[] : object();
      const close = character === "[" ? "]" : "}";
      if (text[offset] === close) { offset++; return result; }
      while (true) {
        if (Array.isArray(result)) { budget.collection(result.length + 1); result.push(parseValue(depth + 1)); }
        else {
          if (text[offset] !== '"') return fail();
          const key = string(); space();
          if (text[offset++] !== ":") return fail();
          if (!Object.hasOwn(result, key)) budget.collection(objectSize(result) + 1);
          put(result, key, parseValue(depth + 1));
        }
        space();
        if (text[offset] === close) { offset++; return result; }
        if (text[offset++] !== ",") return fail();
        space();
      }
    }
    const literal = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(text.slice(offset));
    if (!literal) return fail();
    offset += literal[0].length;
    const value = JSON.parse(literal[0]) as Json;
    if (typeof value === "number" && !Number.isFinite(value)) throw new JqError("nonfinite numbers are not supported");
    return value;
  };
  const value = parseValue(0); space();
  if (offset !== text.length) fail();
  budget.value(value);
  return value;
}
export async function* readChunks(source: ByteSource, budget: Budget): AsyncGenerator<Uint8Array> {
  for await (const chunk of readBytes(source, budget.signal)) {
    await budget.tick();
    budget.inputBytes += chunk.byteLength;
    if (budget.inputBytes > budget.limits.maxInputBytes) throw new JqLimitError("maxInputBytes");
    yield chunk;
  }
}
async function* utf8Text(source: ByteSource, budget: Budget): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let remaining = 0;
  let minimum = 0x80;
  let maximum = 0xbf;
  for await (const chunk of readChunks(source, budget)) {
    for (let start = 0; start < chunk.length; start += 16384) {
      const end = Math.min(start + 16384, chunk.length);
      budget.step(Math.ceil((end - start) / 1024));
      await budget.tick();
      let offset = start;
      for (; offset < end; offset++) {
        const byte = chunk[offset]!;
        if (remaining) {
          if (byte < minimum || byte > maximum) break;
          remaining--; minimum = 0x80; maximum = 0xbf;
        } else if (byte <= 0x7f) continue;
        else if (byte >= 0xc2 && byte <= 0xdf) remaining = 1;
        else if (byte >= 0xe0 && byte <= 0xef) {
          remaining = 2;
          minimum = byte === 0xe0 ? 0xa0 : 0x80;
          maximum = byte === 0xed ? 0x9f : 0xbf;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          remaining = 3;
          minimum = byte === 0xf0 ? 0x90 : 0x80;
          maximum = byte === 0xf4 ? 0x8f : 0xbf;
        } else break;
      }
      const text = decoder.decode(chunk.subarray(start, offset), { stream: true });
      if (text) yield text;
      if (offset < end) throw new JqError("invalid UTF-8 input");
    }
  }
  if (remaining) throw new JqError("invalid UTF-8 input");
  const tail = decoder.decode();
  if (tail) yield tail;
}
export async function* jsonValues(source: ByteSource, budget: Budget): AsyncGenerator<Json> {
  let buffer = "";
  let quoted = false;
  let escaped = false;
  let rootString = false;
  const stack: string[] = [];
  let scanned = 0;
  async function* scan(text: string): AsyncGenerator<Json> {
    for (const character of text) {
      if (++scanned % 1024 === 0) await budget.tick();
      if (!buffer && /[\x20\t\r\n]/u.test(character)) continue;
      if (!quoted && stack.length === 0 && buffer && /[\x20\t\r\n\[{"]/u.test(character)) {
        const value = parseJson(buffer, budget); buffer = ""; yield value;
        if (/[\x20\t\r\n]/u.test(character)) continue;
      }
      if (!buffer) rootString = character === '"';
      buffer += character;
      if (buffer.length > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') {
          quoted = false;
          if (rootString && stack.length === 0) { const value = parseJson(buffer, budget); buffer = ""; yield value; }
        }
      } else if (character === '"') quoted = true;
      else if (character === "[" || character === "{") {
        stack.push(character);
        if (stack.length > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      } else if (character === "]" || character === "}") {
        if (stack.pop() !== (character === "]" ? "[" : "{")) throw new JqError("mismatched JSON delimiter");
        if (!stack.length) { const value = parseJson(buffer, budget); buffer = ""; yield value; }
      }
    }
  }
  for await (const text of utf8Text(source, budget)) yield* scan(text);
  if (buffer) yield parseJson(buffer, budget);
}

export async function* rawValues(sources: AsyncIterable<ByteSource>, budget: Budget, slurp: boolean): AsyncGenerator<string> {
  let buffer = "";
  let bytes = 2;
  const append = (text: string): void => {
    bytes += Buffer.byteLength(JSON.stringify(text)) - 2;
    if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    buffer += text;
  };
  async function* texts(): AsyncGenerator<string> {
    for await (const source of sources) yield* utf8Text(source, budget);
  }
  for await (const text of texts()) {
    if (slurp) { append(text); continue; }
    let start = 0;
    let end: number;
    while ((end = text.indexOf("\n", start)) !== -1) {
      await budget.tick();
      append(text.slice(start, end));
      budget.value(buffer);
      yield buffer;
      buffer = ""; bytes = 2;
      start = end + 1;
    }
    append(text.slice(start));
  }
  if (slurp || buffer) { budget.value(buffer); yield buffer; }
}

export function stringify(value: Json, budget: Budget, pretty = false, maxBytes = budget.limits.maxValueBytes, limitName: "maxValueBytes" | "maxOutputBytes" = "maxValueBytes"): string {
  const parts: string[] = [];
  let bytes = 0;
  const append = (text: string): void => {
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) throw new JqLimitError(limitName);
    parts.push(text);
  };
  const visit = (current: Json, depth: number): void => {
    budget.step();
    if (depth > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
    if (current === null || typeof current !== "object") { append(scalarJson(current)); return; }
    const keys = Array.isArray(current) ? Object.keys(current) : objectKeys(current);
    const array = Array.isArray(current);
    append(array ? "[" : "{");
    for (let index = 0; index < keys.length; index++) {
      if (index) append(",");
      if (pretty) append(`\n${"  ".repeat(depth + 1)}`);
      const key = keys[index]!;
      if (!array) { append(JSON.stringify(key)); append(pretty ? ": " : ":"); }
      visit((current as Record<string, Json>)[key]!, depth + 1);
    }
    if (pretty && keys.length) append(`\n${"  ".repeat(depth)}`);
    append(array ? "]" : "}");
  };
  visit(value, 0);
  return parts.join("");
}
