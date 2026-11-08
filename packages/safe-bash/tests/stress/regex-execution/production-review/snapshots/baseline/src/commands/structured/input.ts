import { readBytes, type ByteSource } from "../../contracts/index.js";
import { Budget, JqError, JqLimitError, object, objectKeys, objectSize, put, scalarJson, type Json } from "./limits.js";
import { numericToken, isNumber } from "./numbers.js";

export class JqParseError extends JqError {
  constructor(readonly detail: string, readonly offset: number, readonly line = 1, readonly column = offset, readonly located = true) { super(detail); }
  diagnostic(): string { return this.located ? `${this.detail} at line ${this.line}, column ${this.column}` : this.detail; }
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
class JsonParser {
  private readonly stack: (Json[] | Record<string, Json> | string)[] = [];
  private next: Json | undefined;
  private token = "";
  private quoted = false;
  private escaped = false;
  private bom = 0;
  private bytes = 0;
  private depth = 0;
  private offset = 0;
  private line = 1;
  private column = 0;
  constructor(private readonly budget: Budget) {}
  private fail(detail: string, located = true): never {
    throw new JqParseError(detail, this.offset, this.line, this.column, located);
  }
  private accept(value: Json): void {
    this.budget.step();
    if (this.next !== undefined) this.fail("Expected separator between values");
    this.next = value;
  }
  private literal(eof = false): void {
    if (!this.token) return;
    const text = this.token;
    const pattern = text[0] === "t" ? "true" : text[0] === "f" ? "false" : text.startsWith("nu") ? "null" : undefined;
    let value: Json | undefined;
    if (pattern) {
      if (text !== pattern) this.fail("Invalid literal" + (eof ? " at EOF" : ""));
      value = pattern === "true" ? true : pattern === "false" ? false : null;
    } else {
      value = numericToken(text, this.budget);
      if (value === undefined) this.fail("Invalid numeric literal" + (eof ? " at EOF" : ""));
    }
    this.accept(value);
    this.token = "";
  }
  private string(): string {
    let result = "";
    let start = 0;
    for (let index = 0; index < this.token.length; index++) {
      if (index % 1024 === 0) this.budget.step();
      const character = this.token[index]!;
      if (character === "\\") {
        result += decodeUtf8(this.token.slice(start, index), this.budget);
        const escaped = this.token[++index];
        if (escaped === "u") {
          const digits = this.token.slice(index + 1, index + 5);
          if (digits.length < 4) this.fail("Invalid \\uXXXX escape");
          if (!/^[0-9a-f]{4}$/iu.test(digits)) this.fail("Invalid characters in \\uXXXX escape");
          let point = parseInt(digits, 16);
          index += 4;
          if (point >= 0xd800 && point <= 0xdbff) {
            const tail = this.token.slice(index + 1, index + 7);
            const low = /^\\u[0-9a-f]{4}$/iu.test(tail) ? parseInt(tail.slice(2), 16) : 0;
            if (low < 0xdc00 || low > 0xdfff) this.fail("Invalid \\uXXXX\\uXXXX surrogate pair escape");
            point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
            index += 6;
          }
          result += String.fromCodePoint(point >= 0xdc00 && point <= 0xdfff ? 0xfffd : point);
        } else {
          const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (escaped === undefined || !Object.hasOwn(escapes, escaped)) this.fail("Invalid escape");
          result += escapes[escaped];
        }
        start = index + 1;
      } else if (character.charCodeAt(0) < 0x20) this.fail("Invalid string: control characters from U+0000 through U+001F must be escaped");
    }
    result += decodeUtf8(this.token.slice(start), this.budget);
    this.budget.text(result);
    return result;
  }
  private done(): Json | undefined {
    if (this.stack.length || this.next === undefined) return undefined;
    const value = this.next;
    this.next = undefined;
    this.budget.value(value);
    this.bytes = 0;
    return value;
  }
  private append(): void {
    const parent = this.stack.at(-1);
    if (Array.isArray(parent)) {
      this.budget.collection(parent.length + 1);
      parent.push(this.next!);
    } else if (typeof parent === "string") {
      const container = this.stack.at(-2) as Record<string, Json>;
      if (!Object.hasOwn(container, parent)) this.budget.collection(objectSize(container) + 1);
      put(container, parent, this.next!);
      this.stack.pop();
    } else this.fail("Objects must consist of key:value pairs");
    this.next = undefined;
  }
  private structure(character: string): void {
    const parent = this.stack.at(-1);
    if (character === "[" || character === "{") {
      if (this.next !== undefined) this.fail("Expected separator between values");
      if (++this.depth > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      this.stack.push(character === "[" ? [] : object());
    } else if (character === ":") {
      if (this.next === undefined) this.fail("Expected string key before ':'");
      if (!parent || Array.isArray(parent) || typeof parent === "string") this.fail("':' not as part of an object");
      if (typeof this.next !== "string") this.fail("Object keys must be strings");
      this.stack.push(this.next);
      this.next = undefined;
    } else if (character === ",") {
      if (this.next === undefined) this.fail("Expected value before ','");
      if (!this.stack.length) this.fail("',' not as part of an object or array");
      this.append();
    } else if (character === "]") {
      if (!Array.isArray(parent)) this.fail("Unmatched ']'");
      if (this.next !== undefined) this.append();
      else if (parent.length) this.fail("Expected another array element");
      this.next = this.stack.pop() as Json;
      this.depth--;
    } else if (character === "}") {
      if (!this.stack.length) this.fail("Unmatched '}'");
      if (this.next !== undefined) {
        if (typeof parent !== "string") this.fail("Objects must consist of key:value pairs");
        this.append();
      } else {
        if (typeof parent === "string" || Array.isArray(parent)) this.fail("Unmatched '}'");
        if (objectSize(parent!)) this.fail("Expected another key-value pair");
      }
      this.next = this.stack.pop() as Json;
      this.depth--;
    }
  }
  feed(character: string): Json | undefined {
    this.offset++;
    if (this.bom < 3) {
      if (character.charCodeAt(0) === [0xef, 0xbb, 0xbf][this.bom]) { this.bom++; return undefined; }
      if (this.bom) this.fail("Malformed BOM", false);
      this.bom = 3;
    }
    if (character === "\n") { this.line++; this.column = 0; } else this.column++;
    const space = character === " " || character === "\t" || character === "\r" || character === "\n";
    const structure = "[]{}:,".includes(character);
    const endsScalar = !this.quoted && !this.stack.length && this.token !== "" && (space || structure || character === '"');
    if (!endsScalar && (this.bytes || !space)) {
      if (++this.bytes > this.budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    }
    if (this.quoted) {
      if (character === '"' && !this.escaped) {
        this.accept(this.string());
        this.token = "";
        this.quoted = false;
        return this.done();
      }
      this.token += character;
      this.escaped = character === "\\" && !this.escaped;
      return undefined;
    }
    if (!space && !structure && character !== '"') { this.token += character; return undefined; }
    this.literal();
    const output = this.done();
    if (character === '"') this.quoted = true;
    else if (structure) this.structure(character);
    if (output !== undefined && (this.quoted || this.stack.length)) this.bytes = 1;
    return this.done() ?? output;
  }
  finish(): Json | undefined {
    if (this.quoted) this.fail("Unfinished string at EOF");
    this.literal(true);
    if (this.stack.length) this.fail("Unfinished JSON term at EOF");
    return this.done();
  }
}
export function parseJson(input: string, budget: Budget, byteEncoded = false): Json {
  const text = byteEncoded ? input : Buffer.from(input).toString("latin1");
  if (text.length > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
  const parser = new JsonParser(budget);
  let value: Json | undefined;
  const accept = (next: Json | undefined): void => {
    if (next === undefined) return;
    if (value !== undefined) throw new JqParseError("Unexpected extra JSON values", 0, 1, 0, false);
    value = next;
  };
  for (let index = 0; index < text.length; index++) {
    if (index % 1024 === 0) budget.step();
    accept(parser.feed(text[index]!));
  }
  accept(parser.finish());
  if (value === undefined) throw new JqParseError("Expected JSON value", 0, 1, 0, false);
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
  const parser = new JsonParser(budget);
  let scanned = 0;
  let nulTail: string | undefined;
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
      const value = parser.feed(character);
      if (value !== undefined) yield value;
    }
  }
  try {
    for await (const chunk of readChunks(source, budget)) yield* scan(Buffer.from(chunk).toString("latin1"));
    const value = parser.finish();
    if (value !== undefined) yield value;
  } catch (error) {
    if (!(error instanceof JqParseError)) throw error;
    throw new JqError(`parse error: ${error.diagnostic()}`);
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
