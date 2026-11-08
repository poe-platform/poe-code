import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import type { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { HtmlBudget } from "./contracts.js";
import { DocumentStore } from "./document-store.js";
import { asciiLower, decodeEntities, htmlSpace } from "./entities.js";
import { namedEntities } from "./entity-data.js";
import { HtmlTokenFramer } from "./token-framer.js";
import { StoredQueries } from "./stored-selectors.js";

export type StoredHtmlToken =
  | { kind: "text" | "comment" | "doctype"; data: number }
  | { kind: "start" | "end"; name: number; attributes: number; selfClosing: boolean };

/** Only a bounded lookahead and one text leaf survive a cursor advance. */
class Cursor {
  private buffer = "";
  private ended = false;
  position = 0;
  constructor(private readonly source: AsyncIterator<string>) {}
  async peek(count = 1): Promise<string> {
    while (!this.ended && this.buffer.length < count) {
      const next = await this.source.next();
      if (next.done) this.ended = true;
      else this.buffer += next.value;
    }
    return this.buffer.slice(0, count);
  }
  async window(): Promise<string> { await this.peek(); return this.buffer; }
  advance(count: number): void { this.buffer = this.buffer.slice(count); this.position += count; }
  async skip(test: (c: string) => boolean): Promise<void> {
    for (;;) {
      const window = await this.window(); let end = 0;
      while (end < window.length && test(window[end]!)) end++;
      this.advance(end);
      if (end < window.length || !window) return;
    }
  }
}

/** Hash buckets and collision chains are caller-backed; no attribute-name Set. */
export class StoredNames {
  private readonly table: IntegerTable;
  constructor(private readonly storage: PagedStorage, private readonly text: TextStore, private readonly queries: StoredQueries) {
    this.table = new IntegerTable(storage, 64);
  }
  async add(name: number): Promise<boolean> {
    let hash = 2166136261;
    for await (const chunk of this.text.chunks(name)) {
      this.queries.budget.charge("work", chunk.length);
      for (let i = 0; i < chunk.length; i++) hash = Math.imul(hash ^ chunk.charCodeAt(i), 16777619) >>> 0;
    }
    const key = BigInt(hash), first = Number(await this.table.get(key) ?? 0n);
    for (let id = first; id;) {
      const bytes = await this.storage.read(id, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (await this.queries.equal(name, view.getFloat64(8, true))) return false;
      id = view.getFloat64(0, true);
    }
    const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
    view.setFloat64(0, first, true); view.setFloat64(8, name, true);
    await this.table.set(key, BigInt(await this.storage.append(bytes)));
    return true;
  }
}

export class StoredHtmlTokenizer extends HtmlTokenFramer<number, StoredHtmlToken> {
  constructor(source: AsyncIterable<string>, budget: HtmlBudget, tree: DocumentStore, text: TextStore, storage: PagedStorage) {
    super(source, budget, () => text.builder(), (root, raw, foreign) => decode(root, raw, foreign, budget, tree, text, storage));
  }
}

async function decode(root: number, raw: string | undefined, foreign: boolean, budget: HtmlBudget, tree: DocumentStore, text: TextStore, storage: PagedStorage): Promise<StoredHtmlToken | undefined> {
  const length = (await text.info(root)).length;
  budget.charge("work", length * 2);
  const cursor = new Cursor(text.chunks(root));
  const queries = new StoredQueries(tree, text, storage, budget);
  const finish = (token: StoredHtmlToken): StoredHtmlToken => {
    budget.bound("tokenBytes", length * 2); budget.charge("work", length + 1); return token;
  };
  const transformed = async (start: number, end: number, replacement: string, lower = false, entities = false, attribute = false): Promise<number> => {
    budget.charge("work", (end - start) * 33);
    async function* chunks() {
      for await (const chunk of text.chunks(await text.slice(root, start, end))) {
        const clean = chunk.replaceAll("\0", replacement);
        yield lower ? asciiLower(clean) : clean;
      }
    }
    const builder = text.builder();
    if (!entities) { for await (const chunk of chunks()) await builder.write(chunk); }
    else {
      const input = new Cursor(chunks());
      while (await input.peek()) {
        const window = await input.window(), amp = window.indexOf("&");
        if (amp !== 0) { const count = amp < 0 ? window.length : amp; await builder.write(window.slice(0, count)); input.advance(count); continue; }
        const look = await input.peek(34);
        if (look[1] === "#") {
          const hex = asciiLower(look[2] ?? "") === "x", prefix = hex ? 3 : 2;
          const digit = (c: string): number => { const n = c.charCodeAt(0); return n >= 48 && n <= 57 ? n - 48 : hex && n >= 65 && n <= 70 ? n - 55 : hex && n >= 97 && n <= 102 ? n - 87 : -1; };
          if (digit(look[prefix] ?? "") >= 0) {
            input.advance(prefix); let n = 0;
            for (;;) {
              const part = await input.window(); let at = 0;
              while (at < part.length && digit(part[at]!) >= 0) { n = Math.min(0x110000, n * (hex ? 16 : 10) + digit(part[at]!)); at++; }
              input.advance(at);
              if (!part || at < part.length) break;
            }
            if (await input.peek() === ";") input.advance(1);
            await builder.write(decodeEntities(`&#${n};`, false)); continue;
          }
        } else {
          let found = "";
          for (let end = 2; end <= Math.min(33, look.length); end++) {
            const key = look.slice(1, end); if (Object.hasOwn(namedEntities, key)) found = key;
          }
          const next = look[found.length + 1] ?? "", code = next.charCodeAt(0);
          if (found && !(attribute && !found.endsWith(";") && (next === "=" || code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122))) {
            await builder.write(namedEntities[found]!); input.advance(found.length + 1); continue;
          }
        }
        await builder.write("&"); input.advance(1);
      }
    }
    return builder.finish();
  };
  const prefix = await cursor.peek(10);
  // The framer passes raw only for text; closing tags arrive as markup.
  if (raw)
    return finish({ kind: "text", data: await transformed(0, length, "\ufffd", false, raw === "title" || raw === "textarea") });
  if (!prefix.startsWith("<")) return finish({ kind: "text", data: await transformed(0, length, foreign ? "\ufffd" : "", false, true) });
  if (foreign && prefix.startsWith("<![CDATA[")) {
    let suffix = ""; for await (const part of text.chunks(await text.slice(root, Math.max(0, length - 3)))) suffix += part;
    return finish({ kind: "text", data: await transformed(9, suffix === "]]>" ? length - 3 : length, "\ufffd") });
  }
  if (prefix.startsWith("<!--")) {
    cursor.advance(4); const builder = text.builder();
    let state: "start" | "startDash" | "data" | "dash" | "end" | "bang" = "start";
    while (await cursor.peek()) {
      if (state === "data") {
        const window = await cursor.window(), dash = window.indexOf("-");
        if (dash !== 0) { const count = dash < 0 ? window.length : dash; budget.charge("work", count); await builder.write(window.slice(0, count).replaceAll("\0", "\ufffd")); cursor.advance(count); continue; }
      }
      const c = await cursor.peek(); cursor.advance(1); budget.charge("work", 1);
      const clean = c === "\0" ? "\ufffd" : c;
      if (state === "start") {
        if (c === "-") state = "startDash"; else if (c === ">") break;
        else { await builder.write(clean); state = "data"; }
      } else if (state === "startDash" || state === "dash") {
        if (c === "-") state = "end"; else if (c === ">" && state === "startDash") break;
        else { await builder.write("-" + clean); state = "data"; }
      } else if (state === "data") state = "dash";
      else if (state === "end") {
        if (c === ">") break; else if (c === "!") state = "bang";
        else if (c === "-") await builder.write("-");
        else { await builder.write("--" + clean); state = "data"; }
      } else {
        if (c === ">") break;
        if (c === "-") { await builder.write("--!"); state = "dash"; }
        else { await builder.write("--!" + clean); state = "data"; }
      }
    }
    return finish({ kind: "comment", data: await builder.finish() });
  }
  if (asciiLower(prefix.slice(0, 9)) === "<!doctype") {
    cursor.advance(9); await cursor.skip(c => c.trim() === "");
    const start = cursor.position;
    let nameEnd = length, trimmedEnd = start;
    while (await cursor.peek() && await cursor.peek() !== ">") {
      const window = await cursor.window(); let at = 0;
      while (at < window.length && window[at] !== ">") {
        const c = window[at]!;
        if (htmlSpace(c) && nameEnd === length) nameEnd = cursor.position + at;
        if (c.trim() !== "") trimmedEnd = cursor.position + at + 1;
        at++;
      }
      budget.charge("work", at); cursor.advance(at);
    }
    return finish({ kind: "doctype", data: await transformed(start, Math.min(nameEnd, trimmedEnd), "\0", true) });
  }

  cursor.advance(1);
  const closing = await cursor.peek() === "/";
  if (closing) cursor.advance(1);
  const initial = await cursor.peek(), code = initial.charCodeAt(0);
  if (closing && !initial) return finish({ kind: "text", data: await text.from("</") });
  if (closing && initial === ">") return finish({ kind: "text", data: 0 });
  if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122)) {
    if (initial === "!" || initial === "?" || closing) {
      await cursor.skip(c => c !== ">");
      return finish({ kind: "comment", data: await transformed(initial === "?" ? 1 : 2, cursor.position, "\ufffd") });
    }
    return finish({ kind: "text", data: await text.from("<") });
  }
  const start = cursor.position;
  await cursor.skip(c => !htmlSpace(c) && c !== "/" && c !== ">");
  const name = await transformed(start, cursor.position, "\ufffd", true);
  const attributes = await tree.create("fragment"), names = new StoredNames(storage, text, queries);
  let selfClosing = false, terminated = false;
  while (await cursor.peek()) {
    await cursor.skip(htmlSpace);
    const look = await cursor.peek(2);
    if (look.startsWith(">")) { terminated = true; cursor.advance(1); break; }
    if (look === "/>") { selfClosing = true; terminated = true; cursor.advance(2); break; }
    if (look.startsWith("/")) { cursor.advance(1); continue; }
    const start = cursor.position;
    if (look.startsWith("=")) cursor.advance(1);
    await cursor.skip(c => !htmlSpace(c) && c !== "=" && c !== ">" && c !== "/");
    const attr = await transformed(start, cursor.position, "\ufffd", true);
    await cursor.skip(htmlSpace);
    let value = 0;
    if (await cursor.peek() === "=") {
      cursor.advance(1); await cursor.skip(htmlSpace);
      const quote = await cursor.peek();
      if (quote === '"' || quote === "'") {
        cursor.advance(1); const start = cursor.position;
        await cursor.skip(c => c !== quote);
        value = await transformed(start, cursor.position, "\ufffd", false, true, true);
        if (await cursor.peek()) cursor.advance(1);
      } else {
        const start = cursor.position; await cursor.skip(c => !htmlSpace(c) && c !== ">");
        value = await transformed(start, cursor.position, "\ufffd", false, true, true);
      }
    }
    if (attr && !closing && await names.add(attr)) {
      budget.charge("attributes", 1); await tree.attribute(attributes, attr, value, "none");
    }
    if (cursor.position === start && await cursor.peek()) cursor.advance(1);
  }
  if (!terminated) return undefined;
  return finish({ kind: closing ? "end" : "start", name, attributes, selfClosing });
}
