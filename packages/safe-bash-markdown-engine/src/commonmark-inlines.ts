import {markdownNativeSpan} from "./markdown-native-span.js";
export {markdownNativeSpan} from "./markdown-native-span.js";
import {scanMarkdownRawTex} from "./markdown-raw-tex.js";
export {scanMarkdownRawTex} from "./markdown-raw-tex.js";
import { bareAutolink, filterGfmHtml } from "./gfm-syntax.js";
import {scanMarkdownCitation} from "./markdown-citations.js";
export {scanMarkdownCitation} from "./markdown-citations.js";
import type { Citation, Inline, Attr } from "./ast-types.js";
import type { BlockDefinition, PendingInline } from "./commonmark-blocks.js";
import type { AdapterContext } from "./types.js";
import { asciiPunctuation, fencedDivAttributes, whitespace, letter, digit, normalizeLabel, readLabel, readDestination, readTitle, entity, decodeSyntax, normalizeUri } from "./commonmark-syntax.js";
import { unicodePunctuation, unicodeWhitespace } from "./commonmark-characters.js";

export async function scanMarkdownRawAttribute(
  start: number, at: (offset: number) => string | undefined | Promise<string | undefined>, context: AdapterContext
): Promise<number | undefined> {
  if (await at(start) !== "{" || await at(start + 1) !== "=") return;
  let end = start + 2;
  while (true) {
    await context.cooperate();
    const unit = await at(end);
    if (unit === "}" && end > start + 2) return end + 1;
    if (!letter(unit) && !digit(unit) && unit !== "_" && unit !== "-") return;
    end++;
  }
}

interface Node {
  value: Inline | string;
  children: Node | null;
  previous: Node | null;
  next: Node | null;
}
interface Delimiter {
  scriptEnd: number | undefined;
  position: number;
  node: Node;
  char: string;
  length: number;
  original: number;
  open: boolean;
  close: boolean;
  index: number;
  previous: Delimiter | null;
  next: Delimiter | null;
}
interface Bracket {
  node: Node;
  start: number;
  image: boolean;
  active: boolean;
  nested: boolean;
  delimiter: Delimiter | null;
  previous: Bracket | null;
}
function attr(): Attr { return ["", [], []]; }
function before(text: string, i: number): string | undefined {
  const n = text.charCodeAt(i - 1);
  return text.slice(i - (n >= 0xdc00 && n <= 0xdfff ? 2 : 1), i) || undefined;
}
function after(text: string, i: number): string | undefined {
  const n = text.codePointAt(i);
  return n === undefined ? undefined : String.fromCodePoint(n);
}
function skipSpace(text: string, start: number, context: AdapterContext): number {
  let i = start;
  while (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r") { context.checkpoint(); i++; }
  return i;
}
function inlineTarget(text: string, start: number, context: AdapterContext): { url: string; title: string; end: number } | undefined {
  if (text[start] !== "(") return;
  const begin = skipSpace(text, start + 1, context);
  const destination = readDestination(text, begin, context);
  if (destination) {
    const gap = skipSpace(text, destination.end, context);
    if (text[gap] === ")") return { url: destination.value, title: "", end: gap + 1 };
    if (gap > destination.end) {
      const title = readTitle(text, gap, context);
      if (title) {
        const end = skipSpace(text, title.end, context);
        if (text[end] === ")") return { url: destination.value, title: title.value, end: end + 1 };
      }
    }
  }
  // With leading whitespace a title can accompany an omitted destination.
  if (begin > start + 1) {
    const title = readTitle(text, begin, context);
    if (title) {
      const end = skipSpace(text, title.end, context);
      if (text[end] === ")") return { url: "", title: title.value, end: end + 1 };
    }
  }
}
function autolink(text: string, start: number, context: AdapterContext): { url: string; label: string; end: number } | undefined {
  let end = start + 1;
  while (end < text.length && text[end] !== ">") {
    context.checkpoint();
    if (text[end] === "<" || text[end]!.charCodeAt(0) <= 32) return;
    end++;
  }
  if (text[end] !== ">") return;
  const label = text.slice(start + 1, end);
  let i = 0;
  if (letter(label[0])) {
    i++;
    while (letter(label[i]) || digit(label[i]) || label[i] === "+" || label[i] === "." || label[i] === "-") i++;
    if (i >= 2 && i <= 32 && label[i] === ":") return { url: label, label, end: end + 1 };
  }
  i = 0;
  while (letter(label[i]) || digit(label[i]) || label[i] !== undefined && ".!#$%&'*+/=?^_`{|}~-".includes(label[i]!)) i++;
  if (i === 0 || label[i++] !== "@") return;
  for (;;) {
    const begin = i;
    if (!letter(label[i]) && !digit(label[i])) return;
    i++;
    while (letter(label[i]) || digit(label[i]) || label[i] === "-") i++;
    if (i - begin > 63 || label[i - 1] === "-") return;
    if (i === label.length) return { url: "mailto:" + label, label, end: end + 1 };
    if (label[i++] !== ".") return;
  }
}
function html(text: string, start: number, context: AdapterContext): number | undefined {
  const terminated = (prefix: string, suffix: string): number | undefined => {
    if (!text.startsWith(prefix, start)) return;
    const end = text.indexOf(suffix, start + prefix.length);
    context.checkpoint(end < 0 ? text.length - start : end - start);
    return end < 0 ? undefined : end + suffix.length;
  };
  if (text.startsWith("<!--", start)) {
    if (text.startsWith("<!-->", start)) return start + 5;
    if (text.startsWith("<!--->", start)) return start + 6;
    return terminated("<!--", "-->");
  }
  if (text.startsWith("<?", start)) return terminated("<?", "?>");
  if (text.startsWith("<![CDATA[", start)) return terminated("<![CDATA[", "]]>");
  if (text.startsWith("<!", start)) {
    let i = start + 2;
    const begin = i;
    while (letter(text[i])) i++;
    if (i === begin || !whitespace(text[i])) return;
    return terminated("<!", ">");
  }
  let i = start + 1;
  const closing = text[i] === "/";
  if (closing) i++;
  if (!letter(text[i])) return;
  i++;
  while (letter(text[i]) || digit(text[i]) || text[i] === "-") i++;
  for (;;) {
    context.checkpoint();
    const begin = i;
    i = skipSpace(text, i, context);
    if (text[i] === ">") return i + 1;
    if (!closing && text[i] === "/" && text[i + 1] === ">") return i + 2;
    if (closing || i === begin || (!letter(text[i]) && text[i] !== "_" && text[i] !== ":")) return;
    i++;
    while (letter(text[i]) || digit(text[i]) || text[i] !== undefined && "_.:-".includes(text[i]!)) { context.checkpoint(); i++; }
    const afterName = i;
    i = skipSpace(text, i, context);
    if (text[i] !== "=") { i = afterName; continue; }
    i = skipSpace(text, i + 1, context);
    const quote = text[i];
    if (quote === "'" || quote === '"') {
      i++;
      while (i < text.length && text[i] !== quote) { context.checkpoint(); i++; }
      if (text[i] !== quote) return;
      i++;
    } else {
      const begin = i;
      while (i < text.length && !whitespace(text[i]) && !"\"'=<>`".includes(text[i]!)) { context.checkpoint(); i++; }
      if (i === begin) return;
    }
  }
}

/** Linked delimiter/bracket algorithm. Every scan charges work; all retained
 * stacks, nodes and strings reserve capacity, and AST nesting is bounded before
 * recursive materialization. Definitions have already been discovered globally. */
export async function parseCommonMarkInlines(
  pending: PendingInline, definitions: readonly BlockDefinition[], context: AdapterContext,
  extensions: Readonly<Record<string, boolean>> = {},
  footnote?: (label: string) => Promise<Inline | undefined>,
  citationsState = {note: 0}
): Promise<Inline[]> {
  context.checkpoint(0);
  const size = pending.lines.reduce((n, line) => n + line.text.length + 1, -1);
  context.bound("text", Math.max(0, size));
  context.charge("retainedBytes", Math.max(0, size) * 4 + pending.lines.length * 16);
  const text = pending.lines.map((line) => line.text.replaceAll("\u0000", "�")).join("\n");
  context.bound("references", definitions.length);
  context.charge("retainedBytes", definitions.length * 48);
  const refs = new Map<string, BlockDefinition>();
  for (const definition of definitions) {
    if (context.sinceYield !== undefined && context.sinceYield < 255) context.checkpoint(); else await context.cooperate();
    if (!refs.has(definition.label)) refs.set(definition.label, definition);
  }
  const root: Node = { value: "", children: null, previous: null, next: null };
  let tail = root;
  const spans: {node: Node; attributes: Attr; delimiter: Delimiter | null; bracket: Bracket | null}[] = [];
  let delimiter: Delimiter | null = null;
  let bracket: Bracket | null = null;
  let bracketCount = 0;
  let delimiterCount = 0;
  let serial = 0;
  let inlineMathEnd = text.length, displayMathEnd = text.length;
  const append = (value: Inline | string, children: Node | null = null): Node => {
    context.charge("nodes", 1);
    context.charge("retainedBytes", 128 + (typeof value === "string" ? value.length * 2 : 0));
    const node: Node = { value, children, previous: tail, next: null };
    tail.next = node;
    tail = node;
    return node;
  };
  const removeNode = (node: Node): void => {
    if (node.previous) node.previous.next = node.next;
    if (node.next) node.next.previous = node.previous;
    else tail = node.previous ?? root;
  };
  const removeDelimiter = (entry: Delimiter): void => {
    if (entry.previous) entry.previous.next = entry.next;
    if (entry.next) entry.next.previous = entry.previous;
    else delimiter = entry.previous;
    delimiterCount--;
  };
  const emphasis = async (bottom: Delimiter | null): Promise<void> => {
    const lower = bottom?.index ?? -1;
    // Separate lower bounds for marker, closer-open flag and run modulo 3.
    const bottoms = new Map<string, number>();
    let closer = bottom ? bottom.next : delimiter;
    if (!bottom) while (closer?.previous) closer = closer.previous;
    while (closer) {
      if (context.sinceYield !== undefined && context.sinceYield < 255) context.checkpoint(); else await context.cooperate();
      if (!closer.close) { closer = closer.next; continue; }
      const key = closer.char + (closer.scriptEnd === undefined ? "" : "script") + Number(closer.open) + closer.original % 3;
      const floor = bottoms.get(key) ?? lower;
      let opener = closer.previous;
      while (opener && opener.index > floor) {
        if (context.sinceYield !== undefined && context.sinceYield < 255) context.checkpoint(); else await context.cooperate();
        if (opener.char === closer.char && opener.open && (closer.char === "'" || closer.char === '"' ? true : closer.scriptEnd !== undefined ? opener.scriptEnd === closer.position : closer.char === "~" ? opener.original === closer.original : !((closer.open || opener.close) && (opener.original + closer.original) % 3 === 0 && (opener.original % 3 !== 0 || closer.original % 3 !== 0)))) break;
        opener = opener.previous;
      }
      if (!opener || opener.index <= floor) {
        bottoms.set(key, closer.previous?.index ?? lower);
        const next = closer.next;
        if (!closer.open) removeDelimiter(closer);
        closer = next;
        continue;
      }
      const count = opener.length >= 2 && closer.length >= 2 ? 2 : 1;
      opener.length -= count;
      closer.length -= count;
      opener.node.value = opener.char.repeat(opener.length);
      closer.node.value = closer.char.repeat(closer.length);
      const first = opener.node.next;
      const last = closer.node.previous;
      context.charge("nodes", 1);
      context.charge("retainedBytes", 128);
      const quote = opener.char === "'" || opener.char === '"';
      const wrap: Node = { value: quote ? {t: "Quoted", c: [opener.char === "'" ? "SingleQuote" : "DoubleQuote", []]} : { t: opener.scriptEnd !== undefined ? opener.char === "^" ? "Superscript" : "Subscript" : opener.char === "~" ? "Strikeout" : count === 2 ? "Strong" : "Emph", c: [] }, children: first, previous: opener.node, next: closer.node };
      if (first) first.previous = null;
      if (last) last.next = null;
      opener.node.next = wrap;
      closer.node.previous = wrap;
      let between = opener.next;
      while (between && between !== closer) { const next = between.next; removeDelimiter(between); between = next; }
      if (!opener.length) { removeNode(opener.node); removeDelimiter(opener); }
      if (!closer.length) { const next = closer.next; removeNode(closer.node); removeDelimiter(closer); closer = next; }
    }
    while (delimiter && delimiter.index > lower) removeDelimiter(delimiter);
  };
  const deactivateLinks = (): void => {
    for (let entry = bracket; entry; entry = entry.previous) {
      context.checkpoint();
      if (!entry.image) entry.active = false;
    }
  };

  // Index backtick runs once, so failed/mismatched runs never rescan the suffix.
  const ticks = new Map<number, number[]>();
  for (let i = 0; i < text.length;) {
    const next = text.indexOf("`", i);
    if (next < 0) {
      if (text.length > i) context.checkpoint(text.length - i);
      break;
    }
    if (next > i) {
      context.checkpoint(next - i);
      i = next;
    }
    if (context.sinceYield !== undefined && context.sinceYield < 255) context.checkpoint(); else await context.cooperate();
    const begin = i;
    while (text[i] === "`") { context.checkpoint(); i++; }
    context.charge("references", 1);
    context.charge("retainedBytes", 16);
    const run = ticks.get(i - begin) ?? [];
    run.push(begin);
    ticks.set(i - begin, run);
  }
  const tickPositions = new Map<number, number>();
  for (let i = 0; i < text.length;) {
    if (context.sinceYield !== undefined && context.sinceYield < 255) context.checkpoint(); else await context.cooperate();
    const char = text[i]!;
    const textualCitation = extensions.citations && (char === "@" || char === "-" && text[i + 1] === "@") && (i === 0 || !letter(text[i - 1]) && !digit(text[i - 1]) && !"_".includes(text[i - 1]!));
    if ((char === "[" || textualCitation) && extensions.citations) {
      let end = i + Number(!textualCitation);
      const citations: Citation[] = [];
      const parse = (value: string) => parseCommonMarkInlines({kind: "pendingInline", lines: [{text: value, start: pending.lines[0]!.start}]}, definitions, context, {...extensions, citations: false}, footnote);
      for (;;) {
        const item = await scanMarkdownCitation(end, position => text[position], context, !textualCitation);
        if (!item) break;
        context.charge("retainedBytes", 128);
        citations.push({citationId: text.slice(item.idStart, item.idEnd),
          citationPrefix: await parse(text.slice(item.start, item.prefixEnd).trim()),
          citationSuffix: await parse((item.pageSpace < 0 ? text.slice(item.suffixStart, item.suffixEnd) : text.slice(item.suffixStart, item.pageSpace) + "\u00a0" + text.slice(item.pageSpace + 1, item.suffixEnd)).trim()),
          citationMode: item.suppressed ? "SuppressAuthor" : textualCitation ? "AuthorInText" : "NormalCitation", citationNoteNum: citationsState.note + 1, citationHash: 0});
        end = item.end;
        if (textualCitation || text[end] === "]") break;
        end++;
      }
      if (citations.length && (textualCitation || text[end] === "]")) {
        citationsState.note++;
        if (!textualCitation) end++;
        const literal: Inline[] = [];
        for (const part of text.slice(i, end).split(" ")) {if (literal.length) literal.push({t: "Space"}); if (part) literal.push({t: "Str", c: part});}
        append({t: "Cite", c: [citations, literal]}); i = end; continue;
      }
    }
    if (char === "\\") {
      const rawEnd = extensions.raw_tex ? await scanMarkdownRawTex(i, position => text[position], context) : undefined;
      if (rawEnd !== undefined) {append({t: "RawInline", c: ["tex", text.slice(i, rawEnd)]}); i = rawEnd; continue;}
      if (text[i + 1] === "\n") { append({ t: "LineBreak" }); i = skipSpace(text, i + 2, context); }
      else if (asciiPunctuation(text[i + 1]) || text[i + 1] === " " && (extensions.superscript || extensions.subscript)) { append(text[i + 1]!); i += 2; }
      else { append(char); i++; }
      continue;
    }
    if (char === "`") {
      let end = i;
      while (text[end] === "`") { context.checkpoint(); end++; }
      const count = end - i;
      const runs = ticks.get(count) ?? [];
      let position = tickPositions.get(count) ?? 0;
      while (runs[position] !== undefined && runs[position]! <= i) position++;
      tickPositions.set(count, position);
      const close = runs[position];
      if (close === undefined) { append(text.slice(i, end)); i = end; continue; }
      context.charge("retainedBytes", (close - end) * 4);
      let literal = text.slice(end, close).split("\n").join(" ");
      if (literal.startsWith(" ") && literal.endsWith(" ") && [...literal].some((c) => c !== " ")) literal = literal.slice(1, -1);
      i = close + count;
      const rawEnd = extensions.raw_attribute ? await scanMarkdownRawAttribute(i, position => text[position], context) : undefined;
      if (rawEnd !== undefined) {
        append({t: "RawInline", c: [text.slice(i + 2, rawEnd - 1), literal]});
        i = rawEnd;
      } else append({ t: "Code", c: [attr(), literal] });
      continue;
    }
    if (char === "$" && extensions.tex_math_dollars) {
      const display = text[i + 1] === "$", count = display ? 2 : 1, start = i + count;
      const limit = display ? displayMathEnd : inlineMathEnd;
      if (display || !unicodeWhitespace(text[start])) {
        let end = start;
        while (end < limit) {
          context.checkpoint();
          if (text[end] === "\\") {end += 2; continue;}
          if (text[end] === "$" && (!display || text[end + 1] === "$")) break;
          end++;
        }
        if (end < limit && (display || end > start && !unicodeWhitespace(text[end - 1]) && !digit(text[end + 1]))) {
          context.charge("retainedBytes", (end - start) * 2);
          append({t: "Math", c: [display ? "DisplayMath" : "InlineMath", text.slice(start, end)]});
          i = end + count; continue;
        }
        // Later openers cannot find a closer in this already-scanned suffix.
        if (end >= limit) {if (display) displayMathEnd = start; else inlineMathEnd = start;}
      }
      append(text.slice(i, start)); i = start; continue;
    }
    if (extensions.smart && (char === "-" || char === ".")) {
      let end = i;
      while (text[end] === char) {context.checkpoint(); end++;}
      let count = end - i;
      if (char === ".") {append("…".repeat(Math.floor(count / 3)) + ".".repeat(count % 3));}
      else {
        // Pandoc prefers em dashes for multiples of three, en dashes for even runs.
        if (count >= 3 && count % 2 !== 0) {append("—"); count -= 3;}
        append(count % 3 === 0 ? "—".repeat(count / 3) : "–".repeat(Math.floor(count / 2)) + "-".repeat(count % 2));
      }
      i = end; continue;
    }
    const quote = extensions.smart && (char === "'" || char === '"');
    if (quote || char === "*" || char === "_" || char === "^" && extensions.superscript || char === "~" && (extensions.strikeout || extensions.subscript)) {
      let end = i;
      while (text[end] === char && (!quote || end === i)) { context.checkpoint(); end++; }
      const script = end - i === 1 && (char === "^" && extensions.superscript || char === "~" && extensions.subscript);
      let scriptEnd: number | undefined;
      if (script) {
        // A script ends at the next unescaped marker and cannot cross raw whitespace.
        scriptEnd = end;
        while (scriptEnd < text.length && text[scriptEnd] !== char && !unicodeWhitespace(text[scriptEnd])) {
          context.checkpoint();
          if (text[scriptEnd] === "\\" && scriptEnd + 1 < text.length) scriptEnd++;
          scriptEnd++;
        }
        if (scriptEnd === end || text[scriptEnd] !== char) scriptEnd = -1;
      }
      if (char === "^" && !script || char === "~" && !script && (!extensions.strikeout || end - i !== 2 && !(extensions.single_tilde && end - i === 1))) { append(text.slice(i, end)); i = end; continue; }
      const prev = before(text, i), next = after(text, end);
      const left = !unicodeWhitespace(next) && (!unicodePunctuation(next) || unicodeWhitespace(prev) || unicodePunctuation(prev));
      const right = !unicodeWhitespace(prev) && (!unicodePunctuation(prev) || unicodeWhitespace(next) || unicodePunctuation(next));
      const node = append(quote ? char === "'" ? "’" : left ? "“" : "”" : text.slice(i, end));
      context.bound("references", ++delimiterCount + bracketCount);
      context.charge("retainedBytes", 96);
      const entry: Delimiter = { node, char, position: i, scriptEnd, length: end - i, original: end - i, open: quote ? left && (char !== "'" || !letter(prev) && !digit(prev)) : script ? scriptEnd !== -1 : char !== "_" ? left : left && (!right || unicodePunctuation(prev)), close: quote ? right && (char !== "'" || !letter(next) && !digit(next)) : script ? true : char !== "_" ? right : right && (!left || unicodePunctuation(next)), index: serial++, previous: delimiter, next: null };
      if (delimiter) delimiter.next = entry;
      delimiter = entry;
      i = end;
      continue;
    }
    if (char === "[" || char === "!" && text[i + 1] === "[") {
      if (char === "[" && text[i + 1] === "^" && (footnote || context.footnoteReference)) {
        const end = text.indexOf("]", i + 2);
        const label = end < 0 ? "" : text.slice(i + 2, end);
        const note = label ? await footnote?.(label) : undefined;
        if (note) {append(note); i = end + 1; continue;}
        if (label && context.footnoteReference?.(label)) {
          append({ t: "RawInline", c: ["mdq-footnote", label] }); i = end + 1; continue;
        }
      }
      const image = char === "!";
      const node = append(image ? "![" : "[");
      context.bound("references", ++bracketCount + delimiterCount);
      context.charge("retainedBytes", 96);
      if (bracket) bracket.nested = true;
      bracket = { node, start: i + (image ? 2 : 1), image, active: true, nested: false, delimiter, previous: bracket };
      i += image ? 2 : 1;
      continue;
    }
    if (char === "]") {
      const opener = bracket as Bracket | null;
      if (!opener) { append(char); i++; continue; }
      bracket = opener.previous;
      bracketCount--;
      if (!opener.image && extensions.bracketed_spans && text[i + 1] === "{") {
        let end = i + 2, quote: string | undefined;
        while (end < text.length) {
          context.checkpoint();
          const unit = text[end];
          if (quote) {
            if (unit === "\\") {end += 2; continue;}
            if (unit === quote) quote = undefined;
          } else if (unit === "}") break;
          else if ((unit === '"' || unit === "'") && text[end - 1] === "=") quote = unit;
          end++;
        }
        if (text[end] === "}") {
          context.charge("retainedBytes", (end - i) * 2);
          const attributes = fencedDivAttributes(text.slice(i + 1, end + 1), context);
          if (attributes) {
            await emphasis(opener.delimiter);
            let first = opener.node.next;
            if (first) first.previous = null;
            opener.node.next = null;
            tail = opener.node;
            const classes = attributes[1].filter(name => name !== "smallcaps");
            const smallcaps = attributes[1].length - classes.length;
            const span = !smallcaps || attributes[0] !== "" || classes.length > 0 || attributes[2].length > 0;
            for (let count = span ? smallcaps : smallcaps - 1; count > 0; count--) {
              first = append({t: "SmallCaps", c: []}, first);
              removeNode(first);
              first.previous = null;
            }
            append(span ? {t: "Span", c: [[attributes[0], classes, attributes[2]], []]} : {t: "SmallCaps", c: []}, first);
            removeNode(opener.node);
            i = end + 1; continue;
          }
        }
      }
      if (!opener.active) { append(char); i++; continue; }
      let target = inlineTarget(text, i + 1, context);
      let reference: { label: string; style: "full" | "collapsed" | "shortcut" } | undefined;
      if (!target) {
        const explicit = readLabel(text, i + 1, context);
        let label: string | undefined;
        let end = i + 1;
        if (explicit && explicit.label) { label = explicit.label; end = explicit.end; }
        else if (!opener.nested) {
          const raw = text.slice(opener.start, i);
          // Shortcut/collapsed labels obey the same 999 scalar grammar.
          const scanned = readLabel("[" + raw + "]", 0, context);
          if (scanned) { label = raw; end = explicit?.end ?? end; }
        }
        const definition = label === undefined ? undefined : refs.get(normalizeLabel(label, context));
        if (definition) {
          target = { url: definition.destination, title: definition.title, end };
          reference = { label: label!, style: explicit ? explicit.label ? "full" : "collapsed" : "shortcut" };
        }
      }
      if (!target) { append(char); i++; continue; }
      await emphasis(opener.delimiter);
      const first = opener.node.next;
      if (first) first.previous = null;
      opener.node.next = null;
      tail = opener.node;
      let attributes = attr();
      if (extensions.link_attributes && text[target.end] === "{") {
        let end = target.end + 1, quote: string | undefined;
        while (end < text.length) {
          context.checkpoint();
          const unit = text[end];
          if (quote) {
            if (unit === "\\") {end += 2; continue;}
            if (unit === quote) quote = undefined;
          } else if (unit === "}") break;
          else if ((unit === '"' || unit === "'") && text[end - 1] === "=") quote = unit;
          end++;
        }
        if (text[end] === "}") {
          context.charge("retainedBytes", (end + 1 - target.end) * 2);
          const parsed = fencedDivAttributes(text.slice(target.end, end + 1), context);
          if (parsed) {attributes = parsed; target.end = end + 1;}
        }
      }
      const value: Inline = { t: opener.image ? "Image" : "Link", c: [attributes, [], [normalizeUri(decodeSyntax(target.url, context), context), decodeSyntax(target.title, context)]] };
      if (reference) context.linkReference?.(value.c[2], reference.label, reference.style);
      if (opener.image && context.resourceTarget) {
        let offset = 0;
        let line = pending.lines[0]?.start.line ?? 1;
        for (const entry of pending.lines) {
          context.checkpoint();
          if (offset > opener.start) break;
          line = entry.start.line;
          offset += entry.text.length + 1;
        }
        context.resourceTarget(value.c[2], line);
      }
      append(value, first);
      removeNode(opener.node);
      if (!opener.image) deactivateLinks();
      i = target.end;
      continue;
    }
    if (char === "<") {
      const auto = autolink(text, i, context);
      if (auto) {
        const target: [string, string] = [normalizeUri(auto.url, context), ""];
        context.autolink?.(target, auto.label, "bracketed");
        append({ t: "Link", c: [["", extensions.autolinkClasses ? [auto.url === "mailto:" + auto.label ? "email" : "uri"] : [], []], [{ t: "Str", c: auto.label }], target] });
        deactivateLinks();
        i = auto.end;
        continue;
      }
      const end = html(text, i, context);
      if (end !== undefined) {
        const literal = text.slice(i, end);
        if (extensions.native_spans) {
          const span = markdownNativeSpan(literal, context);
          if (span === "close" && spans.length && spans[spans.length - 1]!.bracket === bracket) {
            const opener = spans.pop()!;
            await emphasis(opener.delimiter);
            const first = opener.node.next;
            if (first) first.previous = null;
            opener.node.next = null; tail = opener.node;
            append({t: "Span", c: [opener.attributes, []]}, first);
            removeNode(opener.node); i = end; continue;
          }
          if (span && span !== "close") {
            context.bound("depth", spans.length + 1);
            spans.push({node: append({t: "RawInline", c: ["html", literal]}), attributes: span, delimiter, bracket});
            i = end; continue;
          }
        }
        if (extensions.raw_html === false || Object.hasOwn(extensions, "raw_html") && filterGfmHtml(literal, context) !== literal) append(literal);
        else append({ t: "RawInline", c: ["html", literal] });
        i = end; continue;
      }
    }
    if (extensions.autolink_bare_uris && !bracket) {
      const auto = bareAutolink(text, i, context);
      if (auto) {
        const target: [string, string] = [normalizeUri(auto.url, context), ""];
        if (!auto.label.startsWith("www.")) context.autolink?.(target, auto.label, "bare");
        append({ t: "Link", c: [["", extensions.autolinkClasses ? [auto.url === "mailto:" + auto.label ? "email" : "uri"] : [], []], [{ t: "Str", c: auto.label }], target] });
        deactivateLinks(); i = auto.end; continue;
      }
    }
    if (char === "&") {
      const decoded = entity(text, i, context);
      if (decoded) { append(decoded.value); i = decoded.end; continue; }
    }
    if (char === " " || char === "\t" || char === "\n") {
      const begin = i;
      while (text[i] === " " || text[i] === "\t") { context.checkpoint(); i++; }
      if (text[i] === "\n") {
        append({ t: text.slice(begin, i).endsWith("  ") ? "LineBreak" : "SoftBreak" });
        i = skipSpace(text, i + 1, context);
      } else if (i < text.length) append(text.slice(begin, i));
      continue;
    }
    const begin = i++;
    while (i < text.length && !"\\`*_~^[]!<& \t\n".includes(text[i]!) && !(extensions.smart && "'\"-.".includes(text[i]!)) && !(extensions.tex_math_dollars && text[i] === "$") && !(extensions.citations && (text[i] === "@" || text[i] === "-" && text[i + 1] === "@")) && !(extensions.autolink_bare_uris && (text.startsWith("https://", i) || text.startsWith("http://", i) || text.startsWith("ftp://", i) || text.startsWith("www.", i) || (letter(text[i]) || digit(text[i])) && !letter(text[i - 1]) && !digit(text[i - 1]) && !".-_+".includes(text[i - 1] ?? "")))) { context.checkpoint(); i++; }
    append(text.slice(begin, i));
  }
  await emphasis(null);
  async function materialize(first: Node | null, depth: number): Promise<Inline[]> {
    context.bound("depth", depth);
    const result: Inline[] = [];
    let fragments: string[] = [];
    let length = 0;
    const push = (value: Inline): void => {
      context.charge("nodes", 1);
      context.charge("retainedBytes", 64);
      result.push(value);
    };
    const flush = (): void => {
      if (!length) return;
      context.checkpoint(fragments.length);
      context.charge("retainedBytes", length * 2);
      push({ t: "Str", c: fragments.join("") });
      fragments = [];
      length = 0;
    };
    const addText = (literal: string): void => {
      // Entity expansion may contain spaces, but never introduces syntax/breaks.
      let start = 0;
      while (start < literal.length) {
        const space = literal.indexOf(" ", start);
        const end = space < 0 ? literal.length : space;
        context.checkpoint(end - start + 1);
        if (end > start) {
          context.charge("retainedBytes", (end - start) * 2 + 16);
          fragments.push(literal.slice(start, end));
          length += end - start;
        }
        if (space >= 0) { flush(); push({ t: "Space" }); }
        start = end + 1;
      }
    };
    for (let node = first; node; node = node.next) {
      if (context.sinceYield !== undefined && context.sinceYield < 255) context.checkpoint(); else await context.cooperate();
      if (typeof node.value === "string") { addText(node.value); continue; }
      flush();
      let value = node.value;
      if (node.children) {
        const children = await materialize(node.children, depth + 1);
        if (value.t === "Emph" || value.t === "Strong" || value.t === "Strikeout" || value.t === "Superscript" || value.t === "Subscript" || value.t === "SmallCaps") value = { t: value.t, c: children };
        if (value.t === "Span") value = {t: "Span", c: [value.c[0], children]};
        if (value.t === "Quoted") value = {t: "Quoted", c: [value.c[0], children]};
        if (value.t === "Link" || value.t === "Image") value = { t: value.t, c: [value.c[0], children, value.c[2]] };
      }
      push(value);
    }
    flush();
    return result;
  }
  return materialize(root.next, 1);
}
