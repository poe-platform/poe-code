import { readBytes, type ByteSource } from "../../contracts/index.js";
import { Budget, hasCustomKeyOrder, JqError, JqLimitError, object, objectKeyIterator, objectSize, put, scalarJson, type Json } from "./limits.js";
import { Decimal, numericToken, isNumber, SMALL_DECIMALS } from "./numbers.js";

export class JqParseError extends JqError {
  constructor(readonly detail: string, readonly offset: number, readonly line = 1, readonly column = offset, readonly located = true) { super(detail); }
  diagnostic(): string { return this.located ? `${this.detail} at line ${this.line}, column ${this.column}` : this.detail; }
}
export function decodeUtf8(bytes: string, budget: Budget): string {
  budget.step(Math.ceil(bytes.length / 1024));
  let ascii = true;
  for (let index = 0; index < bytes.length; index++) {
    if ((index & 1023) === 0) budget.signal.throwIfAborted();
    if (bytes.charCodeAt(index) >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return bytes;
  const points: string[] = [];
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
const SHORT_JSON_STRINGS = new Array<string>(512);
function shortSliceString(fullText: string, start: number, end: number): string {
  const len = end - start;
  if (len === 0) return "";
  if (len <= 16) {
    const first = fullText.charCodeAt(start);
    const last = fullText.charCodeAt(end - 1);
    const mid = fullText.charCodeAt((start + end) >> 1);
    const slot = ((first * 31 + mid * 131 + last * 17 + len * 13) & 511);
    const cached = SHORT_JSON_STRINGS[slot];
    if (cached !== undefined && cached.length === len && fullText.startsWith(cached, start)) {
      return cached;
    }
    const s = Buffer.from(fullText.slice(start, end), "latin1").toString("latin1");
    SHORT_JSON_STRINGS[slot] = s;
    return s;
  }
  return fullText.slice(start, end);
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
  readonly events: Json[] = [];
  private readonly counts = new WeakMap<object, number>();
  private readonly closed = new WeakSet<object>();
  private readonly lastKey = new WeakMap<object, string>();
  private reusableObj: Record<string, Json> = object();
  private readonly reusableKeys: string[] = [];
  private readonly reusableArr: Json[] = [];
  private reusableInUse = false;
  constructor(private readonly budget: Budget, private readonly stream = false, line = 1, column = 0) {
    this.line = line; this.column = column;
  }
  releaseReusable(): void {
    this.reusableInUse = false;
  }
  isQuotedUnescaped(): boolean {
    return this.quoted && !this.escaped && this.bom >= 3;
  }
  isUnquotedReady(): boolean {
    return !this.quoted && this.bom >= 3;
  }
  isTopLevelIdle(): boolean {
    return !this.quoted && !this.escaped && this.stack.length === 0 && this.token === "" && this.next === undefined && !this.stream;
  }
  tryParseFlatLine(fullText: string, start: number, end: number): Json | undefined {
    const byteLen = end - start;
    if (byteLen < 2 || byteLen > this.budget.limits.maxValueBytes) return undefined;
    if (fullText.charCodeAt(start) !== 123 || fullText.charCodeAt(end - 1) !== 125) return undefined;
    if (this.budget.limits.maxDepth < 1) return undefined;
    const canReuse = !this.reusableInUse;
    let obj = canReuse ? this.reusableObj : object();
    const rKeys = this.reusableKeys;
    let shapeMatch = canReuse && rKeys.length > 0;
    let usedArr = false;
    let pos = start + 1;
    let count = 0;
    if (pos < end - 1) {
      while (true) {
        if (fullText.charCodeAt(pos) !== 34) return undefined;
        pos++;
        const keyStart = pos;
        let key: string;
        if (shapeMatch && count < rKeys.length) {
          const expectedKey = rKeys[count]!;
          const expectedEnd = keyStart + expectedKey.length;
          if (expectedEnd < end - 1 && fullText.charCodeAt(expectedEnd) === 34 && fullText.startsWith(expectedKey, keyStart)) {
            key = expectedKey;
            pos = expectedEnd;
          } else {
            while (pos < end - 1) {
              const c = fullText.charCodeAt(pos);
              if (c === 34) break;
              if (c < 32 || c >= 127 || c === 92) return undefined;
              pos++;
            }
            if (pos >= end - 1) return undefined;
            key = shortSliceString(fullText, keyStart, pos);
            if (expectedKey !== key) {
              shapeMatch = false;
              const fresh = object();
              for (let k = 0; k < count; k++) {
                const prevKey = rKeys[k]!;
                fresh[prevKey] = obj[prevKey]!;
              }
              obj = fresh;
              if (canReuse) {
                this.reusableObj = obj;
                rKeys.length = count;
              }
            }
          }
        } else {
          while (pos < end - 1) {
            const c = fullText.charCodeAt(pos);
            if (c === 34) break;
            if (c < 32 || c >= 127 || c === 92) return undefined;
            pos++;
          }
          if (pos >= end - 1) return undefined;
          key = shortSliceString(fullText, keyStart, pos);
          if (shapeMatch) {
            shapeMatch = false;
            const fresh = object();
            for (let k = 0; k < count; k++) {
              const prevKey = rKeys[k]!;
              fresh[prevKey] = obj[prevKey]!;
            }
            obj = fresh;
            if (canReuse) {
              this.reusableObj = obj;
              rKeys.length = count;
            }
          }
        }
        if (!shapeMatch) {
          if (Object.hasOwn(obj, key)) return undefined;
          if (canReuse) rKeys.push(key);
        }
        pos++;
        if (fullText.charCodeAt(pos) !== 58) return undefined;
        pos++;
        if (pos >= end - 1) return undefined;
        const vFirst = fullText.charCodeAt(pos);
        let val: Json;
        if (vFirst === 34) {
          pos++;
          const vStart = pos;
          while (pos < end - 1) {
            const c = fullText.charCodeAt(pos);
            if (c === 34) break;
            if (c < 32 || c >= 127 || c === 92) return undefined;
            pos++;
          }
          if (pos >= end - 1) return undefined;
          val = shortSliceString(fullText, vStart, pos);
          pos++;
        } else if (vFirst === 116) {
          if (fullText.charCodeAt(pos + 1) !== 114 || fullText.charCodeAt(pos + 2) !== 117 || fullText.charCodeAt(pos + 3) !== 101) return undefined;
          val = true;
          pos += 4;
        } else if (vFirst === 102) {
          if (fullText.charCodeAt(pos + 1) !== 97 || fullText.charCodeAt(pos + 2) !== 108 || fullText.charCodeAt(pos + 3) !== 115 || fullText.charCodeAt(pos + 4) !== 101) return undefined;
          val = false;
          pos += 5;
        } else if (vFirst === 110) {
          if (fullText.charCodeAt(pos + 1) !== 117 || fullText.charCodeAt(pos + 2) !== 108 || fullText.charCodeAt(pos + 3) !== 108) return undefined;
          val = null;
          pos += 4;
        } else if (vFirst >= 48 && vFirst <= 57) {
          const nStart = pos;
          let num = vFirst - 48;
          pos++;
          if (vFirst === 48) {
            const nextC = fullText.charCodeAt(pos);
            if (nextC !== 44 && nextC !== 125) return undefined;
            val = SMALL_DECIMALS[0]!;
          } else {
            while (pos < end - 1) {
              const c = fullText.charCodeAt(pos);
              if (c < 48 || c > 57) break;
              num = num * 10 + (c - 48);
              pos++;
            }
            if (pos - nStart > 15) return undefined;
            const nextC = fullText.charCodeAt(pos);
            if (nextC !== 44 && nextC !== 125) return undefined;
            if (num <= 1024) val = SMALL_DECIMALS[num]!;
            else {
              const s = fullText.slice(nStart, pos);
              val = new Decimal(s, 0, false, s, num);
            }
          }
        } else if (vFirst === 91) {
          pos++;
          let arr: Json[];
          if (canReuse && !usedArr) {
            usedArr = true;
            arr = this.reusableArr;
            arr.length = 0;
          } else {
            arr = [];
          }
          if (fullText.charCodeAt(pos) === 93) {
            pos++;
          } else {
            while (pos < end - 1) {
              const eFirst = fullText.charCodeAt(pos);
              let elem: Json;
              if (eFirst === 34) {
                pos++;
                const sStart = pos;
                while (pos < end - 1) {
                  const c = fullText.charCodeAt(pos);
                  if (c === 34) break;
                  if (c < 32 || c >= 127 || c === 92) return undefined;
                  pos++;
                }
                if (pos >= end - 1) return undefined;
                elem = shortSliceString(fullText, sStart, pos);
                pos++;
              } else if (eFirst >= 48 && eFirst <= 57) {
                const nStart = pos;
                let num = eFirst - 48;
                pos++;
                if (eFirst !== 48) {
                  while (pos < end - 1) {
                    const c = fullText.charCodeAt(pos);
                    if (c < 48 || c > 57) break;
                    num = num * 10 + (c - 48);
                    pos++;
                  }
                }
                if (pos - nStart > 15) return undefined;
                const nextC = fullText.charCodeAt(pos);
                if (nextC !== 44 && nextC !== 93) return undefined;
                if (num <= 1024) elem = SMALL_DECIMALS[num]!;
                else {
                  const s = fullText.slice(nStart, pos);
                  elem = new Decimal(s, 0, false, s, num);
                }
              } else {
                return undefined;
              }
              arr.push(elem);
              if (arr.length > this.budget.limits.maxCollectionSize) return undefined;
              const aSep = fullText.charCodeAt(pos);
              if (aSep === 44) {
                pos++;
                continue;
              }
              if (aSep === 93) {
                pos++;
                break;
              }
              return undefined;
            }
          }
          val = arr;
        } else {
          return undefined;
        }
        count++;
        if (count > this.budget.limits.maxCollectionSize) return undefined;
        const kFirst = key.charCodeAt(0);
        if (kFirst >= 48 && kFirst <= 57 || key === "__proto__") {
          if (shapeMatch) {
            shapeMatch = false;
            const fresh = object();
            for (let k = 0; k < count - 1; k++) {
              const prevKey = rKeys[k]!;
              fresh[prevKey] = obj[prevKey]!;
            }
            obj = fresh;
            if (canReuse) {
              this.reusableObj = obj;
              rKeys.length = 0;
            }
          }
          put(obj, key, val);
        }
        else obj[key] = val;
        const sep = fullText.charCodeAt(pos);
        if (sep === 44) {
          pos++;
          continue;
        }
        if (sep === 125 && pos === end - 1) break;
        return undefined;
      }
    }
    if (shapeMatch && count !== rKeys.length) {
      const fresh = object();
      for (let k = 0; k < count; k++) {
        const prevKey = rKeys[k]!;
        fresh[prevKey] = obj[prevKey]!;
      }
      obj = fresh;
      if (canReuse) {
        this.reusableObj = obj;
        rKeys.length = count;
      }
    }
    if (canReuse) this.reusableInUse = true;
    this.bom = 3;
    this.offset += byteLen + 1;
    this.line++;
    this.column = 0;
    this.bytes = 0;
    this.budget.step(count * 3 + 2);
    return obj;
  }
  appendQuotedSpan(span: string): void {
    const len = span.length;
    this.offset += len;
    this.column += len;
    this.bytes += len;
    if (this.bytes > this.budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    this.token += span;
  }
  appendTokenSpan(span: string): void {
    const len = span.length;
    this.offset += len;
    this.column += len;
    this.bytes += len;
    if (this.bytes > this.budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    this.token += span;
  }
  path(): Json[] {
    const path: Json[] = [];
    for (const frame of this.stack) {
      if (Array.isArray(frame)) path.push(this.counts.get(frame) ?? frame.length);
      else if (typeof frame === "string") path.push(frame);
    }
    return path;
  }
  private event(value: Json): void {
    this.budget.value(value);
    this.events.push(value);
  }
  private leaf(value: Json): void {
    if (value !== null && typeof value === "object" && this.closed.has(value)) return;
    this.event([this.path(), value]);
  }
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
    let fastAscii = true;
    for (let index = 0; index < this.token.length; index++) {
      const code = this.token.charCodeAt(index);
      if (code === 92 || code < 0x20 || code >= 0x80) {
        fastAscii = false;
        break;
      }
    }
    if (fastAscii) {
      const steps = Math.ceil(this.token.length / 1024);
      if (steps > 0) this.budget.step(steps * 2);
      else this.budget.signal.throwIfAborted();
      this.budget.text(this.token);
      return this.token;
    }
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
    if (this.stream) this.leaf(value);
    this.bytes = 0;
    return value;
  }
  private append(): void {
    const parent = this.stack.at(-1);
    if (this.stream) {
      this.leaf(this.next!);
      const container = typeof parent === "string" ? this.stack.at(-2) as object : parent as object;
      const count = (this.counts.get(container) ?? 0) + 1;
      this.budget.collection(count);
      this.counts.set(container, count);
      if (typeof parent === "string") this.stack.pop();
      else if (!Array.isArray(parent)) this.fail("Objects must consist of key:value pairs");
      this.next = undefined;
      return;
    }
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
    const closingPath = this.stream && (character === "]" || character === "}") ? this.path() : undefined;
    const closingContainer = typeof parent === "string" ? this.stack.at(-2) : parent;
    const closingCount = closingContainer && typeof closingContainer === "object" ? this.counts.get(closingContainer) ?? 0 : 0;
    if (character === "[" || character === "{") {
      if (this.next !== undefined) this.fail("Expected separator between values");
      if (++this.depth > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      this.stack.push(character === "[" ? [] : object());
    } else if (character === ":") {
      if (this.next === undefined) this.fail("Expected string key before ':'");
      if (!parent || Array.isArray(parent) || typeof parent === "string") this.fail("':' not as part of an object");
      if (typeof this.next !== "string") this.fail("Object keys must be strings");
      if (this.stream) this.lastKey.set(parent as object, this.next);
      this.stack.push(this.next);
      this.next = undefined;
    } else if (character === ",") {
      if (this.next === undefined) this.fail("Expected value before ','");
      if (!this.stack.length) this.fail("',' not as part of an object or array");
      this.append();
    } else if (character === "]") {
      if (!Array.isArray(parent)) this.fail("Unmatched ']'");
      if (this.next !== undefined) this.append();
      else if (parent.length || closingCount) this.fail("Expected another array element");
      this.next = this.stack.pop() as Json;
      this.depth--;
    } else if (character === "}") {
      if (!this.stack.length) this.fail("Unmatched '}'");
      if (this.next !== undefined) {
        if (typeof parent !== "string") this.fail("Objects must consist of key:value pairs");
        this.append();
      } else {
        if (typeof parent === "string" || Array.isArray(parent)) this.fail("Unmatched '}'");
        if (objectSize(parent!) || closingCount) this.fail("Expected another key-value pair");
      }
      this.next = this.stack.pop() as Json;
      this.depth--;
    }
    if (closingPath && this.next !== null && typeof this.next === "object") {
      if (closingCount || (closingContainer && typeof closingContainer === "object" && (this.counts.get(closingContainer) ?? 0))) {
        // A close event identifies the last child, including nested containers.
        if (Array.isArray(closingContainer)) closingPath[closingPath.length - 1] = (this.counts.get(closingContainer) ?? 1) - 1;
        else if (typeof parent !== "string") closingPath.push(this.lastKey.get(closingContainer as object)!);
        this.event([closingPath]);
      } else {
        if (Array.isArray(closingContainer)) closingPath.pop();
        this.event([closingPath, this.next]);
      }
      this.closed.add(this.next);
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
  finish(boundary?: { line: number; column: number; eof: boolean }): Json | undefined {
    if (boundary && !this.quoted && !this.stack.length && this.token && numericToken(this.token, this.budget) !== undefined) {
      throw new JqParseError(`Potentially truncated top-level numeric value${boundary.eof ? " at EOF" : ""}`, this.offset, boundary.line, boundary.column);
    }
    if (boundary && !boundary.eof && this.stack.length && !this.quoted && !this.token) return undefined;
    if (boundary && !boundary.eof && (this.quoted || this.token && this.stack.length)) {
      throw new JqParseError("Truncated value", this.offset, boundary.line, boundary.column);
    }
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
      const p1 = budget.tickSync();
      if (p1) await p1;
      if (newline >= 0 && end === newline + 1) { budget.inputLocation.line++; budget.inputLocation.complete = true; }
      yield chunk.subarray(offset, end);
      offset = end;
    }
  }
  budget.inputLocation.complete = true;
}
export interface JsonInputOptions {
  readonly stream?: boolean;
  readonly streamErrors?: boolean;
  readonly sequence?: boolean;
  readonly warning?: (message: string) => Promise<void>;
  readonly onValue?: (value: Json) => Promise<void> | void;
  readonly onChunkEnd?: () => Promise<void> | void;
  readonly hasPendingDiagnostics?: () => boolean;
}
export async function* jsonValues(source: ByteSource, budget: Budget, options: JsonInputOptions = {}): AsyncGenerator<Json> {
  let parser = new JsonParser(budget, options.stream);
  let active = !options.sequence;
  let failed = false;
  const values = function* (value: Json | undefined): Generator<Json> {
    if (options.stream) yield* parser.events.splice(0);
    else if (value !== undefined) yield value;
  };
  const failure = async function* (error: unknown, eof = false): AsyncGenerator<Json> {
    if (!(error instanceof JqParseError)) throw error;
    if (options.streamErrors) yield [error.diagnostic(), parser.path()];
    else if (options.sequence) await options.warning?.(`ignoring parse error: ${error.diagnostic()}${eof ? "" : " (need RS to resync)"}`);
    else throw error;
    failed = true;
  };
  let scanned = 0;
  let line = 1;
  let column = 0;
  let nulTail: string | undefined;
  const iter = readBytes(source, budget.signal)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
  };
  let done = false;
  try {
    while (true) {
      const syncRes = typeof iter.tryNextSync === "function" ? iter.tryNextSync() : undefined;
      const res = syncRes ?? await iter.next();
      if (res.done) { done = true; break; }
      const rawChunk = res.value;
      const pt = budget.tickSync();
      if (pt) await pt;
      budget.inputBytes += rawChunk.byteLength;
      if (budget.inputBytes > budget.limits.maxInputBytes) throw new JqLimitError("maxInputBytes");
      const fullText = Buffer.isBuffer(rawChunk)
        ? rawChunk.toString("latin1")
        : Buffer.from(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength).toString("latin1");
      let chunkOffset = 0;
      while (chunkOffset < fullText.length) {
        if (budget.inputLocation.complete) {
          if (options.hasPendingDiagnostics?.()) budget.inputLocation = { ...budget.inputLocation, complete: false };
          else budget.inputLocation.complete = false;
        }
        const newline = fullText.indexOf("\n", chunkOffset);
        const segEnd = Math.min(newline < 0 ? fullText.length : newline + 1, chunkOffset + 16384);
        budget.step(Math.ceil((segEnd - chunkOffset) / 1024));
        const pt = budget.tickSync();
        if (pt) await pt;
        if (newline >= 0 && segEnd === newline + 1) {
          budget.inputLocation.line++;
          budget.inputLocation.complete = true;
          if (nulTail === undefined && active && !failed && !options.sequence && !options.stream && !options.streamErrors && parser.isTopLevelIdle()) {
            const fastObj = parser.tryParseFlatLine(fullText, chunkOffset, newline);
            if (fastObj !== undefined) {
              line++;
              column = 0;
              scanned += segEnd - chunkOffset;
              if (scanned >= 1024) {
                scanned &= 1023;
                const p = budget.tickSync();
                if (p) await p;
              }
              if (options.onValue) {
                const pending = options.onValue(fastObj);
                if (pending) await pending;
                else parser.releaseReusable();
                if (budget.needsYield()) {
                  const py = budget.tickSync(0);
                  if (py) await py;
                }
              } else {
                yield fastObj;
              }
              chunkOffset = segEnd;
              continue;
            }
          }
        }
        for (let index = chunkOffset; index < segEnd; index++) {
          if ((++scanned & 1023) === 0) {
            const p = budget.tickSync();
            if (p) await p;
          }
          if (nulTail === undefined && active && !failed) {
            if (parser.isQuotedUnescaped()) {
              let end = index;
              while (end < segEnd) {
                const code = fullText.charCodeAt(end);
                if (code === 34 || code === 92 || code === 10 || code === 0 || code === 30) break;
                end++;
              }
              if (end > index) {
                parser.appendQuotedSpan(fullText.slice(index, end));
                column += end - index;
                scanned += end - index - 1;
                index = end - 1;
                continue;
              }
            } else if (parser.isUnquotedReady()) {
              const firstCode = fullText.charCodeAt(index);
              if (firstCode > 32 && firstCode !== 34 && firstCode !== 44 && firstCode !== 58 && firstCode !== 91 && firstCode !== 93 && firstCode !== 123 && firstCode !== 125 && firstCode !== 30) {
                let end = index + 1;
                while (end < segEnd) {
                  const c = fullText.charCodeAt(end);
                  if (c <= 32 || c === 34 || c === 44 || c === 58 || c === 91 || c === 93 || c === 123 || c === 125 || c === 30) break;
                  end++;
                }
                if (end > index + 1) {
                  parser.appendTokenSpan(fullText.slice(index, end));
                  column += end - index;
                  scanned += end - index - 1;
                  index = end - 1;
                  continue;
                }
              }
            }
          }
          const character = fullText[index]!;
          if (character === "\0" && nulTail === undefined) nulTail = "";
          if (nulTail !== undefined) {
            nulTail += character;
            if (nulTail.length > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
            if (character === "\n") {
              const tail = nulTail;
              nulTail = undefined;
              for (let ti = 0; ti < tail.length; ti++) {
                if ((++scanned & 1023) === 0) {
                  const p = budget.tickSync();
                  if (p) await p;
                }
                const tc = tail[ti]!;
                if (tc === "\n") { line++; column = 0; } else column++;
                if (options.sequence && tc === "\x1e") {
                  if (active && !failed) {
                    try { yield* values(parser.finish({ line, column, eof: false })); } catch (error) { yield* failure(error, true); }
                  }
                  parser = new JsonParser(budget, options.stream, line, column);
                  active = true; failed = false;
                  continue;
                }
                if (!active) continue;
                if (!failed) {
                  try {
                    const produced = parser.feed(tc);
                    if (options.stream) {
                      if (parser.events.length) yield* parser.events.splice(0);
                    } else if (produced !== undefined) {
                      yield produced;
                    }
                  } catch (error) { yield* failure(error); }
                }
                if (failed && options.streamErrors && !options.sequence && tc === "\n") {
                  parser = new JsonParser(budget, true, line, column);
                  failed = false;
                }
              }
            }
            continue;
          }
          if (character === "\n") { line++; column = 0; } else column++;
          if (options.sequence && character === "\x1e") {
            if (active && !failed) {
              try { yield* values(parser.finish({ line, column, eof: false })); } catch (error) { yield* failure(error, true); }
            }
            parser = new JsonParser(budget, options.stream, line, column);
            active = true; failed = false;
            continue;
          }
          if (!active) continue;
          if (!failed) {
            try {
              const produced = parser.feed(character);
              if (options.stream) {
                if (parser.events.length) yield* parser.events.splice(0);
              } else if (produced !== undefined) {
                yield produced;
              }
            } catch (error) { yield* failure(error); }
          }
          if (failed && options.streamErrors && !options.sequence && character === "\n") {
            parser = new JsonParser(budget, true, line, column);
            failed = false;
          }
        }
        chunkOffset = segEnd;
      }
      if (options.onChunkEnd) await options.onChunkEnd();
    }
  } finally {
    if (!done) await iter.return?.();
  }
  try {
    budget.inputLocation.complete = true;
    if (active && !failed) {
      try { yield* values(parser.finish(options.sequence ? { line, column, eof: true } : undefined)); } catch (error) { yield* failure(error, true); }
    }
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

export interface JsonFormat {
  indent: string;
  ascii: boolean;
  color: boolean;
}

export type JsonFragment = { readonly bytes: number; readonly text: string } | {
  readonly bytes: number;
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly quoted: boolean;
  readonly ascii?: boolean;
};

function* quotedFragments(value: string, budget: Budget, ascii = false): Generator<JsonFragment> {
  yield { text: '"', bytes: 1 };
  let offset = 0;
  while (offset < value.length) {
    const start = offset;
    const limit = Math.min(start + 32, value.length);
    budget.step(limit - start);
    let bytes = 0;
    while (offset < limit) {
      const code = value.charCodeAt(offset);
      if (code >= 0xd800 && code <= 0xdbff && offset + 1 === limit && limit < value.length) break;
      if (code >= 0xd800 && code <= 0xdbff && offset + 1 < limit) {
        const next = value.charCodeAt(offset + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { bytes += ascii ? 12 : 4; offset += 2; continue; }
      }
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
      else if (code < 32 || code === 127 || (ascii && code > 127) || (code >= 0xd800 && code <= 0xdfff)) bytes += 6;
      else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
      offset++;
    }
    yield { value, start, end: offset, bytes, quoted: true, ascii };
  }
  yield { text: '"', bytes: 1 };
}

export function renderJsonFragment(fragment: JsonFragment, budget: Budget): string {
  if ("text" in fragment) return fragment.text;
  budget.step(fragment.end - fragment.start);
  const text = fragment.value.slice(fragment.start, fragment.end);
  if (!fragment.quoted) return text;
  const quoted = JSON.stringify(text).slice(1, -1);
  if (!fragment.ascii && !text.includes("\x7f")) return quoted;
  let escaped = "";
  for (let index = 0; index < quoted.length; index++) {
    const code = quoted.charCodeAt(index);
    escaped += code === 127 || (fragment.ascii && code > 127) ? "\\u" + code.toString(16).padStart(4, "0") : quoted[index];
  }
  return escaped;
}

export function* jsonFragments(value: Json, budget: Budget, format: boolean | JsonFormat = false, depth = 0): Generator<JsonFragment> {
  budget.step();
  if (depth > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
  const indent = typeof format === "boolean" ? format ? "  " : "" : format.indent;
  const ascii = typeof format !== "boolean" && format.ascii;
  const color = typeof format !== "boolean" && format.color;
  if (color) {
    const code = value === null ? "0;90" : typeof value === "string" ? "0;32" : typeof value !== "object" || isNumber(value) ? "0;39" : "1;39";
    yield { text: "\x1b[" + code + "m", bytes: 7 };
  }
  if (typeof value === "string") {
    yield* quotedFragments(value, budget, ascii);
    if (color) yield { text: "\x1b[0m", bytes: 4 };
    return;
  }
  if (value === null || typeof value !== "object" || isNumber(value)) {
    const text = scalarJson(value, budget);
    const nan = color && value !== null && text === "null";
    if (nan) yield { text: "\x1b[0;90m", bytes: 7 };
    for (let start = 0; start < text.length; start += 32) {
      const end = Math.min(start + 32, text.length);
      budget.step(end - start);
      yield { value: text, start, end, bytes: end - start, quoted: false };
    }
    if (nan) yield { text: "\x1b[0m", bytes: 4 };
    if (color) yield { text: "\x1b[0m", bytes: 4 };
    return;
  }
  if (depth + 1 > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
  const array = Array.isArray(value);
  if (array) budget.collection(value.length);
  yield { text: array ? "[" : "{", bytes: 1 };
  let count = 0;
  const keys = array ? value.keys() : objectKeyIterator(value);
  for (const key of keys) {
    budget.step();
    budget.collection(count + 1);
    if (count++) yield { text: ",", bytes: 1 };
    if (indent) {
      const bytes = 1 + indent.length * (depth + 1);
      budget.step(bytes);
      yield { text: `\n${indent.repeat(depth + 1)}`, bytes };
    }
    if (!array) {
      if (color) yield { text: "\x1b[0m\x1b[1;34m", bytes: 11 };
      yield* quotedFragments(String(key), budget, ascii);
      if (color) yield { text: "\x1b[0m\x1b[1;39m", bytes: 11 };
      yield { text: indent ? ": " : ":", bytes: indent ? 2 : 1 };
      if (color) yield { text: "\x1b[0m", bytes: 4 };
    }
    yield* jsonFragments((value as Record<string | number, Json>)[key]!, budget, format, depth + 1);
    if (color) yield { text: "\x1b[1;39m", bytes: 7 };
  }
  if (indent && count) {
    const bytes = 1 + indent.length * depth;
    budget.step(bytes);
    yield { text: `\n${indent.repeat(depth)}`, bytes };
  }
  if (color && count) yield { text: "\x1b[1;39m", bytes: 7 };
  yield { text: array ? "]" : "}", bytes: 1 };
  if (color) yield { text: "\x1b[0m", bytes: 4 };
}

export async function measureValue(value: Json, budget: Budget, depth = 0, maxBytes = budget.limits.maxValueBytes): Promise<number> {
  await budget.tick(0);
  let bytes = 0;
  for (const fragment of jsonFragments(value, budget, false, depth)) {
    await budget.tick(0);
    bytes += fragment.bytes;
    if (bytes > maxBytes) throw new JqLimitError("maxValueBytes");
  }
  return bytes;
}

export function tryWriteCompactSync(
  value: Json,
  budget: Budget,
  buf: Uint8Array,
  startPos: number,
  suffix: string,
  maxBytes: number,
): number {
  if (budget.needsYield()) return -1;
  if (value === null || typeof value !== "object" || Array.isArray(value) || isNumber(value) || budget.limits.maxDepth < 1) {
    return -1;
  }
  const obj = value as Record<string, Json>;
  if (hasCustomKeyOrder(obj)) return -1;
  let pos = startPos;
  const cap = buf.length;
  if (pos + 2 + suffix.length > cap) return -1;
  buf[pos++] = 123; // '{'
  let count = 0;
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
    const kLen = key.length;
    if (kLen > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    if (pos + kLen + 5 + suffix.length > cap) return -1;
    if (count++ > 0) buf[pos++] = 44; // ','
    budget.collection(count);
    buf[pos++] = 34; // '"'
    for (let i = 0; i < kLen; i++) {
      const c = key.charCodeAt(i);
      if (c < 32 || c >= 127 || c === 34 || c === 92) return -1;
      buf[pos++] = c;
    }
    buf[pos++] = 34; // '"'
    buf[pos++] = 58; // ':'
    const v = obj[key]!;
    if (typeof v === "string") {
      const vLen = v.length;
      if (vLen > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      if (pos + vLen + 3 + suffix.length > cap) return -1;
      buf[pos++] = 34; // '"'
      for (let i = 0; i < vLen; i++) {
        const c = v.charCodeAt(i);
        if (c < 32 || c >= 127 || c === 34 || c === 92) return -1;
        buf[pos++] = c;
      }
      buf[pos++] = 34; // '"'
    } else {
      let vStr: string;
      if (typeof v === "number" && Number.isFinite(v)) {
        vStr = (v | 0) === v && v >= 0 && v <= 1024 && (v !== 0 || 1 / v > 0)
          ? SMALL_DECIMALS[v]!.text
          : Object.is(v, -0) ? "-0" : String(v);
      } else if (isNumber(v) && typeof v === "object" && Number.isFinite(v.double)) {
        vStr = v.text;
      } else if (typeof v === "boolean") {
        vStr = v ? "true" : "false";
      } else if (v === null) {
        vStr = "null";
      } else {
        return -1;
      }
      const vLen = vStr.length;
      if (pos + vLen + 1 + suffix.length > cap) return -1;
      for (let i = 0; i < vLen; i++) buf[pos++] = vStr.charCodeAt(i);
    }
  }
  buf[pos++] = 125; // '}'
  const jsonLen = pos - startPos;
  if (jsonLen > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
  if (jsonLen > maxBytes) throw new JqLimitError("maxOutputBytes");
  for (let i = 0; i < suffix.length; i++) buf[pos++] = suffix.charCodeAt(i);
  budget.step(jsonLen * 2 + count * 12 + 2);
  return pos;
}

export function tryStringifyCompactSync(
  value: Json,
  budget: Budget,
  maxBytes: number,
  limitName: "maxValueBytes" | "maxOutputBytes" = "maxOutputBytes",
): string | undefined {
  if (budget.needsYield()) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value) || isNumber(value) || budget.limits.maxDepth < 1) {
    return undefined;
  }
  const obj = value as Record<string, Json>;
  if (hasCustomKeyOrder(obj)) return undefined;
  let out = "{";
  let count = 0;
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      if (c < 32 || c >= 127 || c === 34 || c === 92) return undefined;
    }
    const v = obj[key]!;
    let vStr: string;
    if (typeof v === "number" && Number.isFinite(v)) {
      vStr = Object.is(v, -0) ? "-0" : String(v);
    } else if (isNumber(v) && typeof v === "object" && Number.isFinite(v.double)) {
      vStr = v.text;
    } else if (typeof v === "boolean") {
      vStr = v ? "true" : "false";
    } else if (v === null) {
      vStr = "null";
    } else if (typeof v === "string") {
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        if (c < 32 || c >= 127 || c === 34 || c === 92) return undefined;
      }
      vStr = `"${v}"`;
    } else {
      return undefined;
    }
    if (count++) out += ",";
    out += `"${key}":${vStr}`;
    budget.collection(count);
  }
  out += "}";
  if (out.length > maxBytes) throw new JqLimitError(limitName);
  budget.step(out.length * 2 + count * 12 + 2);
  return out;
}

export async function stringify(value: Json, budget: Budget, format: boolean | JsonFormat = false, maxBytes = budget.limits.maxValueBytes, limitName: "maxValueBytes" | "maxOutputBytes" = "maxValueBytes", asStringValue = false): Promise<string> {
  const p0 = budget.tickSync(0);
  if (p0) await p0;
  const isCompactPlain = !asStringValue && (format === false || (typeof format === "object" && format.indent === "" && !format.ascii && !format.color));
  if (isCompactPlain && value !== null && typeof value === "object" && !Array.isArray(value) && !isNumber(value) && budget.limits.maxDepth >= 1) {
    let fastOk = true;
    let out = "{";
    let count = 0;
    for (const key of objectKeyIterator(value as Record<string, Json>)) {
      for (let i = 0; i < key.length; i++) {
        const c = key.charCodeAt(i);
        if (c < 32 || c >= 127 || c === 34 || c === 92) { fastOk = false; break; }
      }
      if (!fastOk) break;
      const v = (value as Record<string, Json>)[key]!;
      let vStr: string;
      if (typeof v === "number" && Number.isFinite(v)) {
        vStr = Object.is(v, -0) ? "-0" : String(v);
      } else if (isNumber(v) && typeof v === "object" && Number.isFinite(v.double)) {
        vStr = v.text;
      } else if (typeof v === "boolean") {
        vStr = v ? "true" : "false";
      } else if (v === null) {
        vStr = "null";
      } else if (typeof v === "string") {
        for (let i = 0; i < v.length; i++) {
          const c = v.charCodeAt(i);
          if (c < 32 || c >= 127 || c === 34 || c === 92) { fastOk = false; break; }
        }
        if (!fastOk) break;
        vStr = `"${v}"`;
      } else {
        fastOk = false;
        break;
      }
      if (count++) out += ",";
      out += `"${key}":${vStr}`;
      budget.collection(count);
    }
    if (fastOk) {
      out += "}";
      if (out.length > maxBytes) throw new JqLimitError(limitName);
      const pEnd = budget.tickSync(out.length * 2 + count * 12 + 2);
      if (pEnd) await pEnd;
      return out;
    }
  }
  const parts: string[] = [];
  let bytes = 0;
  let units = 0;
  let stringBytes = 2;
  for (const fragment of jsonFragments(value, budget, format)) {
    const pf = budget.tickSync(0);
    if (pf) await pf;
    bytes += fragment.bytes;
    if (bytes > maxBytes) throw new JqLimitError(limitName);
    const text = renderJsonFragment(fragment, budget);
    if (asStringValue) {
      for (const encoded of quotedFragments(text, budget)) stringBytes += encoded.bytes;
      stringBytes -= 2;
      if (stringBytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    }
    budget.step();
    units += text.length;
    parts.push(text);
  }
  const pEnd = budget.tickSync(units);
  if (pEnd) await pEnd;
  return parts.join("");
}
