import { Pattern, simpleCaseFold, RustPatternError, type Match } from "safe-bash-regex-engine";
import type { MdqBudget } from "./budget.js";
import { MdqError } from "./options.js";
import { inline, node, type Inline, type Node, type Document } from "./document.js";

export function queryError(query: string, at: number, message: string, end?: number): never {
  const prefix = query.slice(0, at), row = prefix.split("\n").length;
  const begin = prefix.lastIndexOf("\n") + 1, column = [...query.slice(begin, at)].length;
  const last = query.indexOf("\n", at), line = query.slice(begin, last < 0 ? undefined : last);
  const gutter = " ".repeat(String(row).length + 1);
  const width = end === undefined ? undefined : [...query.slice(at, end)].length;
  const caret = width === undefined ? "^---" : width <= 1 ? "^" : "^" + "-".repeat(width - 2) + "^";
  throw new MdqError(`Syntax error in select specifier:\n${" ".repeat(String(row).length)}--> ${row}:${column + 1}\n${gutter}|\n${row} | ${line}\n${gutter}| ${" ".repeat(column)}${caret}\n${gutter}|\n${gutter}= ${message}\n`);
}
interface Replacement { start: number; end: number; value: string }
export interface Matcher { text: string; exactCase: boolean; start: boolean; end: boolean; pattern?: Pattern; replacement?: string; omitted?: boolean }
export interface Selector { kind: string; matcher: Matcher; second?: Matcher; min?: number; max?: number; task?: string; ordered?: boolean; variant?: string }
const any = (): Matcher => ({ text: "", exactCase: true, start: false, end: false, omitted: true });
export function parseQuery(query: string, budget: MdqBudget): Selector[] {
  let at = 0;
  const skip = (): void => { while (" \n\t\r".includes(query[at] ?? "\0")) at++; };
  function string(delimiter: string): Matcher {
    if (delimiter !== " ") skip(); const m = any();
    if (query[at] === "*") { at++; delete m.omitted; return m; }
    if (query[at] === "/" || query.startsWith("!s/", at)) {
      const replacement = query[at] === "!"; at += replacement ? 3 : 1; const begin = at;
      const segment = (): string => {
        let text = "";
        while (at < query.length) {
          if (query[at] === "/") { at++; return text; }
          if (query[at] === "\\" && query[at + 1] === "/") { text += "/"; at += 2; }
          else text += query[at++];
        }
        queryError(query, at + 1, "expected regex character");
      };
      const source = segment();
      try {
        if ((source.includes("\\P{") || source.includes("\\p{")) && !source.includes("}")) queryError(query, begin, "regex parse error: Unicode escape not closed", begin + 1);
        m.pattern = new Pattern(source, true, false, "rust");
      } catch (error) {
        if (error instanceof MdqError) throw error;
        if (error instanceof RustPatternError) {
          const span = replacement ? begin - 3 : begin - 1;
          if (error.compilation) queryError(query, span, "Error compiling regex: " + error.message, at);
          queryError(query, span + 1 + error.offset, "regex parse error: " + error.message, span + 2 + error.offset);
        }
        queryError(query, begin, "regex parse error: " + (error as Error).message, at - 1);
      }
      if (replacement) m.replacement = segment();
      delete m.omitted; return m;
    }
    if (query[at] === "^") { m.start = true; at++; skip(); }
    const quote = query[at];
    if (quote === "'" || quote === '"') {
      at++; let text = "";
      while (at < query.length && query[at] !== quote) {
        if (query[at] !== "\\") { text += query[at++]; continue; }
        at++; const escapeAt = at;
        const char = query[at++]!, escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"', "`": "'" };
        if (char === "u" && query[at] === "{") {
          const begin = ++at;
          while (query[at] && "0123456789abcdefABCDEF".includes(query[at]!)) at++;
          const raw = query.slice(begin, at);
          if (!raw) queryError(query, begin, "expected 1 - 6 hex characters");
          if (raw.length > 6 || query[at] !== "}") queryError(query, escapeAt, "expected \", ', `, \\, n, r, or t");
          const code = Number.parseInt(raw, 16);
          if (code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) queryError(query, begin, "invalid unicode sequence: " + raw, at);
          text += String.fromCodePoint(code); at++;
        } else if (escapes[char] !== undefined) text += escapes[char];
        else queryError(query, escapeAt, "expected \", ', `, \\, n, r, or t");
      }
      if (query[at] !== quote) queryError(query, at + 1, "expected character in quoted string");
      at++; m.text = text; delete m.omitted;
    } else if (query[at] && /^\p{L}$/u.test(String.fromCodePoint(query.codePointAt(at)!))) {
      const begin = at;
      while (at < query.length && query[at] !== delimiter && query[at] !== "$") at++;
      m.text = query.slice(begin, at).trimEnd(); m.exactCase = false; delete m.omitted;
    }
    if (delimiter !== " ") skip();
    if (query[at] === "$") { if (!m.start && m.omitted) queryError(query, at, 'expected end of input, "*", unquoted string, regex, quoted string, or "^"'); m.end = true; at++; }
    if (m.omitted && query[at] !== undefined && query[at] !== delimiter && !" \t\n\r".includes(query[at]!)) queryError(query, at, 'expected end of input, "*", unquoted string, regex, quoted string, or "^"');
    return m;
  }
  const result: Selector[] = [];
  while (at < query.length) {
    skip(); while (query[at] === "|") { at++; skip(); }
    if (at >= query.length) break;
    budget.checkpoint(); const begin = at;
    const invalid = (): never => queryError(query, begin, result.length ? "expected end of input or selector" : "expected valid query");
    const requireSpace = (section = false): void => {
      if (at < query.length && query[at] !== " ") queryError(query, at, section ? "expected end of input, space, or section options" : "expected end of input or space");
      skip();
    };
    let s: Selector;
    if (query[at] === "#") {
      at++; s = { kind: "section", matcher: any() };
      if (query[at] === "{") {
        const close = query.indexOf("}", ++at);
        if (close < 0) invalid();
        const values = query.slice(at, close).split(",");
        if (values.length > 2 || values.some(v => [...v].some(c => c < "0" || c > "9") || Number(v) > 255)) invalid();
        if (values[0]) s.min = Number(values[0]);
        if (values.length === 1 && values[0]) s.max = s.min!;
        else if (values[1]) s.max = Number(values[1]);
        at = close + 1;
      }
      requireSpace(true); s.matcher = string("|");
    } else if (query.startsWith("![", at) || query[at] === "[") {
      const image = query[at] === "!"; at += image ? 2 : 1;
      s = { kind: image ? "image" : "link", matcher: string("]") };
      skip(); if (!query.startsWith("](", at)) queryError(query, at, 'expected "$"');
      at += 2; s.second = string(")"); skip();
      if (query[at++] !== ")") queryError(query, at - 1, 'expected "$"');
    } else if (query.startsWith(":-:", at)) {
      at += 3; requireSpace(); const column = at;
      s = { kind: "table", matcher: string(":") }; skip();
      if (!query.startsWith(":-:", at)) invalid();
      if (s.matcher.omitted) queryError(query, column, 'table column matcher cannot empty; use an explicit "*"', column + 1);
      at += 3; s.second = string("|");
    } else if (query.startsWith("```", at) || query.startsWith("+++", at)) {
      const front = query[at] === "+"; at += 3; const languageAt = at;
      const language = string(" "); requireSpace();
      s = { kind: front ? "frontmatter" : "code", matcher: string("|"), second: language };
      if (front && !language.omitted) {
        if (language.text !== "yaml" && language.text !== "toml") queryError(query, languageAt, `front matter language must be "toml" or "yaml". Found ${JSON.stringify(language.text)}.`, at);
        s.variant = language.text;
      }
    } else {
      const starts: [string, string][] = [["1.", "item"], ["-", "item"], [">", "quote"], ["P:", "paragraph"], ["</>", "html"]];
      const found = starts.find(([text]) => query.startsWith(text, at));
      if (!found) invalid();
      at += found![0].length; requireSpace(); s = { kind: found![1], matcher: any() };
      if (s.kind === "item") {
        s.ordered = found![0] === "1.";
        if (query[at] === "[") {
          const char = query[at + 1];
          if (query[at + 2] !== "]" || !" x?".includes(char ?? "\0")) queryError(query, at + 1, 'expected "[x]", "[x]", or "[?]"');
          s.task = char!; at += 3;
        }
      }
      s.matcher = string("|");
    }
    skip(); if (at < query.length && query[at] !== "|") invalid();
    result.push(s);
  }
  return result;
}
function expand(template: string, match: Match, pattern: Pattern): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== "$") { out += template[i]; continue; }
    if (template[i + 1] === "$") { out += "$"; i++; continue; }
    let end = i + 1, name: string;
    if (template[end] === "{") { const close = template.indexOf("}", end + 1); if (close < 0) { out += "$"; continue; } name = template.slice(end + 1, close); end = close + 1; }
    else { while (end < template.length && (template[end] === "_" || template[end]!.toLowerCase() !== template[end]!.toUpperCase() || template[end]! >= "0" && template[end]! <= "9")) end++; name = template.slice(i + 1, end); }
    if (!name) out += "$";
    else { out += match.groups[pattern.groupNames.get(name) ?? Number(name)] ?? ""; i = end - 1; }
  }
  return out;
}
async function matches(m: Matcher, text: string, budget: MdqBudget): Promise<{ matched: boolean; ranges: Replacement[] }> {
  budget.checkpoint(text.length + 1);
  if (!m.pattern) {
    const target = m.exactCase ? text : simpleCaseFold(text), needle = m.exactCase ? m.text : simpleCaseFold(m.text);
    return { matched: m.start && m.end ? target === needle : m.start ? target.startsWith(needle) : m.end ? target.endsWith(needle) : target.includes(needle), ranges: [] };
  }
  const ranges: Replacement[] = []; let at = 0, matched = false, continuation = 0;
  while (at <= text.length) {
    const match = await m.pattern.find(text, budget.regex, at, continuation);
    if (!match) break;
    matched = true;
    if (m.replacement === undefined) break;
    if (match.start === match.end && ranges.at(-1)?.end === match.start) {
      at = match.end + (text.codePointAt(match.end)! > 0xffff ? 2 : 1); continue;
    }
    const value = expand(m.replacement, match, m.pattern);
    budget.charge("retainedBytes", value.length * 2 + 32);
    ranges.push({ start: match.start, end: match.end, value });
    continuation = match.end;
    at = match.end > match.start ? match.end : match.end + (text.codePointAt(match.end)! > 0xffff ? 2 : 1);
  }
  return { matched, ranges };
}
async function replaceString(m: Matcher, text: string, budget: MdqBudget): Promise<{ matched: boolean; text: string }> {
  const result = await matches(m, text, budget);
  for (const r of result.ranges.reverse()) text = text.slice(0, r.start) + r.value + text.slice(r.end);
  return { matched: result.matched, text };
}
async function replaceInline(m: Matcher, items: Inline[], budget: MdqBudget, kind: string): Promise<boolean> {
  interface Formatting { start: number; length: number; item: Inline; atomic: boolean }
  const byteLength = (text: string): number => {
    let size = 0;
    for (const char of text) { const code = char.codePointAt(0)!; size += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
    return size;
  };
  let events: Formatting[] = [], length = 0;
  const parts: string[] = [];
  const flatten = (values: Inline[], depth = 0): void => {
    budget.bound("depth", depth);
    for (const item of values) {
      budget.checkpoint();
      const event = { start: length, length: 0, item, atomic: !["emph", "strong", "strike"].includes(item.kind) };
      if (item.kind !== "text") { budget.charge("retainedBytes", 64); events.push(event); }
      if (item.children.length && !item.link?.autolink) flatten(item.children, depth + 1);
      else { const text = item.link?.autolink ? item.link.url : item.text; parts.push(text); length += byteLength(text); }
      event.length = length - event.start;
    }
  };
  flatten(items);
  budget.charge("retainedBytes", length * 2);
  const text = parts.join(""), result = await matches(m, text, budget);
  if (!result.ranges.length) return result.matched;
  const error = (message: string): never => { throw new MdqError(`Selection error:\nregex replacement error in ${kind} selector: ${message}\n`); };
  budget.charge("retainedBytes", result.ranges.length * 96);
  const boundaries = new Map<number, number>();
  for (const range of result.ranges) { boundaries.set(range.start, 0); boundaries.set(range.end, 0); }
  let offset = 0, bytes = 0;
  for (const char of text) {
    if (boundaries.has(offset)) boundaries.set(offset, bytes);
    offset += char.length; bytes += byteLength(char);
  }
  if (boundaries.has(offset)) boundaries.set(offset, bytes);
  const output: string[] = []; let last = 0;
  for (const range of result.ranges) {
    await budget.cooperate(events.length + 1);
    const start = boundaries.get(range.start)!, end = boundaries.get(range.end)!, replacementLength = byteLength(range.value), change = replacementLength - (end - start);
    const atomic = events.filter(event => event.atomic && event.start < end && event.start + event.length >= start);
    if (atomic.length > 1 || atomic[0] && (start < atomic[0].start || end > atomic[0].start + atomic[0].length)) error("replacement crosses atomic boundary");
    output.push(text.slice(last, range.start), range.value); last = range.end;
    const kept: Formatting[] = [];
    for (const event of events) {
      const eventEnd = event.start + event.length;
      if (event.start < start) {
        if (eventEnd > start) event.length = eventEnd < end ? start - event.start : event.length + change;
      } else if (event.start === start) {
        if (eventEnd <= end) { if (!replacementLength) continue; event.length = replacementLength; }
        else event.length += change;
      } else if (event.start < end) {
        if (eventEnd <= end) continue;
        event.length -= end - event.start; event.start = start + replacementLength;
      } else event.start += change;
      kept.push(event);
    }
    events = kept;
  }
  output.push(text.slice(last));
  const outputLength = output.reduce((sum, part) => sum + byteLength(part), 0);
  budget.charge("retainedBytes", outputLength * 3);
  const encoded = new TextEncoder().encode(output.join("")), decoder = new TextDecoder("utf-8", { fatal: true });
  let eventIndex = 0;
  const decode = (start: number, end: number): string => {
    try { return decoder.decode(encoded.subarray(start, end)); }
    catch { return error("internal error: formatting boundary is not a UTF-8 boundary"); }
  };
  const reconstruct = (start: number, end: number, depth = 0): Inline[] => {
    budget.bound("depth", depth);
    const values: Inline[] = []; let position = start;
    while (eventIndex < events.length) {
      budget.checkpoint();
      const event = events[eventIndex]!;
      if (event.start + event.length <= start) { eventIndex++; continue; }
      if (event.start >= end) break;
      if (event.start > position) { values.push(inline("text", decode(position, event.start))); position = event.start; }
      eventIndex++;
      const eventEnd = Math.min(event.start + event.length, end);
      if (eventEnd < position) continue;
      const item = event.item;
      if (item.children.length && !item.link?.autolink && item.kind !== "image") values.push({ ...item, children: reconstruct(position, eventEnd, depth + 1) });
      else {
        const value = decode(position, eventEnd);
        values.push(item.link?.autolink ? { ...item, children: [inline("text", value)], link: { ...item.link, url: value } }
          : item.kind === "image" ? { ...item, children: [inline("text", value)] } : { ...item, text: value });
      }
      position = eventEnd;
    }
    if (position < end) values.push(inline("text", decode(position, end)));
    budget.charge("retainedBytes", values.length * 128);
    return values;
  };
  const replaced = reconstruct(0, encoded.length);
  if (eventIndex < events.length) error(`internal error: failed to unflatten: ${events.length - eventIndex} events remaining`);
  items.length = 0;
  for (const value of replaced) items.push(value);
  return result.matched;
}
export async function select(doc: Document, selectors: Selector[], budget: MdqBudget): Promise<Node[]> {
  let nodes = [node("document", { children: doc.roots })];
  async function matchContent(m: Matcher, n: Node, kind: string): Promise<boolean> {
    if (n.kind === "code" || n.kind === "frontmatter" || n.kind === "break") return false;
    let matched = false;
    if (n.inline.length) matched = await replaceInline(m, n.inline, budget, kind);
    if (n.text || n.kind === "html") { const r = await replaceString(m, n.text, budget); n.text = r.text; matched ||= r.matched; }
    for (const child of n.children) { const r = await matchContent(m, child, kind); matched ||= r; }
    for (const row of n.rows ?? []) for (const cell of row) { const r = await replaceInline(m, cell, budget, kind); matched ||= r; }
    return matched;
  }
  for (const s of selectors) {
    const output: Node[] = [], pending = nodes.slice().reverse(), visitedNotes = new Set<string>();
    while (pending.length) {
      await budget.cooperate(); const n = pending.pop()!; let hit = false;
      if (s.kind === n.kind) {
        if (n.kind === "section") hit = (s.min === undefined || n.level! >= s.min) && (s.max === undefined || n.level! <= s.max) && await replaceInline(s.matcher, n.inline, budget, "section");
        else if (n.kind === "item") hit = s.ordered === (n.index !== undefined) && (s.task === undefined ? n.checked === undefined : s.task === "?" ? n.checked !== undefined : n.checked === (s.task === "x")) && await matchContent(s.matcher, n, "list item");
        else if (n.kind === "quote") hit = await matchContent(s.matcher, n, "block quote");
        else if (n.kind === "paragraph") hit = await replaceInline(s.matcher, n.inline, budget, "paragraph");
        else if (n.kind === "html" || n.kind === "frontmatter" || n.kind === "code") {
          if (n.kind === "frontmatter" && s.variant && s.variant !== n.variant) continue;
          const language = n.kind === "code" ? await replaceString(s.second!, n.language ?? "", budget) : { matched: true, text: "" };
          const content = await replaceString(s.matcher, n.text, budget);
          hit = language.matched && content.matched;
          if (hit) { n.text = content.text; if (n.kind === "code" && (language.text || n.language !== undefined)) n.language = language.text; }
        } else if (n.kind === "table") {
          const width = Math.max(...n.rows!.map(r => r.length), n.alignments!.length);
          for (const row of n.rows!) while (row.length < width) row.push([]);
          while (n.alignments!.length < width) n.alignments!.push("none");
          const allowed: number[] = [], rows: Inline[][][] = [];
          for (let i = 0; i < n.rows![0]!.length; i++) if (await replaceInline(s.matcher, n.rows![0]![i]!, budget, "table")) allowed.push(i);
          if (allowed.length) {
            rows.push(allowed.map(i => n.rows![0]![i]!));
            for (const row of n.rows!.slice(1)) {
              let found = false;
              for (const cell of row) { const r = await replaceInline(s.second!, cell, budget, "table"); found ||= r; }
              if (found) rows.push(allowed.map(i => row[i]!));
            }
            hit = rows.length > 1 || n.rows!.length === 1;
            if (hit) { n.rows = rows; n.alignments = allowed.map(i => n.alignments![i]!); }
          }
        }
      }
      if (n.kind === "inline") {
        const i = n.inline[0]!;
        if (i.kind === s.kind && (i.kind === "link" || i.kind === "image")) {
          const display = i.link?.autolink ? (await matches(s.matcher, i.link.url, budget)).matched : await replaceInline(s.matcher, i.children, budget, s.kind), url = await replaceString(s.second!, i.link!.url, budget);
          hit = display && url.matched;
          if (hit) { i.link!.url = url.text; if (i.link!.autolink) i.children = [inline("text", url.text)]; }
        } else if (i.kind === "html" && s.kind === "html") {
          const r = await replaceString(s.matcher, i.text, budget); hit = r.matched; if (hit) i.text = r.text;
        }
      }
      if (hit) { output.push(n.kind === "item" ? node("list", { children: [n] }) : n); continue; }
      const children = [...n.children];
      // Section titles participate in section matching, not descendant selection.
      for (const i of n.kind === "section" ? [] : n.inline) {
        if (n.kind !== "inline") children.push(node("inline", { inline: [i] }));
        else {
          children.push(...i.children.map(c => node("inline", { inline: [c] })));
          if (i.kind === "footnote" && !visitedNotes.has(i.text)) { visitedNotes.add(i.text); children.push(...doc.footnotes.get(i.text) ?? []); }
        }
      }
      for (const row of n.rows ?? []) for (const cell of row) children.push(...cell.map(i => node("inline", { inline: [i] })));
      budget.charge("work", children.length); pending.push(...children.reverse());
    }
    nodes = output;
  }
  return nodes;
}
