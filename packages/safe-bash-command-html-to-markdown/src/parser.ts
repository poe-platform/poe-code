import { utf8ByteLength } from "safe-bash-byte-engine";
import { entities } from "./entities.js";
import type { Budget } from "./budget.js";

export interface HtmlNode {
  readonly tag: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: HtmlNode[];
  readonly text?: string;
}

/** Repaired parser events. A sink is awaited and owns any state it retains. */
export type HtmlEvent =
  | { readonly type: "open"; readonly tag: string; readonly attributes: ReadonlyMap<string, string> }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "close"; readonly tag: string };
export type HtmlEventSink = (event: HtmlEvent) => void | Promise<void>;

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
export const blockTags = new Set(["address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);

export class Parser {
  readonly root: HtmlNode = { tag: "root", attributes: new Map(), children: [] };
  private readonly stack: HtmlNode[] = [this.root];
  private mode: "text" | "tag" | "comment" | "raw" = "text";
  private buffer = "";
  private bufferBytes = 0;
  private commentState: "start" | "start-dash" | "body" | "dash" | "end" | "bang" = "start";
  private quote = "";
  private attributeMode: "name" | "before-value" | "unquoted" = "name";
  private rawName = "";
  private rawCandidate = "";
  private rawCandidateBytes = 0;
  private rawText: "drop" | "entities" | "literal" = "drop";
  /** Supplying a sink disables tree retention; root remains empty. */
  constructor(readonly budget: Budget, private readonly sink?: HtmlEventSink) {}

  private async emit(event: HtmlEvent): Promise<void> {
    this.budget.context.signal.throwIfAborted();
    await this.sink!(event);
    this.budget.context.signal.throwIfAborted();
  }

  private async closeTo(length: number): Promise<void> {
    while (this.stack.length > length) {
      const node = this.stack.pop()!;
      if (this.sink) await this.emit({ type: "close", tag: node.tag });
    }
  }

  private async appendText(text: string, decode = true): Promise<void> {
    if (!text) return;
    this.budget.add("tokens"); this.budget.add("nodes");
    const decoded = (decode ? await entities(text, this.budget) : text).replaceAll("\0", "\ufffd");
    if (this.sink) await this.emit({ type: "text", text: decoded });
    else this.stack.at(-1)!.children.push({ tag: "text", attributes: new Map(), children: [], text: decoded });
  }

  private async flushText(final: boolean, decode = true): Promise<void> {
    let end = this.buffer.length;
    if (!final && decode) {
      const ampersand = this.buffer.lastIndexOf("&");
      if (ampersand >= 0 && end - ampersand <= 34 && !this.buffer.slice(ampersand).includes(";")) end = ampersand;
    }
    await this.appendText(this.buffer.slice(0, end), decode);
    this.buffer = this.buffer.slice(end);
    this.bufferBytes = utf8ByteLength(this.buffer);
  }

  private async rawContent(text: string): Promise<void> {
    if (this.rawText === "drop") return;
    for (const character of text) {
      this.budget.work(character.length);
      const bytes = utf8ByteLength(character);
      if (bytes > this.budget.limits.maxTokenBytes - this.bufferBytes) await this.flushText(false, this.rawText === "entities");
      this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.bufferBytes, "token bytes");
      this.bufferBytes += bytes; this.buffer += character;
      if (this.bufferBytes >= 4096) await this.flushText(false, this.rawText === "entities");
    }
  }

  private async rawCharacter(character: string): Promise<void> {
    if (!this.rawName) { await this.rawContent(character); return; }
    const target = `</${this.rawName}`;
    if (character === "<") {
      await this.rawContent(this.rawCandidate); this.rawCandidate = "<"; this.rawCandidateBytes = 1;
    } else if (this.rawCandidate) {
      if (this.rawCandidate.length >= target.length && character === ">") {
        this.budget.add("tokens"); await this.flushText(true, this.rawText === "entities");
        if (this.rawText !== "drop") await this.pop(this.rawName);
        this.rawCandidate = ""; this.rawCandidateBytes = 0; this.mode = "text";
      } else if (this.rawCandidate.length === target.length && (character === "/" || /[\t\r\n\f ]/u.test(character))) {
        await this.flushText(true, this.rawText === "entities");
        this.budget.check(1, this.budget.limits.maxTokenBytes - this.rawCandidateBytes, "token bytes");
        this.buffer = this.rawCandidate + character; this.bufferBytes = this.rawCandidateBytes + 1;
        this.rawCandidate = ""; this.rawCandidateBytes = 0;
        this.mode = "tag"; this.attributeMode = "name"; this.quote = "";
      } else if (this.rawCandidate.length < target.length && target.startsWith((this.rawCandidate + character).toLowerCase())) {
        const bytes = utf8ByteLength(character);
        this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.rawCandidateBytes, "token bytes");
        this.rawCandidateBytes += bytes; this.rawCandidate += character;
      } else {
        await this.rawContent(this.rawCandidate); await this.rawContent(character); this.rawCandidate = ""; this.rawCandidateBytes = 0;
      }
    } else await this.rawContent(character);
  }

  private async pop(name: string): Promise<void> {
    for (let index = this.stack.length - 1; index > 0; index--) {
      if (this.stack[index]!.tag === name) { await this.closeTo(index); return; }
    }
  }

  private async tag(raw: string): Promise<void> {
    this.budget.add("tokens"); this.budget.work(raw.length);
    if (raw.length >= 4 && raw.charCodeAt(0) === 60 && raw.charCodeAt(1) === 47 && raw.charCodeAt(raw.length - 1) === 62) {
      let simpleClose = true;
      for (let i = 2; i < raw.length - 1; i++) {
        const c = raw.charCodeAt(i);
        const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (i > 2 && ((c >= 48 && c <= 57) || c === 58 || c === 95 || c === 45));
        if (!ok) { simpleClose = false; break; }
      }
      if (simpleClose) {
        await this.pop(raw.slice(2, -1).toLowerCase());
        return;
      }
    }
    if (/^<!|^<\?/u.test(raw)) return;
    const match = /^<(\/)?([A-Za-z][A-Za-z0-9:_-]*)([\s\S]*)>$/u.exec(raw);
    if (!match || match[3] && !/^[\t\n\r\f /]/u.test(match[3])) { await this.appendText(raw); return; }
    const name = match[2]!.toLowerCase();
    if (match[1]) { await this.pop(name); return; }
    const tail = match[3]!, attributes = new Map<string, string>();
    let lastContent = tail.length - 1;
    while (lastContent >= 0 && /\s/u.test(tail[lastContent]!)) { this.budget.work(1); lastContent--; { const c = this.budget.checkpoint(); if (c) await c; } }
    let position = 0, count = 0, selfClosing = false;
    while (position < tail.length) {
      this.budget.work(1);
      while (/\s/u.test(tail[position] ?? "") && position < tail.length) { this.budget.work(1); position++; { const c = this.budget.checkpoint(); if (c) await c; } }
      if (position === tail.length) break;
      if (tail[position] === "/" && position === lastContent) { selfClosing = true; break; }
      this.budget.check(++count, this.budget.limits.maxAttributes, "attributes");
      const start = position;
      while (position < tail.length && !/[\s=/>]/u.test(tail[position]!)) { this.budget.work(1); position++; { const c = this.budget.checkpoint(); if (c) await c; } }
      if (position === start) { position++; continue; }
      const key = tail.slice(start, position).toLowerCase();
      while (position < tail.length && /\s/u.test(tail[position]!)) { this.budget.work(1); position++; { const c = this.budget.checkpoint(); if (c) await c; } }
      let value = "";
      if (tail[position] === "=") {
        position++;
        while (position < tail.length && /\s/u.test(tail[position]!)) { this.budget.work(1); position++; { const c = this.budget.checkpoint(); if (c) await c; } }
        const quote = tail[position] === '"' || tail[position] === "'" ? tail[position++]! : "";
        const startValue = position;
        while (position < tail.length && (quote ? tail[position] !== quote : !/\s/u.test(tail[position]!))) { this.budget.work(1); position++; { const c = this.budget.checkpoint(); if (c) await c; } }
        value = tail.slice(startValue, position);
        if (quote && tail[position] === quote) position++;
      }
      if (!attributes.has(key)) attributes.set(key, await entities(value, this.budget));
    }
    if (name === "script" || name === "style") { this.mode = "raw"; this.rawName = name; this.rawText = "drop"; return; }
    if (name === "a") await this.pop("a");
    if (blockTags.has(name)) await this.pop("p");
    if (name === "li") {
      for (let index = this.stack.length - 1; index > 0; index--) {
        if (this.stack[index]!.tag === "ul" || this.stack[index]!.tag === "ol") break;
        if (this.stack[index]!.tag === "li") { await this.closeTo(index); break; }
      }
    }
    if (name === "tr" || name === "td" || name === "th") {
      for (let index = this.stack.length - 1; index > 0; index--) {
        const tag = this.stack[index]!.tag;
        if (["table", "thead", "tbody", "tfoot"].includes(tag)) break;
        if (name !== "tr" && tag === "tr") break;
        if (name === "tr" ? tag === "tr" : tag === "td" || tag === "th") {
          await this.closeTo(index); break;
        }
      }
    }
    this.budget.add("nodes");
    if (!voidTags.has(name) && !selfClosing) this.budget.check(this.stack.length, this.budget.limits.maxDepth, "depth");
    // Event mode keeps only the open-element names, never their attributes or descendants.
    const node: HtmlNode = { tag: name, attributes: this.sink ? new Map() : attributes, children: [] };
    if (this.sink) await this.emit({ type: "open", tag: name, attributes });
    else this.stack.at(-1)!.children.push(node);
    if (!voidTags.has(name) && !selfClosing) this.stack.push(node);
    else if (this.sink) await this.emit({ type: "close", tag: name });
    if (!selfClosing && ["title", "textarea", "xmp", "iframe", "noembed", "noframes", "plaintext"].includes(name)) {
      this.mode = "raw"; this.rawName = name === "plaintext" ? "" : name;
      this.rawText = name === "title" || name === "textarea" ? "entities" : "literal";
    }
  }

  async feed(text: string): Promise<void> {
    for (let offset = 0; offset < text.length;) {
      if (this.mode === "text") {
        const maximum = Math.min(text.length, offset + 4096 - this.bufferBytes,
          offset + this.budget.limits.maxTokenBytes - this.bufferBytes);
        let end = offset;
        while (end < maximum) {
          const code = text.charCodeAt(end);
          if (code >= 0x80 || code === 60) break;
          end++;
        }
        if (end > offset) {
          this.budget.work(end - offset);
          this.bufferBytes += end - offset;
          this.buffer += text.slice(offset, end);
          offset = end;
          if (this.bufferBytes >= 4096) await this.flushText(false);
          { const checkpoint = this.budget.checkpoint(); if (checkpoint) await checkpoint; }
          continue;
        }
        if (text[offset] === "<" && offset + 2 < text.length) {
          const c1 = text.charCodeAt(offset + 1);
          const isAlpha = (c1 >= 65 && c1 <= 90) || (c1 >= 97 && c1 <= 122);
          const c2 = text.charCodeAt(offset + 2);
          const isCloseAlpha = c1 === 47 && ((c2 >= 65 && c2 <= 90) || (c2 >= 97 && c2 <= 122));
          if (isAlpha || isCloseAlpha) {
            const gt = text.indexOf(">", offset + 2);
            if (gt > offset + 1 && gt - offset + 1 <= this.budget.limits.maxTokenBytes) {
              let cleanTag = true;
              for (let i = offset + 1; i < gt; i++) {
                const code = text.charCodeAt(i);
                if (code >= 0x80 || code === 60 || code === 34 || code === 39) { cleanTag = false; break; }
              }
              if (cleanTag) {
                if (this.buffer) await this.flushText(true);
                const raw = text.slice(offset, gt + 1);
                this.budget.work(raw.length);
                this.budget.check(raw.length, this.budget.limits.maxTokenBytes, "token bytes");
                offset = gt + 1;
                await this.tag(raw);
                continue;
              }
            }
          }
        }
      }
      const cp = text.codePointAt(offset)!;
      const character = cp > 0xffff ? String.fromCodePoint(cp) : text[offset]!;
      offset += character.length;
      this.budget.work(character.length);
      if (this.mode === "raw") {
        await this.rawCharacter(character);
        continue;
      }
      if (this.mode === "comment") {
        const state = this.commentState;
        if (character === ">" && (state === "start" || state === "start-dash" || state === "end" || state === "bang")) {
          this.budget.add("tokens"); this.mode = "text";
        } else if (character === "-") {
          this.commentState = state === "start" ? "start-dash" : state === "start-dash" || state === "dash" || state === "end" ? "end" : "dash";
        } else this.commentState = character === "!" && state === "end" ? "bang" : "body";
        continue;
      }
      if (this.mode === "tag" && (this.buffer === "<" && !/[A-Za-z/?!]/u.test(character)
        || this.buffer === "</" && !/[A-Za-z]/u.test(character))) this.mode = "text";
      if (this.mode === "text" && character === "<") {
        await this.flushText(true); this.mode = "tag"; this.attributeMode = "name"; this.buffer = "<"; this.bufferBytes = 1; continue;
      }
      const bytes = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (this.mode === "text" && bytes > this.budget.limits.maxTokenBytes - this.bufferBytes) await this.flushText(false);
      this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.bufferBytes, "token bytes");
      this.bufferBytes += bytes;
      this.buffer += character;
      if (this.mode === "text") { if (this.bufferBytes >= 4096) await this.flushText(false); continue; }
      if (this.buffer === "<!--") { this.mode = "comment"; this.commentState = "start"; this.buffer = ""; this.bufferBytes = 0; continue; }
      if (this.quote) { if (character === this.quote) this.quote = ""; continue; }
      if (this.attributeMode === "before-value") {
        if (/\s/u.test(character)) continue;
        this.attributeMode = "unquoted";
        if (character === '"' || character === "'") { this.quote = character; this.attributeMode = "name"; continue; }
      } else if (this.attributeMode === "unquoted") {
        if (/\s/u.test(character)) this.attributeMode = "name";
      } else if (character === "=") this.attributeMode = "before-value";
      if (character === ">") {
        const raw = this.buffer; this.buffer = ""; this.bufferBytes = 0; this.mode = "text"; await this.tag(raw);
      } else if (character === "<") {
        await this.appendText(this.buffer.slice(0, -1)); this.attributeMode = "name"; this.buffer = "<"; this.bufferBytes = 1;
      }
    }
  }

  async finish(): Promise<HtmlNode> {
    if (this.mode === "text") await this.flushText(true);
    else if (this.mode === "tag") await this.appendText(this.buffer);
    else if (this.mode === "comment") this.budget.add("tokens");
    else if (this.mode === "raw" && this.rawText !== "drop") { await this.rawContent(this.rawCandidate); await this.flushText(true, this.rawText === "entities"); }
    this.buffer = ""; await this.closeTo(1);
    return this.root;
  }
}
