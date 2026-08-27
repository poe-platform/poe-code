import { readBytes, type ByteSource } from "../../contracts/index.js";
import { Budget, JqError, JqLimitError, object, objectKeys, objectSize, put, scalarJson, type Json } from "./limits.js";
import { decimalNumber, isNumber } from "./numbers.js";

export class JqParseError extends JqError {
  constructor(readonly detail: string, readonly offset: number) { super(detail); }
}
export function decodeUtf8(bytes: string, budget: Budget): string {
  const points: string[] = [];
  budget.step(Math.ceil(bytes.length / 1024));
  let block = "";
  for (let offset = 0; offset < bytes.length;) {
    if (offset % 1024 === 0) { budget.signal.throwIfAborted(); points.push(block); block = ""; }
    const first = bytes.charCodeAt(offset);
    let length = first < 0x80 ? 1 : first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1;
    let point = first < 0x80 ? first : -1;
    if (length > bytes.length - offset) length = bytes.length - offset;
    else if (length > 1) {
      point = first & (0x7f >> length);
      for (let index = 1; index < length; index++) {
        const next = bytes.charCodeAt(offset + index);
        if (next < 0x80 || next > 0xbf) { point = -1; length = index; break; }
        point = (point << 6) | (next & 0x3f);
      }
      if (point < [0, 0, 0x80, 0x800, 0x10000][length]! || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) point = -1;
    }
    block += String.fromCodePoint(point < 0 ? 0xfffd : point);
    offset += length;
  }
  return points.join("") + block;
}
export function parseJson(input: string, budget: Budget, byteEncoded = false): Json {
  const text = byteEncoded ? input : Buffer.from(input).toString("latin1");
  if (text.length > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
  let offset = 0;
  const fail = (detail = offset >= text.length ? "Unfinished JSON term at EOF" : "Invalid numeric literal"): never => { throw new JqParseError(detail, offset); };
  const space = (): void => { while (offset < text.length && /[\x20\t\r\n]/u.test(text[offset]!)) offset++; };
  const string = (): string => {
    const start = offset++;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset++]!;
      if (!escaped && character === '"') {
        let result: string;
        const encoded = text.slice(start, offset);
        if (/[\x00-\x1f]/u.test(encoded)) return fail("Invalid string: control characters from U+0000 through U+001F must be escaped");
        try { result = JSON.parse(`"${decodeUtf8(encoded.slice(1, -1), budget)}"`) as string; } catch (error) { if (error instanceof JqLimitError) throw error; return fail("Invalid escape"); }
        for (let index = 0; index < result.length; index++) {
          const point = result.charCodeAt(index);
          if (point >= 0xd800 && point <= 0xdbff) {
            const next = result.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return fail("Invalid \\uXXXX\\uXXXX surrogate pair escape");
          }
        }
        return Array.from(result, character => {
          const point = character.codePointAt(0)!;
          return point >= 0xdc00 && point <= 0xdfff ? "\ufffd" : character;
        }).join("");
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    return fail("Unfinished string at EOF");
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
    return /^[-0-9]/u.test(literal[0]) ? decimalNumber(literal[0], budget) : JSON.parse(literal[0]) as Json;
  };
  const value = parseValue(0); space();
  if (offset !== text.length) fail(value === null || typeof value === "boolean" ? "Invalid literal" : "Invalid numeric literal");
  budget.value(value);
  return value;
}
export async function* readChunks(source: ByteSource, budget: Budget): AsyncGenerator<Uint8Array> {
  for await (const chunk of readBytes(source, budget.signal)) {
    await budget.tick();
    budget.inputBytes += chunk.byteLength;
    if (budget.inputBytes > budget.limits.maxInputBytes) throw new JqLimitError("maxInputBytes");
    let offset = 0;
    while (offset < chunk.length) {
      if (budget.inputLocation.complete) budget.inputLocation = { ...budget.inputLocation, complete: false };
      const newline = chunk.indexOf(10, offset);
      const end = Math.min(newline < 0 ? chunk.length : newline + 1, offset + 16384);
      budget.step(Math.ceil((end - offset) / 1024));
      await budget.tick();
      if (newline >= 0 && end === newline + 1) { budget.inputLocation.line++; budget.inputLocation.complete = true; }
      yield chunk.subarray(offset, end);
      offset = end;
    }
  }
  budget.inputLocation.complete = true;
}
export async function* jsonValues(source: ByteSource, budget: Budget): AsyncGenerator<Json> {
  let buffer = "";
  let quoted = false;
  let escaped = false;
  let rootString = false;
  const stack: string[] = [];
  let scanned = 0;
  let line = 1;
  let column = 0;
  let nulTail: string | undefined;
  const value = (): Json => parseJson(buffer, budget, true);
  async function* scan(text: string, completeLine = false): AsyncGenerator<Json> {
    for (const character of text) {
      if (++scanned % 1024 === 0) await budget.tick();
      if (!completeLine && character === "\0" && nulTail === undefined) nulTail = "";
      if (nulTail !== undefined) {
        nulTail += character;
        if (nulTail.length > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        if (character === "\n") { const tail = nulTail; nulTail = undefined; yield* scan(tail, true); }
        continue;
      }
      if (character === "\n") { line++; column = 0; } else column++;
      if (!buffer && /[\x20\t\r\n]/u.test(character)) continue;
      if (!quoted && stack.length === 0 && buffer && /[\x20\t\r\n\[{"]/u.test(character)) {
        const parsed = value(); buffer = ""; yield parsed;
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
          if (rootString && stack.length === 0) { const parsed = value(); buffer = ""; yield parsed; }
        }
      } else if (character === '"') quoted = true;
      else if (character === "[" || character === "{") {
        stack.push(character);
        if (stack.length > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      } else if (character === "]" || character === "}") {
        if (stack.pop() !== (character === "]" ? "[" : "{")) throw new JqError("mismatched JSON delimiter");
        if (!stack.length) { const parsed = value(); buffer = ""; yield parsed; }
      }
    }
  }
  try {
    for await (const chunk of readChunks(source, budget)) yield* scan(Buffer.from(chunk).toString("latin1"));
    if (buffer) yield value();
  } catch (error) {
    if (!(error instanceof JqParseError)) throw error;
    throw new JqError(`parse error: ${error.detail} at line ${line}, column ${column}`);
  }
}

export async function* rawValues(sources: AsyncIterable<ByteSource>, budget: Budget, slurp: boolean): AsyncGenerator<string> {
  let buffer = "";
  let bytes = 2;
  const append = (text: string): void => {
    bytes += Buffer.byteLength(JSON.stringify(text)) - 2;
    if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    buffer += text;
  };
  for await (const source of sources) {
    let pending = "";
    for await (const chunk of readChunks(source, budget)) {
      await budget.tick();
      pending += Buffer.from(chunk).toString("latin1");
      if (pending.length + bytes - (!slurp && pending.endsWith("\n") ? 1 : 0) > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      if (pending.endsWith("\n")) {
        append(decodeUtf8(slurp ? pending : pending.slice(0, -1), budget));
        pending = "";
        if (!slurp) { budget.value(buffer); yield buffer; buffer = ""; bytes = 2; }
      }
    }
    append(decodeUtf8(pending, budget));
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
    if (current === null || typeof current !== "object" || isNumber(current)) { append(scalarJson(current, budget)); return; }
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
