/*! YAML scalar folding semantics adapted from yaml 2.9.0.
 * Copyright Eemeli Aro <eemeli@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 */
import {readJsonNumber} from "./json-number.js";
import type {BackedText, TextRange} from "./backed-text.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";

/** Syntax failures may make frontmatter ordinary Markdown. Storage and execution
 * failures must keep their original identity and must never take that fallback. */
export class RetainedYamlSyntaxError extends Error {
  constructor(readonly offset: number) {super(`Invalid YAML scalar at ${offset}`);}
}

const escapes: Readonly<Record<string, string>> = {
  "0": "\0", a: "\x07", b: "\b", e: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
  N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029", " ": " ", '"': '"', "/": "/", "\\": "\\", "\t": "\t"
};
const horizontal = (char: string) => char === " " || char === "\t";

/** Decode a lexer-selected plain or quoted token. Input spans and decoded text
 * stay backed; only a fixed output window and scalar cursor remain resident.
 * Schema resolution (numbers, booleans, tags) belongs to the document composer. */
export async function decodeRetainedYamlScalar(source: RetainedSourceText, token: SourceRange, output: BackedText,
  cooperate: (units?: number) => Promise<void>): Promise<TextRange> {
  const quote = await source.unit(token.start), quoted = quote === "'" || quote === '"';
  if (quoted && (token.end - token.start < 2 || await source.unit(token.end - 1) !== quote)) throw new RetainedYamlSyntaxError(token.end);
  const range = {start: token.start + (quoted ? 1 : 0), end: token.end - (quoted ? 1 : 0)};
  async function* folded(): AsyncGenerator<string> {
    let start = range.start, first = true, separator = "";
    for (;;) {
      await cooperate();
      const newline = await source.find({start, end: range.end}, "\n");
      let end = newline < 0 ? range.end : newline;
      if (!first) while (start < end && horizontal(await source.unit(start))) {start++; if (start % 256 === 0) await cooperate(256);}
      if (newline >= 0) {
        if (await source.unit(end - 1) === "\r") end--;
        while (end > start && horizontal(await source.unit(end - 1))) {end--; if (end % 256 === 0) await cooperate(256);}
      }
      if (!first && start === end && newline >= 0) {
        if (separator === "\n") yield "\n"; else separator = "\n";
      } else {
        if (separator) yield separator;
        yield* source.chunks({start, end}); separator = " ";
      }
      if (newline < 0) return;
      first = false; start = newline + 1;
    }
  }
  async function* decoded(): AsyncGenerator<string> {
    let buffer = "";
    if (quote !== '"') {
      let apostrophe = false;
      for await (const chunk of folded()) for (const char of chunk) {
        if (quote === "'" && char === "'") {
          if (apostrophe) {buffer += "'"; apostrophe = false;} else apostrophe = true;
        } else {
          if (apostrophe) {buffer += "'"; apostrophe = false;}
          buffer += char;
        }
        if (buffer.length >= 4096) {yield buffer; buffer = ""; await cooperate(4096);}
      }
      if (apostrophe) buffer += "'";
    } else {
      let cursor = range.start;
      while (cursor < range.end) {
        if (cursor % 256 === 0) await cooperate(256);
        const char = await source.unit(cursor++);
        if (char === "\\") {
          const escape = await source.unit(cursor++);
          if (Object.hasOwn(escapes, escape)) buffer += escapes[escape];
          else if (escape === "\n" || escape === "\r" && await source.unit(cursor) === "\n") {
            if (escape === "\r") cursor++;
            while (cursor < range.end && horizontal(await source.unit(cursor))) {cursor++; if (cursor % 256 === 0) await cooperate(256);}
          } else if (escape === "x" || escape === "u" || escape === "U") {
            const count = escape === "x" ? 2 : escape === "u" ? 4 : 8;
            let code = 0;
            for (let index = 0; index < count; index++) {
              if (cursor >= range.end) throw new RetainedYamlSyntaxError(cursor);
              const digit = await source.unit(cursor++), lower = digit.toLowerCase();
              const value = digit >= "0" && digit <= "9" ? digit.charCodeAt(0) - 48 : lower >= "a" && lower <= "f" ? lower.charCodeAt(0) - 87 : -1;
              if (value < 0) throw new RetainedYamlSyntaxError(cursor - 1);
              code = code * 16 + value;
            }
            if (code > 0x10ffff) throw new RetainedYamlSyntaxError(cursor - count);
            buffer += String.fromCodePoint(code);
          } else throw new RetainedYamlSyntaxError(cursor - 1);
        } else if (char === "\n" || char === "\r" && await source.unit(cursor) === "\n") {
          if (char === "\r") cursor++;
          let breaks = 0;
          while (cursor < range.end) {
            const next = await source.unit(cursor);
            if (horizontal(next)) cursor++;
            else if (next === "\n") {cursor++; breaks++;}
            else if (next === "\r" && await source.unit(cursor + 1) === "\n") cursor++;
            else break;
            if (cursor % 256 === 0) await cooperate(256);
          }
          if (!breaks) buffer += " ";
          else for (let index = 0; index < breaks; index++) {
            buffer += "\n";
            if (buffer.length >= 4096) {yield buffer; buffer = ""; await cooperate(4096);}
          }
        } else if (horizontal(char)) {
          const start = cursor - 1;
          while (cursor < range.end && horizontal(await source.unit(cursor))) {cursor++; if (cursor % 256 === 0) await cooperate(256);}
          const next = await source.unit(cursor);
          if (next !== "\n" && !(next === "\r" && await source.unit(cursor + 1) === "\n")) {
            for await (const chunk of source.chunks({start, end: cursor})) {
              if (buffer) {yield buffer; buffer = "";}
              yield chunk;
            }
          }
        } else buffer += char;
        if (buffer.length >= 4096) {yield buffer; buffer = "";}
      }
    }
    if (buffer) yield buffer;
  }
  return output.from(decoded());
}

/** Decode a selected block scalar, including its header. Replay the source to
 * discover indentation and chomping boundaries without retaining a line vector.
 * parentIndent is the indentation of its containing YAML collection. */
export async function decodeRetainedYamlBlock(source: RetainedSourceText, token: SourceRange, parentIndent: number,
  output: BackedText, cooperate: (units?: number) => Promise<void>): Promise<TextRange> {
  const mode = await source.unit(token.start);
  if (mode !== "|" && mode !== ">") throw new RetainedYamlSyntaxError(token.start);
  const newline = await source.find(token, "\n"), headerEnd = newline < 0 ? token.end : newline;
  let explicit = 0, chomp = "", cursor = token.start + 1;
  while (cursor < headerEnd) {
    const char = await source.unit(cursor);
    if (horizontal(char) || char === "\r" && cursor + 1 === headerEnd) break;
    if ((char === "+" || char === "-") && !chomp) chomp = char;
    else if (char >= "1" && char <= "9" && !explicit) explicit = Number(char);
    else throw new RetainedYamlSyntaxError(cursor);
    cursor++;
  }
  let separated = false;
  while (cursor < headerEnd) {
    const char = await source.unit(cursor++);
    if (horizontal(char)) separated = true;
    else if (char === "#" && separated) break;
    else if (char !== "\r" || cursor !== headerEnd) throw new RetainedYamlSyntaxError(cursor - 1);
    if (cursor % 256 === 0) await cooperate(256);
  }
  const begin = newline < 0 ? token.end : newline + 1;
  async function* lines() {
    if (begin === token.end) return;
    let start = begin, index = 0;
    for (;;) {
      await cooperate();
      const newline = await source.find({start, end: token.end}, "\n");
      let end = newline < 0 ? token.end : newline, content = start;
      if (await source.unit(end - 1) === "\r") end--;
      while (content < end && await source.unit(content) === " ") {content++; if (content % 256 === 0) await cooperate(256);}
      yield {index: index++, start, end, content, indent: content - start, empty: content === end};
      if (newline < 0) return;
      start = newline + 1;
    }
  }
  let count = 0, first = -1, chompStart = 0, trim = parentIndent + explicit;
  for await (const line of lines()) {
    count++;
    if (line.empty) {if (first < 0 && !explicit) trim = Math.max(trim, line.indent);}
    else {
      if (line.indent < trim) throw new RetainedYamlSyntaxError(line.content);
      if (first < 0) {
        first = line.index;
        if (!explicit) trim = line.indent;
        if (!trim) throw new RetainedYamlSyntaxError(line.start);
      }
      chompStart = line.index + 1;
    }
  }
  // More-indented trailing whitespace is content, not a chomp-only empty line.
  if (first >= 0) for await (const line of lines()) if (line.index >= chompStart && line.indent > trim) chompStart = line.index + 1;
  async function* decoded(): AsyncGenerator<string> {
    if (first < 0) {
      if (chomp === "+" && count) for (let left = Math.max(1, count - 1); left > 0; left -= 4096) {await cooperate(); yield "\n".repeat(Math.min(left, 4096));}
      return;
    }
    let separator = "", more = false, last = "";
    function* literal(value: string) {if (value) {last = value[value.length - 1]!; yield value;}}
    async function* span(start: number, end: number) {for await (const chunk of source.chunks({start, end})) {last = chunk[chunk.length - 1]!; yield chunk;}}
    for await (const line of lines()) {
      const start = Math.min(line.end, line.start + trim);
      if (line.index < first) {yield* span(start, line.end); yield* literal("\n");}
      else if (line.index < chompStart) {
        if (mode === "|") {yield* literal(separator); yield* span(start, line.end); separator = "\n";}
        else if (line.indent > trim || await source.unit(line.content) === "\t") {
          if (separator === " ") separator = "\n";
          else if (!more && separator === "\n") separator = "\n\n";
          yield* literal(separator); yield* span(start, line.end); separator = "\n"; more = true;
        } else if (line.empty) {
          if (separator === "\n") yield* literal("\n"); else separator = "\n";
        } else {yield* literal(separator); yield* span(line.content, line.end); separator = " "; more = false;}
      } else if (chomp === "+") {yield* literal("\n"); yield* span(start, line.end);}
    }
    if (!chomp || chomp === "+" && last !== "\n") yield "\n";
  }
  return output.from(decoded());
}

export type RetainedYamlScalar = {kind: "string"; text: TextRange} | {kind: "number"; value: number} | {kind: "boolean"; value: boolean} | {kind: "null"; value: null};

/** YAML 1.2 core schema. Decimal rounding uses the existing bounded binary64
 * reader; radix integers retain at most 1028 bits, even for huge input tokens. */
export async function resolveRetainedYamlScalar(text: BackedText, range: TextRange,
  cooperate: (units?: number) => Promise<void>): Promise<RetainedYamlScalar> {
  if (range.units <= 5) {
    let word = ""; for await (const chunk of text.chunks(range)) word += chunk;
    if (["", "~", "null", "Null", "NULL"].includes(word)) return {kind: "null", value: null};
    if (["true", "True", "TRUE", "false", "False", "FALSE"].includes(word)) return {kind: "boolean", value: word[0] === "t" || word[0] === "T"};
    if ([".nan", ".NaN", ".NAN"].includes(word)) return {kind: "number", value: NaN};
    const magnitude = word[0] === "+" || word[0] === "-" ? word.slice(1) : word;
    if ([".inf", ".Inf", ".INF"].includes(magnitude)) return {kind: "number", value: word[0] === "-" ? -Infinity : Infinity};
  }
  let position = 0, first = "", radix = 0, integer = 0n, overflow = false;
  let before = 0, after = 0, exponentDigits = 0, dot = false, exponent = false, valid = true, exponentSign = false;
  for await (const chunk of text.chunks(range)) {
    for (const char of chunk) {
      const index = position++;
      if (!index) {first = char; if (char === "+" || char === "-") continue;}
      if (index === 1 && first === "0" && (char === "x" || char === "o")) {radix = char === "x" ? 16 : 8; continue;}
      if (radix) {
        const lower = char.toLowerCase();
        const digit = char >= "0" && char <= "9" ? char.charCodeAt(0) - 48 : lower >= "a" && lower <= "f" ? lower.charCodeAt(0) - 87 : -1;
        if (digit < 0 || digit >= radix) valid = false;
        else if (!overflow) {integer = integer * BigInt(radix) + BigInt(digit); overflow = integer >= 1n << 1024n;}
      } else if (char >= "0" && char <= "9") {
        if (exponent) exponentDigits++; else if (dot) after++; else before++;
      } else if (char === "." && !dot && !exponent) dot = true;
      else if ((char === "e" || char === "E") && !exponent && before + after > 0) {exponent = true; exponentSign = true;}
      else if ((char === "+" || char === "-") && exponentSign) exponentSign = false;
      else valid = false;
      if (char !== "e" && char !== "E") exponentSign = false;
    }
    await cooperate(chunk.length);
  }
  if (!valid || (radix ? position <= 2 : before + after === 0 || exponent && exponentDigits === 0)) return {kind: "string", text: range};
  if (radix) return {kind: "number", value: overflow ? Infinity : Number(integer)};
  return {kind: "number", value: await readJsonNumber(text.chunks(range), units => cooperate(units), false)};
}
