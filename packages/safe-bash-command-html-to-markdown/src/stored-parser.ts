import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { utf8ByteLength } from "safe-bash-byte-engine";
import { entities } from "./entities.js";
import type { Budget } from "./budget.js";
import { blockTags, type HtmlNode } from "./parser.js";
import { TextStore, type TextBuilder } from "./stored-text.js";
import { StoredNames } from "./stored-names.js";
import type { StoredTree, StoredNode } from "./stored-tree.js";

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const alpha = (character: string): boolean => character >= "A" && character <= "Z" || character >= "a" && character <= "z";
const nameCharacter = (character: string): boolean => alpha(character) || character >= "0" && character <= "9" || character === ":" || character === "_" || character === "-";
const space = (character: string): boolean => character !== "" && /\s/u.test(character);

/** A forward cursor holds one decoded storage leaf, even for a very long tag. */
class TokenCursor {
  private readonly iterator: AsyncIterator<string>;
  private chunk = "";
  private index = 0;
  offset = 0;
  current = "";
  constructor(text: TextStore, root: number, private readonly end: number) { this.iterator = text.chunks(root)[Symbol.asyncIterator](); }
  async next(): Promise<void> {
    this.offset += this.current.length;
    this.index += this.current.length;
    this.current = "";
    if (this.offset >= this.end) return;
    if (this.index === this.chunk.length) {
      const next = await this.iterator.next();
      if (next.done) return;
      this.chunk = next.value; this.index = 0;
    }
    this.current = String.fromCodePoint(this.chunk.codePointAt(this.index)!);
  }
}

interface Frame { previous: number; name: number; node: number; same: number; depth: number }

/** The command parser stores unfinished tags, attribute names and open frames in
 * caller storage. Only ordinary text/entity windows and lexical flags stay live. */
export class StoredParser {
  private readonly text: TextStore;
  private readonly names: StoredNames;
  private readonly known = new Map<string, number>();
  private top = 0;
  private depth = 0;
  private parent: number;
  private mode: "text" | "tag" | "comment" | "raw" = "text";
  private buffer = "";
  private bufferBytes = 0;
  private token: TextBuilder | undefined;
  private tokenBytes = 0;
  private tokenPrefix = "";
  private quote = "";
  private attributeMode: "name" | "before-value" | "unquoted" = "name";
  private commentState: "start" | "start-dash" | "body" | "dash" | "end" | "bang" = "start";
  private rawName = "";
  private rawCandidate = "";
  private rawText: "drop" | "entities" | "literal" = "drop";

  constructor(private readonly budget: Budget, private readonly storage: PagedStorage, private readonly tree: StoredTree, root: number) {
    this.parent = root;
    this.text = new TextStore(storage, () => budget.checkpoint());
    this.names = new StoredNames(storage, this.text, work => { budget.work(work); return budget.checkpoint(); });
  }

  private async frame(position: number): Promise<Frame> {
    if (!position) return { previous: 0, name: 0, node: 0, same: 0, depth: 0 };
    const bytes = await this.storage.read(position, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { previous: view.getFloat64(0, true), name: view.getFloat64(8, true), node: view.getFloat64(16, true), same: view.getFloat64(24, true), depth: view.getFloat64(32, true) };
  }

  private async closeThrough(position: number): Promise<void> {
    if (!position) return;
    while (this.top) {
      this.budget.work(1);
      const checkpoint = this.budget.checkpoint(); if (checkpoint) await checkpoint;
      const current = this.top, frame = await this.frame(current);
      await this.names.set(frame.name, frame.same);
      this.parent = (await this.tree.read(frame.node)).parent;
      this.top = frame.previous; this.depth--;
      if (current === position) return;
    }
  }

  private async named(name: string): Promise<number> {
    let entry = this.known.get(name);
    if (entry === undefined) {
      entry = (await this.names.find(await this.text.from(name), true)).entry;
      this.known.set(name, entry);
    }
    return this.names.value(entry);
  }

  private async recover(name: string): Promise<void> {
    if (name === "a") await this.closeThrough(await this.named("a"));
    if (blockTags.has(name)) await this.closeThrough(await this.named("p"));
    const boundary = name === "li" ? ["ul", "ol"] : name === "tr" ? ["table", "thead", "tbody", "tfoot"] : name === "td" || name === "th" ? ["table", "thead", "tbody", "tfoot", "tr"] : [];
    if (!boundary.length) return;
    let stop = 0;
    for (const tag of boundary) stop = Math.max(stop, (await this.frame(await this.named(tag))).depth);
    const candidates = name === "li" ? ["li"] : name === "tr" ? ["tr"] : ["td", "th"];
    let latest = 0, depth = stop;
    for (const tag of candidates) {
      const position = await this.named(tag), candidate = await this.frame(position);
      if (candidate.depth > depth) { latest = position; depth = candidate.depth; }
    }
    await this.closeThrough(latest);
  }

  private async push(name: number, node: number): Promise<void> {
    const entry = (await this.names.find(name, true)).entry, same = await this.names.value(entry);
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    for (const [index, value] of [this.top, entry, node, same, this.depth + 1].entries()) view.setFloat64(index * 8, value, true);
    this.top = await this.storage.append(bytes);
    await this.names.set(entry, this.top);
    this.parent = node; this.depth++;
  }

  private async decoded(root: number, replaceNull = false): Promise<number> {
    const result = this.text.builder();
    let tail = "", bytes = 0;
    const append = async (part: string): Promise<void> => {
      let output = await entities(part, this.budget);
      if (replaceNull) output = output.replaceAll("\0", "\ufffd");
      bytes += utf8ByteLength(output);
      this.budget.check(bytes, this.budget.limits.maxOutputBytes - this.budget.output, "rendered bytes");
      await result.write(output);
    };
    for await (const chunk of this.text.chunks(root)) {
      const part = tail + chunk, ampersand = part.lastIndexOf("&");
      const end = ampersand >= 0 && part.length - ampersand <= 34 && !part.slice(ampersand).includes(";") ? ampersand : part.length;
      await append(part.slice(0, end)); tail = part.slice(end);
    }
    await append(tail);
    return result.finish();
  }

  /** Default Unicode lowercase has one contextual mapping: final sigma. Keep
   * intervening case-ignorable characters in storage while deciding its form. */
  private async lowerName(root: number): Promise<number> {
    const result = this.text.builder();
    let casedBefore = false, sigma = false, delayed = this.text.builder();
    for await (const character of this.text.characters(root)) {
      this.budget.work(character.length);
      const ignorable = /\p{Case_Ignorable}/u.test(character), cased = /\p{Cased}/u.test(character);
      if (sigma && !ignorable) {
        await result.write(cased ? "σ" : "ς");
        await result.append(await delayed.finish());
        delayed = this.text.builder(); sigma = false;
      }
      if (sigma) await delayed.write(character.toLowerCase());
      else if (character === "Σ" && casedBefore) sigma = true;
      else await result.write(character.toLowerCase());
      if (!ignorable) casedBefore = cased;
    }
    if (sigma) { await result.write("ς"); await result.append(await delayed.finish()); }
    return result.finish();
  }

  private async literal(root: number): Promise<void> {
    if (!root) return;
    this.budget.add("tokens"); this.budget.add("nodes");
    await this.tree.append(this.parent, await this.tree.create("text", { parent: this.parent, text: await this.decoded(root, true) }));
  }

  private async appendText(text: string, decode = true): Promise<void> {
    if (!text) return;
    this.budget.add("tokens"); this.budget.add("nodes");
    const value = (decode ? await entities(text, this.budget) : text).replaceAll("\0", "\ufffd");
    await this.tree.append(this.parent, await this.tree.create("text", { parent: this.parent, text: await this.text.from(value) }));
  }

  private async flushText(final: boolean, decode = true): Promise<void> {
    let end = this.buffer.length;
    if (!final && decode) {
      const ampersand = this.buffer.lastIndexOf("&");
      if (ampersand >= 0 && end - ampersand <= 34 && !this.buffer.slice(ampersand).includes(";")) end = ampersand;
    }
    await this.appendText(this.buffer.slice(0, end), decode);
    this.buffer = this.buffer.slice(end); this.bufferBytes = utf8ByteLength(this.buffer);
  }

  private async startToken(prefix: string): Promise<void> {
    this.token = this.text.builder(); await this.token.write(prefix);
    this.tokenBytes = utf8ByteLength(prefix); this.tokenPrefix = prefix.slice(0, 5);
    this.mode = "tag"; this.attributeMode = "name"; this.quote = "";
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
    if (character === "<") { await this.rawContent(this.rawCandidate); this.rawCandidate = "<"; }
    else if (this.rawCandidate) {
      if (this.rawCandidate.length >= target.length && character === ">") {
        this.budget.add("tokens"); await this.flushText(true, this.rawText === "entities");
        if (this.rawText !== "drop") await this.closeThrough(await this.named(this.rawName));
        this.rawCandidate = ""; this.mode = "text";
      } else if (this.rawCandidate.length === target.length && (character === "/" || /[\t\r\n\f ]/u.test(character))) {
        await this.flushText(true, this.rawText === "entities");
        this.budget.check(1, this.budget.limits.maxTokenBytes - utf8ByteLength(this.rawCandidate), "token bytes");
        await this.startToken(this.rawCandidate + character); this.rawCandidate = "";
      } else if (this.rawCandidate.length < target.length && target.startsWith((this.rawCandidate + character).toLowerCase())) {
        this.budget.check(utf8ByteLength(character), this.budget.limits.maxTokenBytes - utf8ByteLength(this.rawCandidate), "token bytes");
        this.rawCandidate += character;
      } else { await this.rawContent(this.rawCandidate); await this.rawContent(character); this.rawCandidate = ""; }
    } else await this.rawContent(character);
  }

  private async tag(root: number): Promise<void> {
    const length = (await this.text.info(root)).length;
    this.budget.add("tokens"); this.budget.work(length);
    const cursor = new TokenCursor(this.text, root, length - 1);
    await cursor.next(); await cursor.next();
    if (cursor.current === "!" || cursor.current === "?") return;
    const closing = cursor.current === "/";
    if (closing) await cursor.next();
    if (!alpha(cursor.current)) { await this.literal(root); return; }
    const name = this.text.builder(); let shortName = "";
    while (cursor.current && nameCharacter(cursor.current)) {
      this.budget.work(cursor.current.length);
      const lower = cursor.current.toLowerCase();
      await name.write(lower); if (shortName.length < 16) shortName += lower;
      await cursor.next();
    }
    if (cursor.current && !"\t\n\r\f /".includes(cursor.current)) { await this.literal(root); return; }
    const nameRoot = await name.finish();
    if (closing) { await this.closeThrough(await this.names.value((await this.names.find(nameRoot)).entry)); return; }
    const attributes = new StoredNames(this.storage, this.text, work => { this.budget.work(work); return this.budget.checkpoint(); }), values: Partial<StoredNode> = { parent: this.parent };
    let lastContent = length - 2;
    outer: for await (const chunk of this.text.chunks(await this.text.slice(root, 0, length - 1), true)) for (let index = chunk.length - 1; index >= 0; index--) {
      if (!space(chunk[index]!)) break outer;
      this.budget.work(1); lastContent--;
    }
    let count = 0, selfClosing = false;
    while (cursor.current) {
      this.budget.work(1);
      while (space(cursor.current)) { this.budget.work(1); await cursor.next(); }
      if (!cursor.current) break;
      if (cursor.current === "/" && cursor.offset === lastContent) { selfClosing = true; break; }
      this.budget.check(++count, this.budget.limits.maxAttributes, "attributes");
      const key = this.text.builder(); let keyLength = 0, smallKey = "";
      while (cursor.current && !space(cursor.current) && !"=/>".includes(cursor.current)) {
        this.budget.work(1);
        const lower = cursor.current.toLowerCase(); await key.write(cursor.current); keyLength++;
        if (smallKey.length < 16) smallKey += lower;
        await cursor.next();
      }
      if (!keyLength) { await cursor.next(); continue; }
      while (space(cursor.current)) { this.budget.work(1); await cursor.next(); }
      let value = 0;
      if (String(cursor.current) === "=") {
        await cursor.next();
        while (space(cursor.current)) { this.budget.work(1); await cursor.next(); }
        const current = String(cursor.current);
        const quote = current === '"' || current === "'" ? current : "";
        if (quote) await cursor.next();
        const start = cursor.offset;
        while (cursor.current && (quote ? cursor.current !== quote : !space(cursor.current))) { this.budget.work(1); await cursor.next(); }
        value = await this.text.slice(root, start, cursor.offset);
        if (quote && cursor.current === quote) await cursor.next();
      }
      if ((await attributes.find(await this.lowerName(await key.finish()), true)).fresh) {
        const decoded = await this.decoded(value);
        if (["href", "src", "alt", "class", "start"].includes(smallKey)) values[smallKey === "class" ? "className" : smallKey as "href" | "src" | "alt" | "start"] = decoded;
      }
    }
    if (shortName === "script" || shortName === "style") { this.mode = "raw"; this.rawName = shortName; this.rawText = "drop"; return; }
    await this.recover(shortName);
    this.budget.add("nodes");
    if (!voidTags.has(shortName) && !selfClosing) this.budget.check(this.depth + 1, this.budget.limits.maxDepth, "depth");
    const node = await this.tree.create(shortName, { ...values, parent: this.parent });
    await this.tree.append(this.parent, node);
    if (!voidTags.has(shortName) && !selfClosing) await this.push(nameRoot, node);
    if (!selfClosing && ["title", "textarea", "xmp", "iframe", "noembed", "noframes", "plaintext"].includes(shortName)) {
      this.mode = "raw"; this.rawName = shortName === "plaintext" ? "" : shortName;
      this.rawText = shortName === "title" || shortName === "textarea" ? "entities" : "literal";
    }
  }

  async feed(text: string): Promise<void> {
    for (let offset = 0; offset < text.length;) {
      if (this.mode === "text") {
        const maximum = Math.min(text.length, offset + 4096 - this.bufferBytes, offset + this.budget.limits.maxTokenBytes - this.bufferBytes);
        let end = offset;
        while (end < maximum && text.charCodeAt(end) < 0x80 && text[end] !== "<") end++;
        if (end > offset) {
          this.budget.work(end - offset); this.bufferBytes += end - offset; this.buffer += text.slice(offset, end); offset = end;
          if (this.bufferBytes >= 4096) await this.flushText(false);
          const checkpoint = this.budget.checkpoint(); if (checkpoint) await checkpoint;
          continue;
        }
      }
      const character = String.fromCodePoint(text.codePointAt(offset)!); offset += character.length;
      this.budget.work(character.length);
      const checkpoint = this.budget.checkpoint(); if (checkpoint) await checkpoint;
      if (this.mode === "raw") { await this.rawCharacter(character); continue; }
      if (this.mode === "comment") {
        const state = this.commentState;
        if (character === ">" && (state === "start" || state === "start-dash" || state === "end" || state === "bang")) { this.budget.add("tokens"); this.mode = "text"; }
        else if (character === "-") this.commentState = state === "start" ? "start-dash" : state === "start-dash" || state === "dash" || state === "end" ? "end" : "dash";
        else this.commentState = character === "!" && state === "end" ? "bang" : "body";
        continue;
      }
      if (this.mode === "tag" && (this.tokenPrefix === "<" && !alpha(character) && !"/?!".includes(character) || this.tokenPrefix === "</" && !alpha(character))) {
        this.buffer = this.tokenPrefix; this.bufferBytes = this.tokenBytes; this.token = undefined; this.mode = "text";
      }
      if (this.mode === "text") {
        if (character === "<") { await this.flushText(true); await this.startToken("<"); continue; }
        const bytes = utf8ByteLength(character);
        if (bytes > this.budget.limits.maxTokenBytes - this.bufferBytes) await this.flushText(false);
        this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.bufferBytes, "token bytes");
        this.bufferBytes += bytes; this.buffer += character;
        if (this.bufferBytes >= 4096) await this.flushText(false);
        continue;
      }
      const bytes = utf8ByteLength(character);
      this.budget.check(bytes, this.budget.limits.maxTokenBytes - this.tokenBytes, "token bytes");
      this.tokenBytes += bytes; await this.token!.write(character);
      if (this.tokenPrefix.length < 5) this.tokenPrefix += character;
      if (this.tokenPrefix === "<!--") { this.mode = "comment"; this.commentState = "start"; this.token = undefined; this.tokenBytes = 0; continue; }
      if (this.quote) { if (character === this.quote) this.quote = ""; continue; }
      if (this.attributeMode === "before-value") {
        if (space(character)) continue;
        this.attributeMode = "unquoted";
        if (character === '"' || character === "'") { this.quote = character; this.attributeMode = "name"; continue; }
      } else if (this.attributeMode === "unquoted") { if (space(character)) this.attributeMode = "name"; }
      else if (character === "=") this.attributeMode = "before-value";
      if (character === ">") {
        const root = await this.token!.finish(); this.token = undefined; this.tokenBytes = 0; this.mode = "text";
        await this.tag(root);
      } else if (character === "<") {
        const root = await this.token!.finish();
        await this.literal(await this.text.slice(root, 0, (await this.text.info(root)).length - 1));
        await this.startToken("<");
      }
    }
  }

  async finish(): Promise<HtmlNode> {
    if (this.mode === "text") await this.flushText(true);
    else if (this.mode === "tag") await this.literal(await this.token!.finish());
    else if (this.mode === "comment") this.budget.add("tokens");
    else if (this.mode === "raw" && this.rawText !== "drop") { await this.rawContent(this.rawCandidate); await this.flushText(true, this.rawText === "entities"); }
    this.buffer = ""; this.token = undefined;
    // No in-memory ancestry is retained, and the document is already in tree.
    return { tag: "root", attributes: new Map(), children: [] };
  }
}
