import { PandocError } from "./errors.js";
import type { AdapterContext, DiagnosticCode } from "./types.js";
export interface RstLine {readonly text: string; readonly original?: string; readonly line: number; readonly column: number; readonly source?: string; readonly base?: string}
export const rstAttr = (): [string, string[], [string, string][]] => ["", [], []];
export function rstError(context: AdapterContext, at: RstLine, message: string, code: DiagnosticCode = "E_PARSE"): never {
  throw new PandocError(code, context.operation ?? "read", message, "rst", `${at.source ? `${at.source}:` : ""}${at.line}:${at.column}`);
}
export function rstLines(text: string, base?: string, source?: string, context?: AdapterContext): RstLine[] {
  return text.split("\n").map((original, i) => {
    let text = original;
    if (original.includes("\t")) {
      text = "";
      for (const c of original) {context?.checkpoint(); const value = c === "\t" ? " ".repeat(8 - text.length % 8) : c; context?.charge("retainedBytes", value.length * 2); text += value;}
    }
    return {text, ...(text === original ? {} : {original}), line: i + 1, column: 1, ...(base === undefined ? {} : {base}), ...(source === undefined ? {} : {source})};
  });
}
export function indent(text: string): number {let i = 0; while (text[i] === " ") i++; return i;}
export function sliceLine(line: RstLine, start: number): RstLine {return {...line, text: line.text.slice(start), column: line.column + start};}
export function dedent(lines: readonly RstLine[]): RstLine[] {
  const nonempty = lines.filter(l => l.text.trim());
  const n = nonempty.length ? Math.min(...nonempty.map(l => indent(l.text))) : 0;
  return lines.map(l => sliceLine(l, Math.min(n, l.text.length)));
}
export function trimLines(lines: readonly RstLine[]): RstLine[] {
  let a = 0, b = lines.length;
  while (a < b && !lines[a]!.text.trim()) a++;
  while (b > a && !lines[b - 1]!.text.trim()) b--;
  return lines.slice(a, b);
}
export function nameOf(text: string): string {return text.trim().toLowerCase().split(" ").filter(Boolean).join(" ");}
export function identifier(text: string): string {return nameOf(text).split(" ").join("-");}
export function adornment(text: string): string | undefined {
  const t = text.trimEnd();
  return t.length > 0 && "=!\"#$%&'()*+,-./:;<>?@[\\]^_`{|}~".includes(t[0]!) && [...t].every(c => c === t[0]) ? t[0] : undefined;
}
export interface ListMarker {readonly width: number; readonly bullet: boolean; readonly start: number; readonly style: "Decimal" | "LowerAlpha" | "UpperAlpha" | "LowerRoman" | "UpperRoman" | "DefaultStyle"; readonly delim: "Period" | "OneParen" | "TwoParens"}
function roman(value: string): number {
  const values: Record<string, number> = {i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000};
  let n = 0;
  for (let i = 0; i < value.length; i++) {const v = values[value[i]!] ?? 0; if (!v) return 0; n += v < (values[value[i + 1]!] ?? 0) ? -v : v;}
  // Reject noncanonical Roman numeral strings.
  let rest = n, canonical = "";
  for (const [v, s] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (rest >= v && canonical.length < 32) {canonical += s; rest -= v;}
  return canonical === value ? n : 0;
}
export function listMarker(text: string): ListMarker | undefined {
  if ("*+-•‣⁃".includes(text[0] ?? "") && text[1] === " ") {let width = 2; while (text[width] === " ") width++; return {width, bullet: true, start: 1, style: "DefaultStyle", delim: "Period"};}
  const two = text.startsWith("(");
  let i = two ? 1 : 0;
  while (i < text.length && text[i] !== "." && text[i] !== ")" && text[i] !== " ") i++;
  if (i > 32 || text[i + 1] !== " " || ![".", ")"].includes(text[i] ?? "") || two && text[i] !== ")") return undefined;
  const token = text.slice(two ? 1 : 0, i);
  let start: number, style: ListMarker["style"];
  if (token === "#") {start = 1; style = "DefaultStyle";}
  else if (token && [...token].every(c => c >= "0" && c <= "9")) {start = Number(token); style = "Decimal";}
  else if (roman(token.toLowerCase()) && (token === token.toLowerCase() || token === token.toUpperCase())) {start = roman(token.toLowerCase()); style = token === token.toLowerCase() ? "LowerRoman" : "UpperRoman";}
  else if (token.length === 1 && token.toLowerCase() >= "a" && token.toLowerCase() <= "z") {start = token.toLowerCase().charCodeAt(0) - 96; style = token === token.toLowerCase() ? "LowerAlpha" : "UpperAlpha";}
  else return undefined;
  if (!Number.isSafeInteger(start)) return undefined;
  let width = i + 2;
  while (text[width] === " ") width++;
  return {width, bullet: false, start, style, delim: two ? "TwoParens" : text[i] === ")" ? "OneParen" : "Period"};
}
export function field(text: string): {name: string; width: number} | undefined {
  if (!text.startsWith(":")) return undefined;
  const end = text.indexOf(":", 1);
  if (end <= 1 || end + 1 < text.length && text[end + 1] !== " ") return undefined;
  return {name: text.slice(1, end), width: Math.min(text.length, end + 2)};
}
export function simpleColumns(text: string): readonly (readonly [number, number])[] | undefined {
  const out: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    while (text[i] === " ") i++;
    if (i === text.length) break;
    const start = i;
    while (text[i] === "=") i++;
    if (i - start < 2 || i < text.length && text[i] !== " ") return undefined;
    out.push([start, i]);
  }
  return out.length > 1 ? out : undefined;
}
