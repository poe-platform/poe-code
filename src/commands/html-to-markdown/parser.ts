import { entities } from "./entities.js";
import type { Budget } from "./budget.js";

export interface HtmlNode {
  readonly tag: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: HtmlNode[];
  readonly text?: string;
}

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
export const blockTags = new Set(["address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);

export class Parser {
  readonly root: HtmlNode = { tag: "root", attributes: new Map(), children: [] };
  private readonly stack: HtmlNode[] = [this.root];
  private mode: "text" | "tag" | "comment" | "raw" = "text";
  private buffer = "";
  private bufferBytes = 0;
  private quote = "";
  private rawName = "";
  private rawCandidate = "";
  private rawCandidateBytes = 0;
  private rawText: "drop" | "entities" | "literal" = "drop";
  constructor(readonly budget: Budget) {}

  private appendText(text: string, decode = true): void {
    if (!text) return;
    this.budget.add("tokens"); this.budget.add("nodes");
    this.stack.at(-1)!.children.push({ tag: "text", attributes: new Map(), children: [], text: (decode ? entities(text, this.budget) : text).replaceAll("\0", "�") });
  }

  private flushText(final: boolean, decode = true): void {
    let end = this.buffer.length;
    if (!final && decode) {
      const ampersand = this.buffer.lastIndexOf("&");
      if (ampersand >= 0 && end - ampersand <= 34 && !this.buffer.slice(ampersand).includes(";")) end = ampersand;
    }
    this.appendText(this.buffer.slice(0, end), decode);
    this.buffer = this.buffer.slice(end);
    this.bufferBytes = Buffer.byteLength(this.buffer);
  }

  private rawContent(text: string): void {
    if (this.rawText === "drop") return;
    for (const character of text) {
      this.budget.work(character.length);
      const bytes = Buffer.byteLength(character);
      if (bytes > this.budget.limits.maxTokenBytes - this.bufferBytes) this.flushText(true, this.rawText === "entities");
      this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.bufferBytes, "token bytes");
      this.bufferBytes += bytes; this.buffer += character;
      if (this.bufferBytes >= 4096) this.flushText(false, this.rawText === "entities");
    }
  }

  private rawCharacter(character: string): void {
    if (!this.rawName) { this.rawContent(character); return; }
    const target = `</${this.rawName}`;
    if (character === "<") {
      this.rawContent(this.rawCandidate); this.rawCandidate = "<"; this.rawCandidateBytes = 1;
    } else if (this.rawCandidate) {
      if (this.rawCandidate.length >= target.length && character === ">") {
        this.budget.add("tokens"); this.flushText(true, this.rawText === "entities");
        if (this.rawText !== "drop") this.pop(this.rawName);
        this.rawCandidate = ""; this.rawCandidateBytes = 0; this.mode = "text";
      } else if (this.rawCandidate.length < target.length && target.startsWith((this.rawCandidate + character).toLowerCase())
        || this.rawCandidate.length >= target.length && /[\t\r\n\f ]/u.test(character)) {
        if (this.rawText === "drop" && this.rawCandidate.length >= target.length) return;
        const bytes = Buffer.byteLength(character);
        this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.rawCandidateBytes, "token bytes");
        this.rawCandidateBytes += bytes; this.rawCandidate += character;
      } else {
        this.rawContent(this.rawCandidate); this.rawContent(character); this.rawCandidate = ""; this.rawCandidateBytes = 0;
      }
    } else this.rawContent(character);
  }

  private pop(name: string): void {
    for (let index = this.stack.length - 1; index > 0; index--) {
      if (this.stack[index]!.tag === name) { this.stack.length = index; return; }
    }
  }

  private tag(raw: string): void {
    this.budget.add("tokens"); this.budget.work(raw.length);
    if (/^<!|^<\?/u.test(raw)) return;
    const match = /^<(\/)?([A-Za-z][A-Za-z0-9:_-]*)([\s\S]*)>$/u.exec(raw);
    if (!match || match[3] && !/^[\t\n\r\f /]/u.test(match[3])) { this.appendText(raw); return; }
    const name = match[2]!.toLowerCase();
    if (match[1]) { this.pop(name); return; }
    const tail = match[3]!, attributes = new Map<string, string>();
    let position = 0, count = 0, selfClosing = false;
    while (position < tail.length) {
      this.budget.work(1);
      while (/\s/u.test(tail[position] ?? "") && position < tail.length) position++;
      if (position === tail.length) break;
      if (tail[position] === "/" && !tail.slice(position + 1).trim()) { selfClosing = true; break; }
      this.budget.check(++count, this.budget.limits.maxAttributes, "attributes");
      const start = position;
      while (position < tail.length && !/[\s=/>]/u.test(tail[position]!)) position++;
      if (position === start) { position++; continue; }
      const key = tail.slice(start, position).toLowerCase();
      while (position < tail.length && /\s/u.test(tail[position]!)) position++;
      let value = "";
      if (tail[position] === "=") {
        position++;
        while (position < tail.length && /\s/u.test(tail[position]!)) position++;
        const quote = tail[position] === '"' || tail[position] === "'" ? tail[position++]! : "";
        const startValue = position;
        while (position < tail.length && (quote ? tail[position] !== quote : !/\s/u.test(tail[position]!))) position++;
        value = tail.slice(startValue, position);
        if (quote && tail[position] === quote) position++;
      }
      if (!attributes.has(key)) attributes.set(key, entities(value, this.budget));
    }
    if (name === "script" || name === "style") { this.mode = "raw"; this.rawName = name; this.rawText = "drop"; return; }
    if (name === "a") this.pop("a");
    if (blockTags.has(name)) this.pop("p");
    if (name === "li") {
      for (let index = this.stack.length - 1; index > 0; index--) {
        if (this.stack[index]!.tag === "ul" || this.stack[index]!.tag === "ol") break;
        if (this.stack[index]!.tag === "li") { this.stack.length = index; break; }
      }
    }
    if (name === "tr") this.pop("tr");
    if (name === "td" || name === "th") {
      if (this.stack.at(-1)?.tag === "td" || this.stack.at(-1)?.tag === "th") this.stack.pop();
    }
    this.budget.add("nodes");
    if (!voidTags.has(name) && !selfClosing) this.budget.check(this.stack.length, this.budget.limits.maxDepth, "depth");
    const node: HtmlNode = { tag: name, attributes, children: [] };
    this.stack.at(-1)!.children.push(node);
    if (!voidTags.has(name) && !selfClosing) this.stack.push(node);
    if (!selfClosing && ["title", "textarea", "xmp", "iframe", "noembed", "noframes", "plaintext"].includes(name)) {
      this.mode = "raw"; this.rawName = name === "plaintext" ? "" : name;
      this.rawText = name === "title" || name === "textarea" ? "entities" : "literal";
    }
  }

  feed(text: string): void {
    for (const character of text) {
      this.budget.work(character.length);
      if (this.mode === "raw") {
        this.rawCharacter(character);
        continue;
      }
      if (this.mode === "text" && character === "<") {
        this.flushText(true); this.mode = "tag"; this.buffer = "<"; this.bufferBytes = 1; continue;
      }
      const bytes = Buffer.byteLength(character);
      if (this.mode === "text" && bytes > this.budget.limits.maxTokenBytes - this.bufferBytes) this.flushText(true);
      this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.bufferBytes, "token bytes");
      this.bufferBytes += bytes;
      if (this.mode === "comment") {
        this.buffer = (this.buffer + character).slice(-3);
        if (this.buffer === "-->") { this.budget.add("tokens"); this.mode = "text"; this.buffer = ""; this.bufferBytes = 0; }
        continue;
      }
      this.buffer += character;
      if (this.mode === "text") { if (this.bufferBytes >= 4096) this.flushText(false); continue; }
      if (this.buffer === "<!--") { this.mode = "comment"; this.buffer = ""; continue; }
      if (this.quote) { if (character === this.quote) this.quote = ""; continue; }
      if (character === '"' || character === "'") { this.quote = character; continue; }
      if (character === ">") {
        const raw = this.buffer; this.buffer = ""; this.bufferBytes = 0; this.mode = "text"; this.tag(raw);
      } else if (character === "<") {
        this.appendText(this.buffer.slice(0, -1)); this.buffer = "<"; this.bufferBytes = 1;
      }
    }
  }

  finish(): HtmlNode {
    if (this.mode === "text") this.flushText(true);
    else if (this.mode === "tag") this.appendText(this.buffer);
    else if (this.mode === "comment") this.budget.add("tokens");
    else if (this.mode === "raw" && this.rawText !== "drop") { this.rawContent(this.rawCandidate); this.flushText(true, this.rawText === "entities"); }
    this.buffer = ""; this.stack.length = 1;
    return this.root;
  }
}
