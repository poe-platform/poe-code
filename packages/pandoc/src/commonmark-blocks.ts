import type { AdapterContext } from "./types.js";
import { normalizeLabel } from "./commonmark-syntax.js";

export interface BlockPoint { line: number; column: number }
export interface BlockSource { source: string; start: BlockPoint; end: BlockPoint }
export interface PendingInline {
  kind: "pendingInline";
  lines: { text: string; start: BlockPoint }[];
}
export interface PendingItem { blocks: PendingBlock[]; source: BlockSource }
export type PendingBlock =
  | { kind: "paragraph"; inline: PendingInline; source: BlockSource }
  | { kind: "heading"; level: number; inline: PendingInline; source: BlockSource }
  | { kind: "thematicBreak"; source: BlockSource }
  | { kind: "code"; info: string; literal: string; source: BlockSource }
  | { kind: "html"; literal: string; source: BlockSource }
  | { kind: "quote"; blocks: PendingBlock[]; source: BlockSource }
  | { kind: "list"; start: number | null; marker: string; tight: boolean; items: PendingItem[]; source: BlockSource };
export interface BlockDefinition {
  label: string;
  destination: string;
  title: string;
  source: BlockSource;
}
export interface CommonMarkBlockDocument { blocks: PendingBlock[]; definitions: BlockDefinition[] }

interface Line {
  raw: string;
  text: string;
  // Expanded columns map back to original UTF-16 offsets, including partial tabs.
  offsets: number[];
  number: number;
  ending: string;
}
type ListBlock = Extract<PendingBlock, { kind: "list" }>;
type Container =
  | { kind: "quote"; node: Extract<PendingBlock, { kind: "quote" }> }
  | { kind: "list"; node: ListBlock }
  | { kind: "item"; node: PendingItem; indent: number; list: ListBlock; blank: boolean; empty: boolean };
type Leaf =
  | { kind: "paragraph"; node: Extract<PendingBlock, { kind: "paragraph" }> }
  | { kind: "fence"; node: Extract<PendingBlock, { kind: "code" }>; char: string; length: number; indent: number }
  | { kind: "indent"; node: Extract<PendingBlock, { kind: "code" }>; blanks: string[] }
  | { kind: "html"; node: Extract<PendingBlock, { kind: "html" }>; end: readonly string[] | null };
interface Marker { start: number | null; marker: string; content: number; indent: number; empty: boolean }

function spaces(text: string, offset: number): number {
  let end = offset;
  while (text[end] === " ") end++;
  return end - offset;
}
function trimEnd(text: string): string {
  let end = text.length;
  while (text[end - 1] === " " || text[end - 1] === "\t") end--;
  return text.slice(0, end);
}
function trim(text: string): string {
  let start = 0;
  while (text[start] === " " || text[start] === "\t") start++;
  return trimEnd(text.slice(start));
}
function rawFrom(line: Line, offset: number): string {
  const original = line.offsets[offset] ?? line.raw.length;
  if (line.raw[original] === "\t" && offset > 0 && line.offsets[offset - 1] === original) {
    let end = offset;
    while (line.offsets[end] === original) end++;
    return " ".repeat(end - offset) + line.raw.slice(original + 1);
  }
  return line.raw.slice(original);
}
function point(line: Line, offset: number): BlockPoint {
  return { line: line.number, column: (line.offsets[offset] ?? line.raw.length) + 1 };
}
function endPoint(line: Line): BlockPoint {
  return { line: line.number, column: Math.max(1, line.raw.length) };
}
function rule(text: string, offset: number): boolean {
  const char = text[offset];
  if (char !== "-" && char !== "*" && char !== "_") return false;
  let count = 0;
  for (let i = offset; i < text.length; i++) {
    if (text[i] === char) count++;
    else if (text[i] !== " ") return false;
  }
  return count >= 3;
}
function setext(text: string, offset: number): number {
  const char = text[offset];
  if (char !== "=" && char !== "-") return 0;
  let end = offset;
  while (text[end] === char) end++;
  return spaces(text, end) === text.length - end ? (char === "=" ? 1 : 2) : 0;
}
function heading(text: string, offset: number): number {
  let end = offset;
  while (text[end] === "#") end++;
  const count = end - offset;
  return count > 0 && count <= 6 && (end === text.length || text[end] === " ") ? count : 0;
}
function fence(text: string, offset: number): { char: string; length: number } | undefined {
  const char = text[offset];
  if (char !== "`" && char !== "~") return;
  let end = offset;
  while (text[end] === char) end++;
  if (end - offset < 3 || (char === "`" && text.indexOf("`", end) !== -1)) return;
  return { char, length: end - offset };
}
function marker(text: string, offset: number): Marker | undefined {
  let end = offset;
  let start: number | null = null;
  let char = text[end];
  if (char === "-" || char === "+" || char === "*") end++;
  else {
    while (text[end] !== undefined && text[end]! >= "0" && text[end]! <= "9" && end - offset < 10) end++;
    if (end === offset || end - offset > 9 || (text[end] !== "." && text[end] !== ")")) return;
    start = Number(text.slice(offset, end));
    char = text[end++];
  }
  if (end !== text.length && text[end] !== " ") return;
  const padding = spaces(text, end);
  const empty = end + padding === text.length;
  const content = end + (empty || padding > 4 ? Math.min(padding, 1) : padding);
  return { start, marker: char!, content, indent: end - offset + (empty ? 1 : padding > 4 ? 1 : padding), empty };
}

const blockTags = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col", "colgroup",
  "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe",
  "legend", "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p",
  "param", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "track", "ul"
]);
function letter(char: string | undefined): boolean {
  return char !== undefined && ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z"));
}
function nameChar(char: string | undefined): boolean {
  return letter(char) || (char !== undefined && char >= "0" && char <= "9") || char === "-";
}
function punctuation(char: string | undefined): boolean {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  return code >= 0x21 && code <= 0x2f || code >= 0x3a && code <= 0x40 || code >= 0x5b && code <= 0x60 || code >= 0x7b && code <= 0x7e;
}
// Complete type-7 tag recognition is a small attribute scanner, not a substitution.
function completeTag(text: string, offset: number): boolean {
  let i = offset + 1;
  const closing = text[i] === "/";
  if (closing) i++;
  if (!letter(text[i])) return false;
  while (nameChar(text[i])) i++;
  while (i < text.length) {
    const gap = spaces(text, i);
    i += gap;
    if (text[i] === ">" || (!closing && text[i] === "/" && text[i + 1] === ">")) {
      i += text[i] === "/" ? 2 : 1;
      return spaces(text, i) === text.length - i;
    }
    if (closing || gap === 0) return false;
    const first = text[i];
    if (!letter(first) && first !== "_" && first !== ":") return false;
    i++;
    while (nameChar(text[i]) || text[i] === "_" || text[i] === ":" || text[i] === ".") i++;
    const afterName = i;
    i += spaces(text, i);
    if (text[i] !== "=") { i = afterName; continue; }
    i++;
    i += spaces(text, i);
    const quote = text[i];
    if (quote === "'" || quote === '"') {
      i++;
      while (i < text.length && text[i] !== quote) i++;
      if (i === text.length) return false;
      i++;
    } else {
      const begin = i;
      while (i < text.length && !" \"'=<>`".includes(text[i]!)) i++;
      if (i === begin) return false;
    }
  }
  return false;
}
function htmlStart(text: string, offset: number, interrupt: boolean): { end: readonly string[] | null } | undefined {
  if (text[offset] !== "<") return;
  if (text.startsWith("<!--", offset)) return { end: ["-->"] };
  if (text.startsWith("<?", offset)) return { end: ["?>"] };
  if (text.startsWith("<![CDATA[", offset)) return { end: ["]]>"] };
  if (text.startsWith("<!", offset) && letter(text[offset + 2])) return { end: [">"] };
  let i = offset + 1;
  const closing = text[i] === "/";
  if (closing) i++;
  const begin = i;
  while (nameChar(text[i])) i++;
  const name = text.slice(begin, i).toLowerCase();
  const boundary = text[i] === undefined || text[i] === " " || text[i] === ">" || (text[i] === "/" && text[i + 1] === ">");
  if (!boundary) return;
  if (!closing && ["script", "pre", "style", "textarea"].includes(name) && (text[i] === undefined || text[i] === " " || text[i] === ">")) return { end: ["</script>", "</pre>", "</style>", "</textarea>"] };
  if (blockTags.has(name)) return { end: null };
  if (!interrupt && (closing || !["script", "pre", "style", "textarea"].includes(name)) && completeTag(text, offset)) return { end: null };
}
function interrupts(text: string, offset: number): boolean {
  const indent = spaces(text, offset);
  if (indent > 3) return false;
  const at = offset + indent;
  const item = marker(text, at);
  return Boolean(heading(text, at) || rule(text, at) || fence(text, at) || text[at] === ">" || htmlStart(text, at, true) ||
    (item && !item.empty && (item.start === null || item.start === 1)));
}

/** Internal phase only. PendingInline is deliberately not a validated Pandoc AST. */
export async function parseCommonMarkBlocks(
  text: string,
  context: AdapterContext,
  source = "input"
): Promise<CommonMarkBlockDocument> {
  context.checkpoint(0);
  context.charge("text", text.length);
  context.charge("retainedBytes", text.length * 2);
  text = text.replaceAll("\u0000", "�");
  const document: CommonMarkBlockDocument = { blocks: [], definitions: [] };
  const labels = new Set<string>();
  const blankItems = new WeakSet<PendingItem>();
  const stack: Container[] = [];
  let leaf: Leaf | undefined;
  let cursor = 0;
  let number = 0;
  const range = (line: Line, offset: number): BlockSource => ({ source, start: point(line, offset), end: endPoint(line) });
  const blocks = (): PendingBlock[] => {
    const top = stack[stack.length - 1];
    return top?.kind === "quote" || top?.kind === "item" ? top.node.blocks : document.blocks;
  };
  const add = (node: PendingBlock): void => {
    context.bound("depth", stack.length + 1);
    context.charge("nodes", 1);
    context.charge("retainedBytes", 128);
    const item = stack[stack.length - 1];
    if (item?.kind === "item" && item.blank && item.node.blocks.length > 0) item.list.tight = false;
    if (item?.kind === "item") item.blank = false;
    blocks().push(node);
  };
  const push = (container: Container): void => {
    context.bound("depth", stack.length + 1);
    context.charge("retainedBytes", 64);
    stack.push(container);
  };
  const inlineLine = (line: Line, offset: number, value?: string) => {
    context.bound("references", document.definitions.length + (leaf?.kind === "paragraph" ? leaf.node.inline.lines.length : 0) + 1);
    const literal = value ?? rawFrom(line, offset);
    context.charge("retainedBytes", literal.length * 2 + 48);
    return { text: literal, start: point(line, offset) };
  };
  const finish = (): void => {
    if (leaf?.kind === "paragraph") extractDefinitions(leaf.node);
    leaf = undefined;
  };
  function extractDefinitions(node: Extract<PendingBlock, { kind: "paragraph" }>): void {
    let consumed = 0;
    while (consumed < node.inline.lines.length) {
      const candidate = readDefinition(node.inline.lines, consumed, context);
      if (!candidate) break;
      context.charge("references", 1);
      context.charge("retainedBytes", (candidate.label.length + candidate.destination.length + candidate.title.length) * 2 + 128);
      if (!labels.has(candidate.label)) {
        labels.add(candidate.label);
        document.definitions.push({
          label: candidate.label, destination: candidate.destination, title: candidate.title,
          source: { source, start: node.inline.lines[consumed]!.start,
            end: { line: node.inline.lines[consumed + candidate.count - 1]!.start.line,
              column: node.inline.lines[consumed + candidate.count - 1]!.start.column + node.inline.lines[consumed + candidate.count - 1]!.text.length - 1 } }
        });
      }
      consumed += candidate.count;
    }
    if (consumed) {
      node.inline.lines.splice(0, consumed);
      if (node.inline.lines.length) node.source.start = node.inline.lines[0]!.start;
      else {
        const siblings = blocks();
        const index = siblings.indexOf(node);
        if (index >= 0) siblings.splice(index, 1);
      }
    }
  }
  while (cursor < text.length) {
    await context.cooperate();
    const begin = cursor;
    while (cursor < text.length && text[cursor] !== "\n" && text[cursor] !== "\r") {
      context.checkpoint();
      if ((cursor - begin) % 256 === 0) await context.cooperate(0);
      cursor++;
    }
    const raw = text.slice(begin, cursor);
    let ending = "";
    if (cursor < text.length) {
      ending = text[cursor++]!;
      if (ending === "\r" && text[cursor] === "\n") ending += text[cursor++]!;
    }
    context.charge("retainedBytes", raw.length * 12 + 64);
    const offsets: number[] = [];
    const fragments: string[] = [];
    let width = 0;
    for (let i = 0; i < raw.length; i++) {
      context.checkpoint();
      const count = raw[i] === "\t" ? 4 - width % 4 : 1;
      context.bound("text", width + count);
      context.charge("retainedBytes", count * 10);
      fragments.push(raw[i] === "\t" ? " ".repeat(count) : raw[i]!);
      for (let j = 0; j < count; j++) offsets.push(i);
      width += count;
      if (i % 256 === 0) await context.cooperate(0);
    }
    const line: Line = { raw, text: fragments.join(""), offsets, number: ++number, ending };
    let offset = 0;
    let matched = 0;
    for (; matched < stack.length; matched++) {
      context.checkpoint();
      const container = stack[matched]!;
      if (container.kind === "list") continue;
      const indent = spaces(line.text, offset);
      if (container.kind === "quote") {
        if (indent > 3 || line.text[offset + indent] !== ">") break;
        offset += indent + 1;
        if (line.text[offset] === " ") offset++;
      } else if (container.empty && container.blank) break;
      else if (indent >= container.indent) offset += container.indent;
      else if (offset + indent === line.text.length) offset += indent;
      else break;
      if (container.kind === "item" && offset + spaces(line.text, offset) < line.text.length) container.empty = false;
    }
    const blank = offset + spaces(line.text, offset) === line.text.length;
    if (matched < stack.length) {
      const failed = stack[matched];
      const siblingIndent = spaces(line.text, offset);
      const sibling = siblingIndent <= 3 ? marker(line.text, offset + siblingIndent) : undefined;
      const siblingItem = failed?.kind === "item" && sibling;
      if (leaf?.kind === "paragraph" && !blank && !siblingItem && !interrupts(line.text, offset)) {
        leaf.node.inline.lines.push(inlineLine(line, offset + spaces(line.text, offset)));
        leaf.node.source.end = endPoint(line);
        for (const container of stack) container.node.source.end = endPoint(line);
        continue;
      }
      finish();
      stack.length = matched;
    }
    for (const container of stack) container.node.source.end = endPoint(line);
    if (leaf?.kind === "fence") {
      const indent = spaces(line.text, offset);
      const at = offset + indent;
      let end = at;
      while (line.text[end] === leaf.char) end++;
      if (indent <= 3 && end - at >= leaf.length && spaces(line.text, end) === line.text.length - end) {
        leaf.node.source.end = endPoint(line);
        finish();
      } else {
        const value = rawFrom(line, offset + Math.min(indent, leaf.indent)) + (ending || "\n");
        context.charge("retainedBytes", value.length * 2);
        leaf.node.literal += value;
        leaf.node.source.end = endPoint(line);
      }
      continue;
    }
    if (leaf?.kind === "html") {
      if (leaf.end === null && blank) finish();
      else {
        const value = rawFrom(line, offset) + (ending || "\n");
        context.charge("retainedBytes", value.length * 2);
        leaf.node.literal += value;
        leaf.node.source.end = endPoint(line);
        if (leaf.end !== null && leaf.end.some((end) => line.text.toLowerCase().includes(end))) finish();
        continue;
      }
    }
    if (leaf?.kind === "indent") {
      const indent = spaces(line.text, offset);
      if (blank) {
        const value = rawFrom(line, offset + Math.min(indent, 4)) + (ending || "\n");
        context.charge("retainedBytes", value.length * 2);
        leaf.blanks.push(value);
        continue;
      }
      if (indent >= 4) {
        const value = leaf.blanks.join("") + rawFrom(line, offset + 4) + (ending || "\n");
        context.charge("retainedBytes", value.length * 2);
        leaf.node.literal += value;
        leaf.blanks.length = 0;
        leaf.node.source.end = endPoint(line);
        continue;
      }
      finish();
    }
    if (blank) {
      finish();
      let deepest: Extract<Container, { kind: "item" }> | undefined;
      if (stack[stack.length - 1]?.kind === "item") {
        for (const container of stack) if (container.kind === "item") { deepest = container; blankItems.add(container.node); }
      }
      if (deepest) deepest.blank = true;
      continue;
    }
    const initialIndent = spaces(line.text, offset);
    const underline = initialIndent <= 3 ? setext(line.text, offset + initialIndent) : 0;
    if (leaf?.kind === "paragraph" && underline) {
      const node = leaf.node;
      extractDefinitions(node);
      if (node.inline.lines.length) {
        const siblings = blocks();
        siblings[siblings.indexOf(node)] = { kind: "heading", level: underline, inline: node.inline, source: { ...node.source, end: endPoint(line) } };
        leaf = undefined;
        continue;
      }
      leaf = undefined;
    }
    if (leaf?.kind === "paragraph" && !interrupts(line.text, offset)) {
      leaf.node.inline.lines.push(inlineLine(line, offset + initialIndent));
      leaf.node.source.end = endPoint(line);
      continue;
    }
    const wasParagraph = leaf?.kind === "paragraph";
    finish();
    // Reprocess opening containers on the same physical line. Each iteration
    // consumes a marker and charges depth/work before retaining its state.
    for (;;) {
      context.checkpoint();
      const indent = spaces(line.text, offset);
      const at = offset + indent;
      const top = stack[stack.length - 1];
      const item = indent <= 3 && !rule(line.text, at) ? marker(line.text, at) : undefined;
      if (top?.kind === "list" && (!item || (item.start !== null) !== (top.node.start !== null) || item.marker !== top.node.marker)) {
        stack.pop();
        const parent = stack[stack.length - 1];
        const previous = top.node.items[top.node.items.length - 1];
        if (parent?.kind === "item" && previous && blankItems.has(previous)) parent.blank = true;
      }
      if (indent <= 3 && line.text[at] === ">") {
        const node: Extract<PendingBlock, { kind: "quote" }> = { kind: "quote", blocks: [], source: range(line, at) };
        add(node);
        push({ kind: "quote", node });
        offset = at + 1;
        if (line.text[offset] === " ") offset++;
        continue;
      }
      if (item && (!wasParagraph || !item.empty && (item.start === null || item.start === 1))) {
        let listContainer = stack[stack.length - 1];
        if (listContainer?.kind !== "list") {
          const node: ListBlock = { kind: "list", start: item.start, marker: item.marker, tight: true, items: [], source: range(line, at) };
          add(node);
          listContainer = { kind: "list", node };
          push(listContainer);
        }
        const previous = listContainer.node.items[listContainer.node.items.length - 1];
        // Blank lines between items are recorded before the previous item closes.
        if (previous && blankItems.has(previous)) listContainer.node.tight = false;
        const node: PendingItem = { blocks: [], source: range(line, at) };
        context.charge("nodes", 1);
        context.charge("retainedBytes", 128);
        listContainer.node.items.push(node);
        push({ kind: "item", node, list: listContainer.node, indent: indent + item.indent, blank: false, empty: item.empty });
        offset = item.content;
        if (item.empty) break;
        continue;
      }
      if (at === line.text.length) break;
      const level = indent <= 3 ? heading(line.text, at) : 0;
      if (level) {
        let content = trim(rawFrom(line, at + level));
        let end = content.length;
        while (content[end - 1] === "#") end--;
        if (end < content.length && (end === 0 || content[end - 1] === " " || content[end - 1] === "\t")) content = trimEnd(content.slice(0, end));
        add({ kind: "heading", level, inline: { kind: "pendingInline", lines: [inlineLine(line, at + level + spaces(line.text, at + level), content)] }, source: range(line, at) });
        break;
      }
      if (indent <= 3 && rule(line.text, at)) { add({ kind: "thematicBreak", source: range(line, at) }); break; }
      const opening = indent <= 3 ? fence(line.text, at) : undefined;
      if (opening) {
        const node: Extract<PendingBlock, { kind: "code" }> = { kind: "code", info: trim(rawFrom(line, at + opening.length)), literal: "", source: range(line, at) };
        add(node);
        leaf = { kind: "fence", node, ...opening, indent };
        break;
      }
      const html = indent <= 3 ? htmlStart(line.text, at, false) : undefined;
      if (html) {
        const literal = rawFrom(line, offset) + (ending || "\n");
        context.charge("retainedBytes", literal.length * 2);
        const node: Extract<PendingBlock, { kind: "html" }> = { kind: "html", literal, source: range(line, at) };
        add(node);
        if (html.end === null || !html.end.some((end) => line.text.toLowerCase().includes(end))) leaf = { kind: "html", node, end: html.end };
        break;
      }
      if (indent >= 4) {
        const literal = rawFrom(line, offset + 4) + (ending || "\n");
        context.charge("retainedBytes", literal.length * 2);
        const node: Extract<PendingBlock, { kind: "code" }> = { kind: "code", info: "", literal, source: range(line, offset + 4) };
        add(node);
        leaf = { kind: "indent", node, blanks: [] };
        break;
      }
      const node: Extract<PendingBlock, { kind: "paragraph" }> = { kind: "paragraph", inline: { kind: "pendingInline", lines: [inlineLine(line, at)] }, source: range(line, at) };
      add(node);
      leaf = { kind: "paragraph", node };
      break;
    }
    for (const container of stack) {
      if (container.kind === "item") blankItems.delete(container.node);
      container.node.source.end = endPoint(line);
    }
  }
  finish();
  context.checkpoint(0);
  return document;
}

// Definition grammar runs only at the beginning of a pending paragraph. It
// returns source strings for a future inline resolver, not fabricated text ASTs.
function readDefinition(
  lines: PendingInline["lines"], index: number, context: AdapterContext
): { label: string; destination: string; title: string; count: number } | undefined {
  let first = lines[index]!.text;
  if (first[0] !== "[") return;
  let i = 1;
  let label = "";
  let labelCharacters = 0;
  let count = 1;
  for (;;) {
    context.checkpoint();
    if (i === first.length) {
      if (!lines[index + count] || labelCharacters >= 999) return;
      label += "\n";
      labelCharacters++;
      first = lines[index + count++]!.text;
      i = 0;
      continue;
    }
    if (first[i] === "\\" && punctuation(first[i + 1])) { label += first[i++]! + first[i++]!; labelCharacters += 2; if (labelCharacters > 999) return; continue; }
    if (first[i] === "]") break;
    if (first[i] === "[") return;
    const width = first.codePointAt(i)! > 0xffff ? 2 : 1;
    label += first.slice(i, i + width);
    i += width;
    if (++labelCharacters > 999) return;
  }
  if (first[i] !== "]" || first[i + 1] !== ":") return;
  label = normalizeLabel(label, context);
  if (!label) return;
  let text = first.slice(i + 2);
  i = 0;
  while (text[i] === " " || text[i] === "\t") i++;
  if (i === text.length && lines[index + count]) { text = lines[index + count++]!.text; i = 0; while (text[i] === " " || text[i] === "\t") i++; }
  let destination = "";
  if (text[i] === "<") {
    i++;
    while (i < text.length && text[i] !== ">") {
      context.checkpoint();
      if (text[i] === "<") return;
      if (text[i] === "\\" && punctuation(text[i + 1])) destination += text[i++]!;
      destination += text[i++]!;
    }
    if (text[i++] !== ">") return;
  } else {
    let depth = 0;
    while (i < text.length && text[i] !== " " && text[i] !== "\t") {
      context.checkpoint();
      const char = text[i++]!;
      if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) return;
      if (char === "\\" && punctuation(text[i])) { destination += char + text[i++]!; continue; }
      if (char === "(") { context.bound("depth", ++depth); }
      if (char === ")" && --depth < 0) return;
      destination += char;
    }
    if (depth !== 0 || !destination) return;
  }
  const destinationCount = count;
  const tail = text.slice(i);
  const hasGap = tail.length > 0 && (tail[0] === " " || tail[0] === "\t");
  text = trim(tail);
  if (!text && lines[index + count]) {
    const next = trim(lines[index + count]!.text);
    if (next[0] === "'" || next[0] === '"' || next[0] === "(") { text = next; count++; }
  } else if (text && !hasGap) return;
  if (!text) return { label, destination, title: "", count };
  const opening = text[0];
  if (opening !== "'" && opening !== '"' && opening !== "(") return;
  const closing = opening === "(" ? ")" : opening;
  const titleFailure = () => count > destinationCount ? { label, destination, title: "", count: destinationCount } : undefined;
  let title = "";
  i = 1;
  for (;;) {
    context.checkpoint();
    if (i === text.length) {
      if (!lines[index + count]) return titleFailure();
      text = lines[index + count++]!.text;
      i = 0;
      title += "\n";
      continue;
    }
    const char = text[i++]!;
    if (char === "\\" && punctuation(text[i])) { title += char + text[i++]!; continue; }
    if (char === closing) return trim(text.slice(i)) ? titleFailure() : { label, destination, title, count };
    if (opening === "(" && char === "(") return titleFailure();
    title += char;
  }
}
