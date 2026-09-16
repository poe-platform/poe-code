import type { AdapterContext } from "./types.js";
import { letter, digit } from "./commonmark-syntax.js";
import { unicodeWhitespace } from "./commonmark-characters.js";

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
