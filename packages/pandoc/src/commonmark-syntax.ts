import { decodeHTMLStrict } from "entities";
import { caseFoldExceptions } from "./commonmark-case-fold.js";
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
  const value = decodeHTMLStrict(source);
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
