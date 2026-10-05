import type {AdapterContext} from "safe-bash-markdown-engine/types";
import {letter} from "./commonmark-syntax.js";
import {RetainedCommonMarkSyntax} from "./retained-commonmark-syntax.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";

const blockTags = new Set(["address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe", "legend", "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p", "param", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "track", "ul"]);
export interface RetainedMarker {start: number; marker: number; content: number; indent: number; empty: boolean}

/** One physical line is represented by raw and tab-expanded source spans. The
 * cursor mapping uses two scalars even for a single input-sized line. */
export class RetainedCommonMarkLine {
  private original = 0;
  private expanded = 0;
  private constructor(readonly source: RetainedSourceText, readonly raw: SourceRange, readonly text: SourceRange, readonly number: number, readonly ending: string, private readonly tabs: boolean, private readonly context: AdapterContext) {}
  get length(): number {return this.text.end - this.text.start;}
  static async create(source: RetainedSourceText, raw: SourceRange, number: number, ending: string, context: AdapterContext): Promise<RetainedCommonMarkLine> {
    const length = raw.end - raw.start; context.charge("retainedBytes", length * 12 + 64);
    let tabs = false, nulls = false;
    for await (const chunk of source.chunks(raw)) {tabs ||= chunk.includes("\t"); nulls ||= chunk.includes("\u0000");}
    if (nulls) {
      const original = raw;
      raw = await source.append((async function* () {for await (const chunk of source.chunks(original)) yield chunk.replaceAll("\u0000", "�");})());
    }
    let text = raw;
    if (!tabs) {context.checkpoint(length); context.bound("text", length); context.charge("retainedBytes", length * 10); if (length >= 256) await context.cooperate(0);}
    else {
      text = await source.append((async function* () {
        let width = 0, buffer = "", index = 0;
        for await (const chunk of source.chunks(raw)) for (let i = 0; i < chunk.length; i++) {
          context.checkpoint(); const char = chunk[i]!, count = char === "\t" ? 4 - width % 4 : 1;
          context.bound("text", width + count); context.charge("retainedBytes", count * 10);
          buffer += char === "\t" ? " ".repeat(count) : char; width += count;
          if (buffer.length >= 4096) {yield buffer; buffer = "";}
          if (index > 0 && index % 256 === 0) await context.cooperate(0); index++;
        }
        if (buffer) yield buffer;
      })());
    }
    return new RetainedCommonMarkLine(source, raw, text, number, ending, tabs, context);
  }
  async at(offset: number): Promise<string | undefined> {return offset < 0 || offset >= this.length ? undefined : this.source.unit(this.text.start + offset);}
  async spaces(offset: number): Promise<number> {let end = offset; while (await this.at(end) === " ") end++; return end - offset;}
  private async position(offset: number): Promise<{original: number; remaining: number}> {
    if (!this.tabs) return {original: Math.min(offset, this.raw.end - this.raw.start), remaining: 0};
    let original = offset < this.expanded ? 0 : this.original, expanded = offset < this.expanded ? 0 : this.expanded;
    while (this.raw.start + original < this.raw.end) {
      const width = await this.source.unit(this.raw.start + original) === "\t" ? 4 - expanded % 4 : 1;
      if (expanded + width > offset) break; expanded += width; original++;
    }
    this.original = original; this.expanded = expanded;
    const remaining = await this.source.unit(this.raw.start + original) === "\t" && offset > expanded ? expanded + 4 - expanded % 4 - offset : 0;
    return {original, remaining};
  }
  async column(offset: number): Promise<number> {return (await this.position(offset)).original + 1;}
  get endColumn(): number {return Math.max(1, this.raw.end - this.raw.start);}
  async rawFrom(offset: number): Promise<SourceRange> {
    const {original, remaining} = await this.position(offset), source = this.source, range = {start: this.raw.start + original + (remaining ? 1 : 0), end: this.raw.end};
    return remaining ? source.append((async function* () {yield " ".repeat(remaining); yield* source.chunks(range);})()) : range;
  }
  async rule(offset: number): Promise<boolean> {
    const char = await this.at(offset); if (char !== "-" && char !== "*" && char !== "_") return false;
    let count = 0;
    for (let i = offset; i < this.length; i++) {if (await this.at(i) === char) count++; else if (await this.at(i) !== " ") return false;}
    return count >= 3;
  }
  async setext(offset: number): Promise<number> {
    const char = await this.at(offset); if (char !== "=" && char !== "-") return 0;
    let end = offset; while (await this.at(end) === char) end++;
    return await this.spaces(end) === this.length - end ? char === "=" ? 1 : 2 : 0;
  }
  async heading(offset: number): Promise<number> {
    let end = offset; while (await this.at(end) === "#") end++;
    const count = end - offset; return count > 0 && count <= 6 && (end === this.length || await this.at(end) === " ") ? count : 0;
  }
  async fence(offset: number): Promise<{char: string; length: number} | undefined> {
    const char = await this.at(offset); if (char !== "`" && char !== "~") return;
    let end = offset; while (await this.at(end) === char) end++;
    if (end - offset < 3 || char === "`" && await this.source.find({start: this.text.start + end, end: this.text.end}, "`") !== -1) return;
    return {char, length: end - offset};
  }
  async marker(offset: number): Promise<RetainedMarker | undefined> {
    let end = offset, start = NaN, char = await this.at(end);
    if (char === "-" || char === "+" || char === "*") end++;
    else {
      let value = 0;
      while (end - offset < 10) {const digit = await this.at(end); if (digit === undefined || digit < "0" || digit > "9") break; value = value * 10 + Number(digit); end++;}
      if (end === offset || end - offset > 9 || await this.at(end) !== "." && await this.at(end) !== ")") return;
      start = value; char = await this.at(end++);
    }
    if (end !== this.length && await this.at(end) !== " ") return;
    const padding = await this.spaces(end), empty = end + padding === this.length, content = end + (empty || padding > 4 ? Math.min(padding, 1) : padding);
    return {start, marker: char!.charCodeAt(0), content, indent: end - offset + (empty ? 1 : padding > 4 ? 1 : padding), empty};
  }
  async html(offset: number, interrupt: boolean): Promise<{end: readonly string[] | null} | undefined> {
    if (await this.at(offset) !== "<") return;
    const syntax = new RetainedCommonMarkSyntax(this.source, this.text, this.context), start = this.text.start + offset;
    if (await syntax.starts(start, "<!--")) return {end: ["-->"]};
    if (await syntax.starts(start, "<?")) return {end: ["?>"]};
    if (await syntax.starts(start, "<![CDATA[")) return {end: ["]]>"]};
    if (await syntax.starts(start, "<!") && letter(await this.at(offset + 2))) return {end: [">"]};
    let i = offset + 1; const closing = await this.at(i) === "/"; if (closing) i++;
    const begin = i;
    while (letter(await this.at(i)) || (await this.at(i) ?? "") >= "0" && (await this.at(i) ?? "z") <= "9" || await this.at(i) === "-") i++;
    const char = await this.at(i), boundary = char === undefined || char === " " || char === ">" || char === "/" && await this.at(i + 1) === ">";
    if (!boundary) return;
    const name = i - begin <= 10 ? (await syntax.small({start: this.text.start + begin, end: this.text.start + i}, 10)).toLowerCase() : "";
    const special = ["script", "pre", "style", "textarea"].includes(name);
    if (!closing && special && (char === undefined || char === " " || char === ">")) return {end: ["</script>", "</pre>", "</style>", "</textarea>"]};
    if (blockTags.has(name)) return {end: null};
    if (!interrupt && (closing || !special)) {const end = await syntax.html(start); if (end !== undefined && await this.spaces(end - this.text.start) === this.text.end - end) return {end: null};}
  }
  async interrupts(offset: number, rawHtml: boolean): Promise<boolean> {
    const indent = await this.spaces(offset); if (indent > 3) return false;
    const at = offset + indent, item = await this.marker(at);
    return Boolean(await this.heading(at) || await this.rule(at) || await this.fence(at) || await this.at(at) === ">" || rawHtml && await this.html(at, true) || item && !item.empty && (Number.isNaN(item.start) || item.start === 1));
  }
  async closes(ends: readonly string[]): Promise<boolean> {
    for (const end of ends) for (let i = 0; i <= this.length - end.length; i++) {
      let matches = true; for (let j = 0; j < end.length; j++) if ((await this.at(i + j))!.toLowerCase() !== end[j]) {matches = false; break;}
      if (matches) return true;
    }
    return false;
  }
}
