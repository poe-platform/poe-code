import { bareAutolink, filterGfmHtml } from "./gfm-syntax.js";
import type { Inline, Attr } from "./ast-types.js";
import type { BlockDefinition, PendingInline } from "./commonmark-blocks.js";
import type { AdapterContext } from "./types.js";
import { asciiPunctuation, whitespace, letter, digit, normalizeLabel, readLabel, readDestination, readTitle, entity, decodeSyntax, normalizeUri } from "./commonmark-syntax.js";
import { unicodePunctuation, unicodeWhitespace } from "./commonmark-characters.js";

interface Node {
  value: Inline | string;
  children: Node | null;
  previous: Node | null;
  next: Node | null;
}
interface Delimiter {
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
  extensions: Readonly<Record<string, boolean>> = {}
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
    await context.cooperate();
    if (!refs.has(definition.label)) refs.set(definition.label, definition);
  }
  const root: Node = { value: "", children: null, previous: null, next: null };
  let tail = root;
  let delimiter: Delimiter | null = null;
  let bracket: Bracket | null = null;
  let bracketCount = 0;
  let delimiterCount = 0;
  let serial = 0;
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
      await context.cooperate();
      if (!closer.close) { closer = closer.next; continue; }
      const key = closer.char + Number(closer.open) + closer.original % 3;
      const floor = bottoms.get(key) ?? lower;
      let opener = closer.previous;
      while (opener && opener.index > floor) {
        await context.cooperate();
        if (opener.char === closer.char && opener.open && (closer.char === "~" || !((closer.open || opener.close) && (opener.original + closer.original) % 3 === 0 && (opener.original % 3 !== 0 || closer.original % 3 !== 0)))) break;
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
      const wrap: Node = { value: { t: opener.char === "~" ? "Strikeout" : count === 2 ? "Strong" : "Emph", c: [] }, children: first, previous: opener.node, next: closer.node };
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
    await context.cooperate();
    if (text[i] !== "`") { i++; continue; }
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
    await context.cooperate();
    const char = text[i]!;
    if (char === "\\") {
      if (text[i + 1] === "\n") { append({ t: "LineBreak" }); i = skipSpace(text, i + 2, context); }
      else if (asciiPunctuation(text[i + 1])) { append(text[i + 1]!); i += 2; }
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
      append({ t: "Code", c: [attr(), literal] });
      i = close + count;
      continue;
    }
    if (char === "*" || char === "_" || char === "~" && extensions.strikeout) {
      let end = i;
      while (text[end] === char) { context.checkpoint(); end++; }
      if (char === "~" && end - i !== 2) { append(text.slice(i, end)); i = end; continue; }
      const prev = before(text, i), next = after(text, end);
      const left = !unicodeWhitespace(next) && (!unicodePunctuation(next) || unicodeWhitespace(prev) || unicodePunctuation(prev));
      const right = !unicodeWhitespace(prev) && (!unicodePunctuation(prev) || unicodeWhitespace(next) || unicodePunctuation(next));
      const node = append(text.slice(i, end));
      context.bound("references", ++delimiterCount + bracketCount);
      context.charge("retainedBytes", 96);
      const entry: Delimiter = { node, char, length: end - i, original: end - i, open: char !== "_" ? left : left && (!right || unicodePunctuation(prev)), close: char !== "_" ? right : right && (!left || unicodePunctuation(next)), index: serial++, previous: delimiter, next: null };
      if (delimiter) delimiter.next = entry;
      delimiter = entry;
      i = end;
      continue;
    }
    if (char === "[" || char === "!" && text[i + 1] === "[") {
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
      if (!opener.active) { append(char); i++; continue; }
      let target = inlineTarget(text, i + 1, context);
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
        if (definition) target = { url: definition.destination, title: definition.title, end };
      }
      if (!target) { append(char); i++; continue; }
      await emphasis(opener.delimiter);
      const first = opener.node.next;
      if (first) first.previous = null;
      opener.node.next = null;
      tail = opener.node;
      const value: Inline = { t: opener.image ? "Image" : "Link", c: [attr(), [], [normalizeUri(decodeSyntax(target.url, context), context), decodeSyntax(target.title, context)]] };
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
        append({ t: "Link", c: [attr(), [{ t: "Str", c: auto.label }], [normalizeUri(auto.url, context), ""]] });
        deactivateLinks();
        i = auto.end;
        continue;
      }
      const end = html(text, i, context);
      if (end !== undefined) {
        const literal = text.slice(i, end);
        if (extensions.raw_html === false || Object.hasOwn(extensions, "raw_html") && filterGfmHtml(literal, context) !== literal) append(literal);
        else append({ t: "RawInline", c: ["html", literal] });
        i = end; continue;
      }
    }
    if (extensions.autolink_bare_uris && !bracket) {
      const auto = bareAutolink(text, i, context);
      if (auto) {
        append({ t: "Link", c: [attr(), [{ t: "Str", c: auto.label }], [normalizeUri(auto.url, context), ""]] });
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
    while (i < text.length && !"\\`*_~[]!<& \t\n".includes(text[i]!) && !(extensions.autolink_bare_uris && (text.startsWith("https://", i) || text.startsWith("http://", i) || text.startsWith("ftp://", i) || text.startsWith("www.", i) || (letter(text[i]) || digit(text[i])) && !letter(text[i - 1]) && !digit(text[i - 1]) && !".-_+".includes(text[i - 1] ?? "")))) { context.checkpoint(); i++; }
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
      await context.cooperate();
      if (typeof node.value === "string") { addText(node.value); continue; }
      flush();
      let value = node.value;
      if (node.children) {
        const children = await materialize(node.children, depth + 1);
        if (value.t === "Emph" || value.t === "Strong" || value.t === "Strikeout") value = { t: value.t, c: children };
        if (value.t === "Link" || value.t === "Image") value = { t: value.t, c: [value.c[0], children, value.c[2]] };
      }
      push(value);
    }
    flush();
    return result;
  }
  return materialize(root.next, 1);
}
