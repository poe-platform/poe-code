import { CsvkitBlocked, CsvkitWorkBudgetError } from "./errors.js";
import { PythonException } from "./diagnostics/index.js";

function blocked(): never { throw new CsvkitBlocked("SQL option literal syntax or native diagnostic profile"); }

function syntax(detail: string): never { throw new PythonException('SyntaxError', `${detail} (<unknown>, line 1)`); }

/** Lexical exception profiles measured against CPython 3.14.2 and the released CLI.
 * Multi-line errors and unqualified token classes deliberately remain blockers.
 */
function syntaxProfile(raw: string): void {
  const source = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const brackets: string[] = [];
  let line = 1;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '\n') { line++; continue; }
    if (char === '#') { while (index + 1 < source.length && source[index + 1] !== '\n') index++; continue; }
    if (char === "'" || char === '"') {
      const triple = source.slice(index, index + 3) === char.repeat(3);
      const delimiter = triple ? char.repeat(3) : char;
      const initialLine = line;
      index += delimiter.length;
      let closed = false;
      for (; index < source.length; index++) {
        if (source[index] === '\\') { if (source[index + 1] === '\n') line++; index++; continue; }
        if (source.startsWith(delimiter, index)) { index += delimiter.length - 1; closed = true; break; }
        if (source[index] === '\n') {
          if (!triple) { if (initialLine !== 1) blocked(); syntax('unterminated string literal (detected at line 1)'); }
          line++;
        }
      }
      if (!closed) {
        if (triple || initialLine !== 1) blocked();
        syntax('unterminated string literal (detected at line 1)');
      }
      continue;
    }
    if (char === '\u00a0') { if (line !== 1) blocked(); syntax('invalid non-printable character U+00A0'); }
    if ('٠١٢٣٤٥٦٧٨٩'.includes(char)) {
      if (line !== 1) blocked();
      syntax(`invalid character '${char}' (U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`);
    }
    if ('([{'.includes(char)) {
      brackets.push(char);
      if (brackets.length > 200) { if (line !== 1) blocked(); syntax('too many nested parentheses'); }
    } else if (')]}'.includes(char)) {
      const opening = brackets.pop();
      if (opening === undefined) blocked();
      if ('([{'.indexOf(opening) !== ')]}'.indexOf(char)) {
        if (line !== 1) blocked();
        syntax(`closing parenthesis '${char}' does not match opening parenthesis '${opening}'`);
      }
    }
  }
  if (brackets.length) {
    if (line !== 1) blocked();
    syntax(`'${brackets[brackets.length - 1]}' was never closed`);
  }
}

function digits(text: string, alphabet: string, prefixUnderscore = false): string {
  let result = "";
  let previousDigit = prefixUnderscore;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!.toLowerCase();
    if (alphabet.includes(char)) { result += char; previousDigit = true; }
    else if (char === "_" && previousDigit && index + 1 < text.length) previousDigit = false;
    else blocked();
  }
  if (!result || !previousDigit) blocked();
  return result;
}

/** Python literal tokens, unlike int(), accept only ASCII numeric digits. */
function numeric(text: string): number | bigint {
  const sign = text[0] === "-" ? -1 : 1;
  const payload = text[0] === "+" || text[0] === "-" ? text.slice(1) : text;
  const base = payload.slice(0, 2).toLowerCase();
  if (["0x", "0o", "0b"].includes(base)) {
    const alphabet = base === "0x" ? "0123456789abcdef" : base === "0o" ? "01234567" : "01";
    if (payload.slice(2).includes('__')) syntax(`invalid ${base === '0x' ? 'hexadecimal' : base === '0o' ? 'octal' : 'binary'} literal`);
    const body = digits(payload.slice(2), alphabet, true);
    if (body.length > 4300) blocked();
    const value = BigInt(base + body) * BigInt(sign);
    return Number.isSafeInteger(Number(value)) ? Number(value) : value;
  }
  if (payload.includes('__')) syntax('invalid decimal literal');
  const exponentIndex = Array.from(payload).findIndex(char => char === "e" || char === "E");
  const mantissa = exponentIndex < 0 ? payload : payload.slice(0, exponentIndex);
  let exponent = "";
  if (exponentIndex >= 0) {
    const tail = payload.slice(exponentIndex + 1);
    if (!tail || tail === '+' || tail === '-') syntax('invalid decimal literal');
    const signed = tail[0] === "+" || tail[0] === "-";
    exponent = "e" + (signed ? tail[0] : "") + digits(signed ? tail.slice(1) : tail, "0123456789");
  }
  const point = mantissa.indexOf(".");
  if (point >= 0) {
    const before = mantissa.slice(0, point), after = mantissa.slice(point + 1);
    if (!before && !after) blocked();
    const body = (before ? digits(before, "0123456789") : "") + "." + (after ? digits(after, "0123456789") : "");
    return Number((sign < 0 ? "-" : "") + body + exponent);
  }
  const body = digits(mantissa, "0123456789");
  if (exponent) return Number((sign < 0 ? "-" : "") + body + exponent);
  if (body.length > 4300) syntax(`Exceeds the limit (4300 digits) for integer string conversion: value has ${body.length} digits; use sys.set_int_max_str_digits() to increase the limit - Consider hexadecimal for huge integer literals to avoid decimal conversion limits.`);
  if (body.length > 1 && body[0] === '0' && Array.from(body).some(char => char !== '0')) syntax('leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers');
  const value = BigInt(body) * BigInt(sign);
  return Number.isSafeInteger(Number(value)) ? Number(value) : value;
}

function quoted(text: string): string {
  // CPython normalizes physical source line endings before decoding literals,
  // including raw strings and escaped line continuations.
  text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const prefix = "rRuU".includes(text[0]!) ? text[0]!.toLowerCase() : "";
  const start = prefix ? 1 : 0;
  const quote = text[start]!;
  const triple = text.slice(start, start + 3) === quote.repeat(3);
  const delimiter = quote.repeat(triple ? 3 : 1);
  const escapes: Readonly<Record<string, string>> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"' };
  let output = "";
  for (let index = start + delimiter.length; index < text.length; index++) {
    if (text.startsWith(delimiter, index)) {
      if (index + delimiter.length !== text.length) blocked();
      return output;
    }
    const char = text[index]!;
    if (char === "\0" || (!triple && (char === "\n" || char === "\r"))) blocked();
    if (char !== "\\") { output += char; continue; }
    const escape = text[++index];
    if (escape === undefined) blocked();
    if (prefix === "r") { output += "\\" + escape; continue; }
    if (Object.hasOwn(escapes, escape)) { output += escapes[escape]; continue; }
    if (escape === "\n") continue;
    if (escape === "x" || escape === "u" || escape === "U") {
      const width = escape === "x" ? 2 : escape === "u" ? 4 : 8;
      const token = text.slice(index + 1, index + 1 + width);
      if (token.length !== width || Array.from(token).some(char => !"0123456789abcdef".includes(char.toLowerCase()))) blocked();
      const point = Number.parseInt(token, 16);
      if (point > 0x10ffff) blocked();
      // JavaScript merges adjacent surrogate code units into the same string
      // as a non-BMP scalar. Python keeps those escaped scalar identities apart.
      if (point >= 0xd800 && point <= 0xdfff) throw new CsvkitBlocked("SQL string surrogate scalar identity");
      output += String.fromCodePoint(point); index += width; continue;
    }
    if ("01234567".includes(escape)) {
      let token = escape;
      while (token.length < 3 && "01234567".includes(text[index + 1] ?? "\0")) token += text[++index];
      const point = Number.parseInt(token, 8);
      if (point > 255) blocked(); // CPython emits a warning; not qualified here.
      output += String.fromCharCode(point); continue;
    }
    blocked(); // Named/unknown escapes and their warnings require qualification.
  }
  return blocked();
}

/** Tuple identity is retained rather than silently converting tuples to lists. */
export class SqlTuple extends Array<unknown> {}
const nonLiteral = Symbol('Python AST is not a literal');

// Container nodes are syntax, not Python values. Conversion must wait until
// the whole expression has parsed, then follow literal_eval's evaluation order.
class ParsedContainer {
  constructor(readonly kind: 'list' | 'tuple' | 'set' | 'dict', readonly items: readonly unknown[] = [],
    readonly entries: readonly (readonly [unknown, unknown])[] = []) {}
}

function pythonEqual(left: unknown, right: unknown, step: () => void): boolean {
  step();
  if (left instanceof SqlTuple && right instanceof SqlTuple) return left.length === right.length && left.every((value, index) => pythonEqual(value, right[index], step));
  if ((typeof left === 'boolean' || typeof left === 'number' || typeof left === 'bigint') && (typeof right === 'boolean' || typeof right === 'number' || typeof right === 'bigint')) {
    const a = typeof left === 'boolean' ? Number(left) : left;
    const b = typeof right === 'boolean' ? Number(right) : right;
    if (typeof a === typeof b) return a === b;
    const integer = typeof a === 'bigint' ? a : b;
    const floating = typeof a === 'number' ? a : b;
    return typeof floating === 'number' && Number.isInteger(floating) && BigInt(floating) === integer;
  }
  return left === right;
}
function hashable(value: unknown, destination: 'dict key' | 'set element', step: () => void,
  outer = value instanceof SqlTuple ? 'tuple' : undefined): void {
  step();
  if (value instanceof SqlTuple) { value.forEach(item => hashable(item, destination, step, outer)); return; }
  if (value !== null && typeof value === 'object') {
    const type = Array.isArray(value) ? 'list' : value instanceof Set ? 'set' : 'dict';
    throw new PythonException('TypeError', `cannot use '${outer ?? type}' as a ${destination} (unhashable type: '${type}')`);
  }
}

function convertLiteral(node: unknown, step: () => void): unknown {
  step();
  if (!(node instanceof ParsedContainer)) return node;
  if (node.kind === 'dict') {
    const unique: [unknown, unknown][] = [];
    for (const [keyNode, valueNode] of node.entries) {
      const key = convertLiteral(keyNode, step);
      if (key === nonLiteral) return nonLiteral;
      const value = convertLiteral(valueNode, step);
      if (value === nonLiteral) return nonLiteral;
      hashable(key, 'dict key', step);
      const existing = unique.find(entry => pythonEqual(entry[0], key, step));
      if (existing) existing[1] = value; else unique.push([key, value]);
    }
    if (unique.every(([key]) => {
      if (typeof key !== 'string') return false;
      const index = Number(key);
      // JS records sort canonical array-index keys ahead of insertion order.
      // Retain Python dictionary order with the existing Map representation.
      return !(Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key);
    })) {
      const dict: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [key, value] of unique) Object.defineProperty(dict, key as string, { value, enumerable: true, writable: true, configurable: true });
      return dict;
    }
    return new Map(unique);
  }
  const values: unknown[] = [];
  for (const item of node.items) {
    const value = convertLiteral(item, step);
    if (value === nonLiteral) return nonLiteral;
    if (node.kind === 'set') {
      hashable(value, 'set element', step);
      if (!values.some(existing => pythonEqual(existing, value, step))) values.push(value);
    } else values.push(value);
  }
  if (node.kind === 'set') return new Set(values);
  if (node.kind === 'tuple') { const tuple = new SqlTuple(); tuple.push(...values); return Object.freeze(tuple); }
  return values;
}

/** Parse a bounded expression grammar without executing names, calls or operators.
 * Unsupported syntax stays a blocker, rather than being incorrectly called ValueError.
 */
function literal(source: string, step: () => void): unknown {
  let position = 0;
  const space = (): void => {
    while (position < source.length) {
      if (' \t\r\n\f'.includes(source[position]!)) { position++; continue; }
      if (source[position] === '#') { while (position < source.length && source[position] !== '\n') position++; continue; }
      break;
    }
  };
  const identifier = (): string => {
    const start = position;
    if (!'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'.includes(source[position] ?? '\0')) return '';
    position++;
    while ('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'.includes(source[position] ?? '\0')) position++;
    return source.slice(start, position);
  };
  const atom = (depth: number): unknown => {
    step();
    if (depth > 100) blocked();
    space(); const char = source[position];
    if (char === '[' || char === '{' || char === '(') {
      position++; const end = char === '[' ? ']' : char === '{' ? '}' : ')';
      const items: unknown[] = [], entries: [unknown, unknown][] = [];
      let dictionary = false, comma = false;
      space();
      if (source[position] === end) { position++; return new ParsedContainer(char === '[' ? 'list' : char === '(' ? 'tuple' : 'dict'); }
      while (position < source.length) {
        const item = expression(depth + 1); space();
        if (char === '{' && source[position] === ':') {
          if (items.length) blocked();
          dictionary = true; position++; entries.push([item, expression(depth + 1)]);
        } else { if (dictionary) blocked(); items.push(item); }
        space();
        if (source[position] === end) { position++; break; }
        if (source[position++] !== ',') blocked();
        comma = true; space();
        if (source[position] === end) { position++; break; }
        if (position === source.length) blocked();
      }
      if (source[position - 1] !== end) blocked();
      if (char === '[') return new ParsedContainer('list', items);
      if (char === '(') {
        if (!comma && items.length === 1) return items[0];
        return new ParsedContainer('tuple', items);
      }
      return new ParsedContainer(dictionary ? 'dict' : 'set', items, entries);
    }
    const stringStart = (): boolean => "'\"".includes(source[position] ?? '\0') ||
      ('rRuU'.includes(source[position] ?? '\0') && "'\"".includes(source[position + 1] ?? '\0'));
    if (stringStart()) {
      let value = '';
      do {
        step();
        const start = position;
        if ('rRuU'.includes(source[position]!)) position++;
        const quote = source[position]!;
        const delimiter = source.slice(position, position + 3) === quote.repeat(3) ? quote.repeat(3) : quote;
        position += delimiter.length; let closed = false;
        while (position < source.length) {
          if (source[position] === '\\') { position += 2; continue; }
          if (source.startsWith(delimiter, position)) { position += delimiter.length; closed = true; break; }
          position++;
        }
        if (!closed) blocked();
        value += quoted(source.slice(start, position));
        const end = position;
        space();
        // Newlines join literal tokens only inside a bracketed expression.
        // Top-level multiline SyntaxError diagnostics remain unqualified.
        if (depth === 0 && stringStart() && (source.slice(end, position).includes('\n') || source.slice(end, position).includes('\r'))) blocked();
      } while (stringStart());
      return value;
    }
    const start = position;
    const name = identifier();
    if (name) {
      if (name === 'True') return true;
      if (name === 'False') return false;
      if (name === 'None') return null;
      if (name === 'set') { space(); if (source.slice(position, position + 2) === '()') { position += 2; return new Set(); } }
      if (['if', 'async', 'await'].includes(name)) syntax('invalid syntax');
      if ('if else for lambda yield return pass break continue class def import from as with try except finally raise del assert global nonlocal await async not and or in is'.split(' ').includes(name)) blocked();
      return nonLiteral;
    }
    if (!'0123456789+-.'.includes(source[position] ?? '\0')) blocked();
    if (source[position] === '+' || source[position] === '-') { position++; space(); }
    while (position < source.length && '0123456789abcdefABCDEFxXoObB_.'.includes(source[position]!)) {
      const current = source[position++]!;
      if ((current === 'e' || current === 'E') && '+-'.includes(source[position] ?? '\0')) position++;
    }
    return numeric(source.slice(start, position).split(' ').join('').split('\t').join(''));
  };
  const expression = (depth: number): unknown => {
    let result = atom(depth); space();
    while (position < source.length) {
      step();
      if (source[position] === '(') {
        position++; space();
        if (source[position] !== ')') {
          expression(depth + 1); space();
          while (source[position] === ',') { position++; space(); if (source[position] === ')') break; expression(depth + 1); space(); }
        }
        if (source[position++] !== ')') blocked();
        result = nonLiteral; space(); continue;
      }
      if (source[position] === '.' && 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'.includes(source[position + 1] ?? '\0')) {
        position++; if (!identifier()) blocked(); result = nonLiteral; space(); continue;
      }
      const start = position;
      let operator = '';
      if ('+-*/%|&^'.includes(source[position]!)) {
        operator = source[position++]!;
        if ((operator === '*' || operator === '/') && source[position] === operator) position++;
      } else {
        const name = identifier();
        if (['and', 'or', 'in', 'is'].includes(name)) operator = name;
        else position = start;
      }
      if (!operator) break;
      space(); if (position === source.length) syntax('invalid syntax');
      atom(depth + 1); result = nonLiteral; space();
    }
    return result;
  };
  const result = expression(0); space();
  if (source[position] === ',') {
    const items = [result];
    while (source[position] === ',') { position++; space(); if (position === source.length) break; items.push(expression(0)); space(); }
    if (position !== source.length) blocked();
    return new ParsedContainer('tuple', items);
  }
  if (position !== source.length) {
    if (source[position] === ':') syntax('invalid syntax');
    blocked();
  }
  return result;
}

/** Python literal_eval semantics for qualified literals and ValueError expressions.
 * Nested dictionaries preserve Python insertion order; the top-level public
 * option-name record retains JavaScript property enumeration semantics.
 */
export function sqlOptions(pairs: readonly (readonly [string, unknown])[], step?: () => void): Readonly<Record<string, unknown>> {
  let work = 0;
  const consume = step ?? (() => { if (++work > 100_000) throw new CsvkitWorkBudgetError(); });
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, raw] of pairs) {
    consume();
    let value = raw;
    if (typeof raw === 'string') {
      // Charge linear token scanning in blocks, plus each parsed node/comparison.
      // This admits cancellation and limits large single tokens without charging
      // every character as a separate runtime operation.
      for (let offset = 0; offset < raw.length; offset += 256) consume();
      syntaxProfile(raw);
      const text = raw.trim();
      let start = 0, end = raw.length;
      while (start < end && ' \t\r\n\f'.includes(raw[start]!)) start++;
      while (end > start && ' \t\r\n\f'.includes(raw[end - 1]!)) end--;
      if (text !== raw.slice(start, end)) blocked();
      try {
        const parsed = convertLiteral(literal(text, consume), consume); value = parsed === nonLiteral ? raw : parsed;
      } catch (failure) {
        if (failure instanceof PythonException && failure.exceptionClass === 'SyntaxError' && (raw.includes('\n') || raw.includes('\r'))) blocked();
        throw failure;
      }
    }
    Object.defineProperty(output, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return Object.freeze(output);
}
