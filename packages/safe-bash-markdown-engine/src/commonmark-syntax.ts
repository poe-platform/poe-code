import { namedEntities } from "./entity-data.js";
import { caseFoldExceptions } from "./commonmark-case-fold.js";
import type { Attr } from "./ast-types.js";
import type { AdapterContext } from "./types.js";

export function asciiPunctuation(char: string | undefined): boolean {
  if (char === undefined) return false;
  const n = char.charCodeAt(0);
  return n >= 33 && n <= 47 || n >= 58 && n <= 64 || n >= 91 && n <= 96 || n >= 123 && n <= 126;
}
export function whitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}
export function letter(char: string | undefined): boolean {
  return char !== undefined && (char >= "a" && char <= "z" || char >= "A" && char <= "Z");
}
export function digit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}
export function normalizeLabel(label: string, context: AdapterContext): string {
  const result: string[] = [];
  let gap = false;
  for (const char of label) {
    context.checkpoint();
    if (char === " " || char === "\t" || char === "\n" || char === "\r") gap = result.length > 0;
    else {
      if (gap) result.push(" ");
      result.push(caseFoldExceptions.get(char.codePointAt(0)!) ?? char.toLowerCase());
      gap = false;
    }
  }
  context.charge("retainedBytes", label.length * 6);
  return result.join("");
}

/** Only semicolon-terminated references; bounded before calling the entity codec. */
export function entity(text: string, start: number, context: AdapterContext): { value: string; end: number } | undefined {
  if (text[start] !== "&") return;
  let i = start + 1;
  if (text[i] === "#") {
    i++;
    const hex = text[i] === "x" || text[i] === "X";
    if (hex) i++;
    const begin = i;
    while (i - begin <= (hex ? 6 : 7) && (digit(text[i]) || hex && text[i] !== undefined && "abcdefABCDEF".includes(text[i]!))) i++;
    if (i === begin || i - begin > (hex ? 6 : 7) || text[i] !== ";") return;
    const n = Number.parseInt(text.slice(begin, i), hex ? 16 : 10);
    return { value: context.decodeEntity(n === 0 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff ? 0xfffd : n), end: i + 1 };
  }
  while (i - start <= 32 && (letter(text[i]) || digit(text[i]))) i++;
  if (text[i] !== ";" || i === start + 1 || i - start > 32) return;
  const source = text.slice(start, i + 1);
  const value = namedEntities[source.slice(1)] ?? source;
  if (value === source) return;
  context.charge("entities", 1);
  context.charge("text", value.length);
  context.charge("entityBytes", new TextEncoder().encode(value).length);
  context.charge("retainedBytes", value.length * 2);
  return { value, end: i + 1 };
}
export function decodeSyntax(text: string, context: AdapterContext): string {
  context.charge("retainedBytes", text.length * 4);
  const parts: string[] = [];
  for (let i = 0; i < text.length;) {
    context.checkpoint();
    if (text[i] === "\\" && asciiPunctuation(text[i + 1])) { parts.push(text[i + 1]!); i += 2; continue; }
    const decoded = entity(text, i, context);
    if (decoded) { parts.push(decoded.value); i = decoded.end; }
    else parts.push(text[i++]!);
  }
  return parts.join("");
}
/** Preserve existing percent escapes and URI punctuation; encode Unicode and spaces. */
export function normalizeUri(text: string, context: AdapterContext): string {
  context.charge("retainedBytes", text.length * 24);
  const parts: string[] = [];
  for (const char of text) {
    context.checkpoint();
    parts.push(letter(char) || digit(char) || ";/?:@&=+$,-_.!~*'()#%".includes(char) ? char : encodeURIComponent(char));
  }
  return parts.join("");
}

export function readLabel(text: string, start: number, context: AdapterContext): { label: string; end: number } | undefined {
  if (text[start] !== "[") return;
  let i = start + 1;
  let count = 0;
  while (i < text.length) {
    context.checkpoint();
    if (text[i] === "]") return { label: text.slice(start + 1, i), end: i + 1 };
    if (text[i] === "[") return;
    if (text[i] === "\\" && asciiPunctuation(text[i + 1])) { i += 2; count += 2; }
    else { i += text.codePointAt(i)! > 0xffff ? 2 : 1; count++; }
    if (count > 999) return;
  }
}

export function readDestination(text: string, start: number, context: AdapterContext): { value: string; end: number } | undefined {
  let i = start;
  if (text[i] === "<") {
    i++;
    const begin = i;
    while (i < text.length && text[i] !== ">") {
      context.checkpoint();
      if (text[i] === "<" || text[i] === "\n" || text[i] === "\r") return;
      if (text[i] === "\\" && asciiPunctuation(text[i + 1])) i++;
      i++;
    }
    if (text[i] !== ">") return;
    return { value: text.slice(begin, i), end: i + 1 };
  }
  let depth = 0;
  while (i < text.length && !whitespace(text[i])) {
    context.checkpoint();
    const char = text[i]!;
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return;
    if (char === "\\" && asciiPunctuation(text[i + 1])) { i += 2; continue; }
    if (char === "(") context.bound("depth", ++depth);
    if (char === ")") { if (depth === 0) break; depth--; }
    i++;
  }
  if (depth) return;
  return { value: text.slice(start, i), end: i };
}
export function readTitle(text: string, start: number, context: AdapterContext): { value: string; end: number } | undefined {
  const opening = text[start];
  if (opening !== "'" && opening !== '"' && opening !== "(") return;
  const closing = opening === "(" ? ")" : opening;
  let i = start + 1;
  while (i < text.length) {
    context.checkpoint();
    if (text[i] === closing) return { value: text.slice(start + 1, i), end: i + 1 };
    if (opening === "(" && text[i] === "(") return;
    if (text[i] === "\\" && asciiPunctuation(text[i + 1])) i++;
    i++;
  }
}

/** Parse a canonical Roman numeral, bounded to the conventional 1–3999 range. */
export function romanListNumber(label: string): number | undefined {
  if (!label || label.length > 15 || label !== label.toLowerCase() && label !== label.toUpperCase()) return;
  const lower = label.toLowerCase();
  const values: Readonly<Record<string, number>> = {i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000};
  let number = 0;
  for (let i = 0; i < lower.length; i++) {
    const value = values[lower[i]!];
    if (value === undefined) return;
    number += value < (values[lower[i + 1]!] ?? 0) ? -value : value;
  }
  if (number < 1 || number > 3999) return;
  let canonical = "", remaining = number;
  for (const [value, numeral] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) {
    while (remaining >= value) {canonical += numeral; remaining -= value;}
  }
  return canonical === lower ? number : undefined;
}

/** Attributes on a Pandoc fenced-div opener, including its bare-class form. */
export function fencedDivAttributes(text: string, context: AdapterContext): Attr | undefined {
  text = text.trim();
  while (text.endsWith(":")) text = text.slice(0, -1);
  text = text.trimEnd();
  if (!text) return;
  const attr: [string, string[], [string, string][]] = ["", [], []];
  if (!text.startsWith("{")) {
    for (const char of text) {context.checkpoint(); if (whitespace(char)) return;}
    attr[1].push(text); return attr;
  }
  if (!text.endsWith("}")) return;
  let at = 1;
  const end = text.length - 1;
  while (at < end) {
    context.checkpoint();
    while (at < end && whitespace(text[at])) at++;
    if (at === end) break;
    const start = at;
    while (at < end && !whitespace(text[at]) && text[at] !== "=") at++;
    const name = text.slice(start, at);
    if (!name) return;
    if (text[at] === "=") {
      at++;
      const quote = text[at] === '"' || text[at] === "'" ? text[at++] : undefined;
      let value = "";
      while (at < end && (quote ? text[at] !== quote : !whitespace(text[at]))) {
        context.checkpoint();
        if (text[at] === "\\" && at + 1 < end && (text[at + 1] === quote || text[at + 1] === "\\")) at++;
        value += text[at++];
      }
      if (quote && text[at++] !== quote) return;
      attr[2].push([name, value]);
    } else if (name.startsWith("#") && name.length > 1) attr[0] = name.slice(1);
    else if (name.startsWith(".") && name.length > 1) attr[1].push(name.slice(1));
    else return;
    if (at < end && !whitespace(text[at])) return;
  }
  return attr;
}
