import type { Alignment } from "./ast-types.js";
import type { AdapterContext } from "./types.js";
import { letter, digit } from "./commonmark-syntax.js";
import { unicodeWhitespace } from "./commonmark-characters.js";

export function taskSymbol(prefix: string, allowBare: boolean): "☒" | "☐" | undefined {
  if (prefix[0] !== "[" || prefix[2] !== "]" || !(prefix[3] === " " || prefix.length === 3 && allowBare)) return;
  return prefix[1] === "x" || prefix[1] === "X" ? "☒" : prefix[1] === " " ? "☐" : undefined;
}

/** Pipe splitting precedes inline parsing, even inside code spans (GFM §4.10). */
export function pipeRow(text: string, context: AdapterContext): string[] | undefined {
  const cells: string[] = [];
  let value = "";
  let pipes = 0;
  for (let i = 0; i < text.length; i++) {
    context.checkpoint();
    if (text[i] === "\\" && text[i + 1] === "|") { value += "|"; i++; }
    else if (text[i] === "|") { cells.push(value.trim()); value = ""; pipes++; }
    else value += text[i];
  }
  if (!pipes) return;
  cells.push(value.trim());
  if (text.trimStart().startsWith("|")) cells.shift();
  if (text.trimEnd().endsWith("|") && cells[cells.length - 1] === "") cells.pop();
  context.charge("retainedBytes", text.length * 2 + cells.length * 32);
  return cells;
}

/** Dash runs define the fixed columns of a Pandoc simple table. */
export function simpleTableColumns(text: string, context: AdapterContext): {start: number; end: number}[] | undefined {
  context.checkpoint(text.length);
  const columns: {start: number; end: number}[] = [];
  let at = 0;
  while (at < text.length) {
    context.checkpoint();
    while (text[at] === " ") at++;
    if (at === text.length) break;
    const start = at;
    while (text[at] === "-") at++;
    if (at === start || (at < text.length && text[at] !== " ")) return;
    context.charge("retainedBytes", 32);
    columns.push({start, end: at});
  }
  return columns.length > 1 ? columns : undefined;
}

const disallowed = new Set(["title", "textarea", "style", "xmp", "iframe", "noembed", "noframes", "script", "plaintext"]);
/** GFM tagfilter is output filtering, not an HTML sanitizer. */
export function filterGfmHtml(text: string, context: AdapterContext): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    context.checkpoint();
    if (text[i] !== "<") { result += text[i]; continue; }
    let at = i + 1;
    if (text[at] === "/") at++;
    const begin = at;
    while (letter(text[at])) { context.checkpoint(); at++; }
    const boundary = text[at] === ">" || text[at] === "/" || text[at] === " " || text[at] === "\t" || text[at] === "\n" || text[at] === "\r";
    result += boundary && disallowed.has(text.slice(begin, at).toLowerCase()) ? "&lt;" : "<";
  }
  context.charge("retainedBytes", result.length * 2);
  return result;
}

export function bareAutolink(text: string, start: number, context: AdapterContext): { label: string; url: string; end: number } | undefined {
  const prev = start === 0 ? undefined : String.fromCodePoint(text.codePointAt(start - 1)!);
  const boundary = start === 0 || unicodeWhitespace(prev) || "*_~(".includes(prev ?? "");
  const scheme = boundary ? ["https://", "http://", "ftp://", "www."].find((prefix) => text.startsWith(prefix, start)) : undefined;
  const alnum = (c: string | undefined): boolean => letter(c) || digit(c);
  let end = start;
  if (scheme) {
    end += scheme.length;
    const domainStart = scheme === "www." ? start : end;
    while (end < text.length && !unicodeWhitespace(String.fromCodePoint(text.codePointAt(end)!)) && text[end] !== "<") { context.checkpoint(); end++; }
    let balance = 0;
    for (let i = start; i < end; i++) { context.checkpoint(); if (text[i] === "(") balance++; if (text[i] === ")") balance--; }
    for (;;) {
      const c = text[end - 1]!;
      if ("?!.,:*_~".includes(c)) { end--; continue; }
      if (c === ")" && balance < 0) { end--; balance++; continue; }
      if (c === ";") {
        let at = end - 2;
        while (alnum(text[at])) { context.checkpoint(); at--; }
        if (at < end - 2 && text[at] === "&") { end = at; continue; }
      }
      break;
    }
    let domainEnd = domainStart;
    while (domainEnd < end && !"/:?#".includes(text[domainEnd]!)) { context.checkpoint(); domainEnd++; }
    const segments = text.slice(domainStart, domainEnd).split(".");
    // Internationalized domains are accepted; the final two segments cannot contain underscores.
    if (segments.length < 2 || segments.some((s) => !s) || segments.slice(-2).some((s) => s.includes("_"))) return;
    const label = text.slice(start, end);
    return { label, url: scheme === "www." ? "http://" + label : label, end };
  }
  if (start > 0 && (alnum(prev) || ".-_+".includes(prev ?? ""))) return;
  while (alnum(text[end]) || text[end] !== undefined && ".-_+".includes(text[end]!)) { context.checkpoint(); end++; }
  if (end === start || text[end++] !== "@") return;
  const domainStart = end;
  while (alnum(text[end]) || text[end] !== undefined && ".-_".includes(text[end]!)) { context.checkpoint(); end++; }
  while (text[end - 1] === ".") end--;
  const domain = text.slice(domainStart, end);
  if (!domain.includes(".") || domain.endsWith("-") || domain.endsWith("_") || text[end] === "+") return;
  const label = text.slice(start, end);
  return { label, url: "mailto:" + label, end };
}

/** Multiline tables have a top border, fixed columns and blank-separated rows. */
export async function multilineTable(top: string, next: () => Promise<string | undefined>, context: AdapterContext) {
  const border = (text: string) => {
    if (text.trim().length < 3) return false;
    for (const char of text) {context.checkpoint(); if (char !== "-" && char !== " ") return false;}
    return true;
  };
  if (!border(top)) return;
  let columns = simpleTableColumns(top, context), header: string[] | undefined;
  let pending: string[] = [], alignments: Alignment[] = [];
  const rows: string[][] = [];
  const cells = (lines: string[]) => {
    context.charge("tableCells", columns!.length);
    context.charge("retainedBytes", columns!.length * 32 + lines.reduce((sum, line) => sum + line.length * 2, 0));
    return columns!.map((column, index) => lines.map(line => line.slice(index ? column.start : 0, columns![index + 1]?.start).trim()).filter(Boolean).join("\n"));
  };
  const alignment = (pending: string[]): Alignment[] => {
    return columns!.map((column, index) => {
      const parts = pending.map(line => line.slice(index ? column.start : 0, columns![index + 1]?.start));
      const left = parts.some(part => part.length > 0 && part[0] !== " ");
      const right = parts.some(part => part.trimEnd().length >= column.end - column.start);
      return left ? right ? "AlignDefault" : "AlignLeft" : right ? "AlignRight" : "AlignCenter";
    });
  };
  for (;;) {
    const line = await next();
    if (line === undefined) return;
    await context.cooperate(line.length);
    context.bound("text", line.length); context.charge("retainedBytes", line.length * 2 + 16);
    if (border(line)) {
      if (!header && !rows.length && pending.length) {
        const separator = simpleTableColumns(line, context);
        if (!separator) return;
        columns = separator;
        header = cells(pending);
        alignments = alignment(pending);
        pending = []; continue;
      }
      if (!columns) return;
      if (pending.length) rows.push(cells(pending));
      if (!rows.length) return;
      const last = columns.at(-1)!, gap = columns.length > 1 ? last.start - columns.at(-2)!.end : 0;
      const total = last.end + gap, denominator = Math.max(72, total);
      return {header: header ?? [], rows, alignments,
        widths: columns.map((column, index) => ((columns![index + 1]?.start ?? total) - column.start) / denominator)};
    }
    if (!line.trim()) {
      if (!columns) return;
      if (pending.length) {if (!header && !rows.length) alignments = alignment(pending); rows.push(cells(pending)); pending = [];}
    } else pending.push(line);
  }
}
