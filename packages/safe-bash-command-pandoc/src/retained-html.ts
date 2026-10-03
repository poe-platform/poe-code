import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {readJsonNumber} from "./json-number.js";
import {PandocError} from "./errors.js";

type Job = {
  op: string; node: number; path: number; mode?: string; cursor?: number; index?: number;
  value?: string; columns?: number; columnCount?: number; occupancy?: number; column?: number;
  row?: number; rowHeads?: number; header?: boolean;
};
type Section = {node: number; id: TextRange; number: string};
type Note = {node: number; path: number; id: TextRange; ref: TextRange};
const formatting: Record<string, string> = {Emph: "em", Underline: "u", Strong: "strong", Strikeout: "del", Superscript: "sup", Subscript: "sub", SmallCaps: "span"};
const alignment: Record<string, string> = {AlignLeft: "left", AlignRight: "right", AlignCenter: "center", AlignDefault: ""};

/** Writer continuations, identifiers, notes and output all use caller storage. */
class HtmlTape {
  readonly text: BackedText;
  private output = emptyText();
  private top = 0;
  private readonly reserved: BackedTextSet;
  private readonly headings: BackedTextSet;
  private readonly sectionByNode: IntegerTable;
  private readonly sections: IntegerTable;
  private readonly notes: IntegerTable;
  private sectionCount = 0;
  private noteCount = 0;
  private readonly counters = [0, 0, 0, 0, 0, 0];
  constructor(private readonly tree: BackedJson, private readonly storage: PagedStorage,
    private readonly context: ExecutionContext, private readonly options: ConversionOptions) {
    this.text = new BackedText(storage, units => context.cooperate(units));
    this.reserved = new BackedTextSet(storage, this.text); this.headings = new BackedTextSet(storage, this.text);
    this.sectionByNode = new IntegerTable(storage, 64); this.sections = new IntegerTable(storage, 64); this.notes = new IntegerTable(storage, 64);
  }
  private async record(value: unknown): Promise<number> {
    const payload = new TextEncoder().encode(JSON.stringify(value)), bytes = new Uint8Array(8 + payload.length);
    new DataView(bytes.buffer).setFloat64(0, payload.length, true); bytes.set(payload, 8);
    return this.storage.append(bytes);
  }
  private async read<T>(position: number): Promise<T> {
    const bytes = await this.storage.read(position, 8), length = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
    return JSON.parse(new TextDecoder().decode(await this.storage.read(position + 8, length))) as T;
  }
  private async push(job: Job): Promise<void> {this.top = await this.record({parent: this.top, job});}
  private async sequence(...jobs: Job[]): Promise<void> {for (let i = jobs.length - 1; i >= 0; i--) await this.push(jobs[i]!);}
  private list(node: number, path: number, mode: string, extra: Partial<Job> = {}): Job {return {op: "list", node, path, mode, ...extra};}
  private literal(value: string): Job {return {op: "literal", node: 0, path: 0, value};}
  private async path(parent: number, suffix: string): Promise<number> {return this.record({parent, suffix});}
  private async location(path: number): Promise<string | undefined> {
    if (!path) return undefined;
    let result = "";
    while (path) {const value = await this.read<{parent: number; suffix: string}>(path); result = value.suffix + result; path = value.parent; await this.context.cooperate();}
    return result;
  }
  private async fail(message: string, path = 0, code: "E_CAPABILITY" | "E_OPTION" = "E_CAPABILITY"): Promise<never> {
    throw new PandocError(code, "convert", message, "html5", await this.location(path));
  }
  private async at(node: number, index: number): Promise<number> {
    let child = node + 32;
    for (let i = 0; i < index; i++) {child = (await this.tree.describe(child)).end; await this.context.cooperate();}
    return child;
  }
  private async count(node: number): Promise<number> {return (await this.tree.describe(node)).children;}
  private async scalar(node: number): Promise<TextRange> {return this.text.from(this.tree.scalarChunks(node));}
  private async tag(node: number): Promise<string> {return (await this.tree.smallText((await this.tree.property(node, "t"))!, 32))!;}
  private async number(node: number): Promise<number> {return readJsonNumber(this.tree.scalarChunks(node), units => this.context.cooperate(units));}
  private async add(value: string | TextRange): Promise<void> {
    await this.text.append(this.output, await this.text.from(typeof value === "string" ? [value] : this.text.chunks(value)));
  }
  private async map(value: TextRange, change: (char: string) => string): Promise<TextRange> {
    const source = this.text.unicodeChunks(value);
    return this.text.from((async function* () {
      let output = "";
      for await (const chunk of source) for (const char of chunk) {
        output += change(char);
        if (output.length >= 4096) {yield output; output = "";}
      }
      if (output) yield output;
    })());
  }
  private async escape(value: string | TextRange, attribute = false): Promise<void> {
    const range = typeof value === "string" ? await this.text.from([value]) : value;
    const escaped = await this.map(range, char => {
      if (char === "\0") throw new PandocError("E_CAPABILITY", "convert", "NUL cannot be represented in HTML", "html5");
      if (this.options.ascii && char.codePointAt(0)! > 127) return `&#${char.codePointAt(0)};`;
      return char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === "\r" ? "&#13;" : attribute && char === '"' ? "&quot;" : char;
    });
    await this.add(escaped);
  }
  private async attribute(key: string | TextRange, value: string | TextRange): Promise<void> {
    await this.add(" "); await this.add(key); await this.add('="'); await this.escape(value, true); await this.add('"');
  }
  private async matches(node: number, value: string): Promise<boolean> {return await this.tree.smallText(node, value.length) === value;}
  private async includes(node: number, value: string): Promise<boolean> {
    for await (const child of this.tree.children(node)) if (await this.matches(child, value)) return true;
    return false;
  }
  private async attrs(node: number, id?: TextRange): Promise<void> {
    id ??= await this.scalar(await this.at(node, 0));
    if (id.units) await this.attribute("id", id);
    const classes = await this.at(node, 1), entries = await this.at(node, 2);
    if (await this.count(classes)) {
      const value = emptyText(); let count = 0;
      for await (const child of this.tree.children(classes)) {
        if (count++) await this.text.append(value, await this.text.from([" "]));
        await this.text.append(value, await this.scalar(child));
      }
      await this.attribute("class", value);
    }
    const seen = new BackedTextSet(this.storage, this.text);
    await seen.add(await this.text.from(["id"])); await seen.add(await this.text.from(["class"]));
    for await (const pair of this.tree.children(entries)) {
      const keyNode = await this.at(pair, 0), key = await this.scalar(keyNode), value = await this.at(pair, 1);
      let prefix = "", valid = true;
      for await (const chunk of this.text.chunks(key)) for (const char of chunk) {
        if (prefix.length < 6) prefix += char;
        if (!(char >= "a" && char <= "z") && !(char >= "0" && char <= "9") && char !== "-") valid = false;
      }
      const allowed = ["title", "lang", "dir", "role"].includes(await this.tree.smallText(keyNode, 5) ?? "") || prefix.startsWith("data-") || prefix.startsWith("aria-");
      if (!valid || !allowed || await seen.has(key)) await this.fail("Unsupported HTML attribute");
      if (await this.matches(keyNode, "dir") && !["ltr", "rtl", "auto"].includes(await this.tree.smallText(value, 4) ?? "")) await this.fail("Invalid HTML direction");
      await seen.add(key); await this.attribute(key, await this.scalar(value));
    }
  }
  private async url(value: TextRange): Promise<TextRange> {
    let first = true, last = "", scheme = "", boundary = false, colon = false;
    for await (const chunk of this.text.unicodeChunks(value)) for (const char of chunk) {
      if (first && !char.trim() || char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127 || char === "\\") await this.fail("Unsupported URL characters");
      first = false; last = char;
      if (!boundary && !colon) {
        if ("/?#".includes(char)) boundary = true;
        else if (char === ":") colon = true;
        else if (scheme.length < 7) scheme += char;
      }
    }
    if (last && !last.trim()) await this.fail("Unsupported URL characters");
    if (colon && !["http", "https", "mailto", "tel"].includes(scheme.toLowerCase())) await this.fail("Unsupported URI scheme");
    return this.map(value, char => " \"<>`".includes(char) ? encodeURIComponent(char) : char);
  }
  private async unique(base: TextRange, used = this.reserved): Promise<TextRange> {
    let id = base, suffix = 1;
    while (await used.has(id) || id !== base && await this.reserved.has(id)) {
      id = await this.text.from(this.text.chunks(base)); await this.text.append(id, await this.text.from([`-${suffix++}`]));
    }
    await used.add(id); await this.reserved.add(id); return id;
  }
  private async plain(node: number): Promise<TextRange> {
    const previous = this.output, stop = this.top;
    this.output = emptyText();
    await this.push(this.list(node, 0, "plainInline")); await this.run(stop);
    const result = this.output; this.output = previous; return result;
  }
  private async section(node: number): Promise<Section> {
    const c = (await this.tree.property(node, "c"))!, attrs = await this.at(c, 1), idNode = await this.at(attrs, 0);
    let base = await this.scalar(idNode); const explicit = base.units > 0;
    if (!explicit) {
      base = await this.map(await this.text.lower(await this.plain(await this.at(c, 2))), char => char === " " || char === "\n" ? "-" : "!\"#$%&'()*+,./:;<=>?@[\\]^`{|}~".includes(char) ? "" : char);
      if (!base.units) base = await this.text.from(["section"]);
    }
    const id = await this.unique(base, explicit ? this.headings : this.reserved); await this.headings.add(id);
    let number = "";
    if (!await this.includes(await this.at(attrs, 1), "unnumbered")) {
      const level = Math.min(await this.number(await this.at(c, 0)), 6);
      this.counters[level - 1]!++; this.counters.fill(0, level); number = this.counters.slice(0, level).join(".");
    }
    return {node, id, number};
  }
  private async raw(content: number, path: number): Promise<void> {
    const policy = this.options.rawContent ?? (this.options.lossy ? "escape" : "reject");
    if (policy === "reject") await this.fail("Raw content requires an explicit HTML policy", path);
    const value = await this.scalar(await this.at(content, 1));
    if (policy === "retain") {
      if (!["html", "html5"].includes(await this.tree.smallText(await this.at(content, 0), 5) ?? "")) await this.fail("Only HTML raw content can be retained", path);
      this.context.report({code: "W_RAW_CONTENT", operation: "convert", format: "html5", location: await this.location(path), message: "Retained raw HTML may contain dangerous markup; conversion is not sanitization"});
      await this.add(value);
    } else {
      if (this.options.rawContent === undefined && this.options.lossy) this.context.report({code: "W_TABLE_LOSS", operation: "convert", format: "html5", location: await this.location(path), message: "Escaped raw content"});
      await this.escape(value);
    }
  }
  private async task(content: number): Promise<boolean | undefined> {
    const attrs = await this.at(content, 0), children = await this.at(content, 1);
    const id = await this.at(attrs, 0), classes = await this.at(attrs, 1), entries = await this.at(attrs, 2);
    if (await this.count(children) || !await this.matches(id, "") || await this.count(classes) !== 1 || !await this.matches(classes + 32, "task-list-marker") || await this.count(entries) !== 1) return undefined;
    const pair = entries + 32;
    if (!await this.matches(pair + 32, "checked")) return undefined;
    const value = await this.tree.smallText(await this.at(pair, 1), 5);
    return value === "true" ? true : value === "false" ? false : undefined;
  }
  private async pointer(position: number): Promise<number> {
    const bytes = await this.storage.read(position, 8); return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  private async put(position: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); await this.storage.write(position, bytes);
  }
  private async run(stop = 0): Promise<void> {
    while (this.top !== stop) {
      await this.context.cooperate();
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent;
      const job = frame.job;
      if (job.op === "literal") {await this.add(job.value!); continue;}
      if (job.op === "list") {
        const cursor = job.cursor ?? job.node + 32, end = (await this.tree.describe(job.node)).end, index = job.index ?? 0;
        if (cursor < end) {
          await this.push({...job, cursor: (await this.tree.describe(cursor)).end, index: index + 1});
          await this.push({...job, op: job.mode!, node: cursor, path: await this.path(job.path, `[${index}]`), index});
        }
        continue;
      }
      const part = async (index: number) => ({node: await this.at(job.node, index), path: await this.path(job.path, `[${index}]`)});
      if (job.op === "caption") {
        const blocks = await part(1);
        if (await this.count(blocks.node)) await this.push(this.list(blocks.node, blocks.path, "block"));
        else {const short = await part(0); if ((await this.tree.describe(short.node)).kind === "array") await this.push(this.list(short.node, short.path, "inline"));}
        continue;
      }
      if (job.op === "item" || job.op === "definitionBody" || job.op === "line") {
        if (job.op === "line") {if (job.index) await this.add("<br>"); await this.push(this.list(job.node, job.path, "inline"));}
        else {
          const tag = job.op === "item" ? "li" : "dd"; await this.add(`<${tag}>`);
          await this.sequence(this.list(job.node, job.path, "block"), this.literal(`</${tag}>\n`));
        }
        continue;
      }
      if (job.op === "definition") {
        const term = await part(0), defs = await part(1); await this.add("<dt>");
        await this.sequence(this.list(term.node, term.path, "inline"), this.literal("</dt>\n"), this.list(defs.node, defs.path, "definitionBody")); continue;
      }
      if (job.op === "tableColumns") {
        const columns = await part(2), count = await this.count(columns.node), index = this.storage.allocate(count * 8);
        await this.add("<colgroup>"); let i = 0;
        for await (const column of this.tree.children(columns.node)) {
          await this.put(index + i++ * 8, column);
          const align = alignment[await this.tag(column + 32)]!, widthNode = await this.at(column, 1);
          const width = await this.tag(widthNode) === "ColWidth" ? `width:${await this.number((await this.tree.property(widthNode, "c"))!) * 100}%` : "";
          await this.add("<col"); const style = [width, align ? `text-align:${align}` : ""].filter(Boolean).join(";");
          if (style) await this.attribute("style", style); await this.add(">");
        }
        await this.add("</colgroup>\n");
        const head = await part(3), bodies = await part(4), foot = await part(5), extra = {columns: index, columnCount: count};
        await this.sequence({op: "section", ...head, ...extra, header: true}, this.list(bodies.node, bodies.path, "body", extra), {op: "section", ...foot, ...extra, header: false}, this.literal("</table>\n")); continue;
      }
      if (job.op === "section" || job.op === "body") {
        const attrs = await part(0), rows = await part(job.op === "body" ? 3 : 1);
        if (job.op === "section" && !await this.count(rows.node)) continue;
        const tag = job.op === "body" ? "tbody" : job.header ? "thead" : "tfoot";
        await this.add(`<${tag}`); await this.attrs(attrs.node); await this.add(">\n");
        const extra = {columns: job.columns!, columnCount: job.columnCount!, header: job.header ?? false, rowHeads: 0};
        const rowJob = this.list(rows.node, rows.path, "row", {...extra, occupancy: this.storage.allocate(job.columnCount! * 8)});
        if (job.op === "body") {
          rowJob.rowHeads = await this.number((await part(1)).node);
          const heads = await part(2);
          await this.sequence(this.list(heads.node, heads.path, "row", {...extra, header: true, occupancy: this.storage.allocate(job.columnCount! * 8)}), rowJob, this.literal(`</${tag}>\n`));
        } else await this.sequence(rowJob, this.literal(`</${tag}>\n`));
        continue;
      }
      if (job.op === "row") {
        const cells = await part(1); await this.add("<tr"); await this.attrs((await part(0)).node); await this.add(">");
        await this.sequence({...job, ...cells, op: "cells", row: job.index!, column: 0, index: 0, cursor: cells.node + 32}, this.literal("</tr>\n")); continue;
      }
      if (job.op === "cells") {
        const cursor = job.cursor!, end = (await this.tree.describe(job.node)).end;
        if (cursor >= end) continue;
        let column = job.column!;
        while (await this.pointer(job.occupancy! + column * 8) > job.row!) {column++; await this.context.cooperate();}
        const rows = await this.number(await this.at(cursor, 2)), span = await this.number(await this.at(cursor, 3));
        for (let i = 0; i < span; i++) {await this.put(job.occupancy! + (column + i) * 8, job.row! + rows); await this.context.cooperate();}
        await this.push({...job, cursor: (await this.tree.describe(cursor)).end, column: column + span, index: job.index! + 1});
        const path = await this.path(job.path, `[${job.index}]`), head = job.header || column < job.rowHeads!, tag = head ? "th" : "td";
        await this.add(`<${tag}`); await this.attrs(cursor + 32);
        if (head) await this.attribute("scope", job.header ? "col" : "row");
        if (rows !== 1) await this.attribute("rowspan", String(rows)); if (span !== 1) await this.attribute("colspan", String(span));
        const columnNode = await this.pointer(job.columns! + column * 8), cellAlign = await this.tag(await this.at(cursor, 1));
        const align = alignment[cellAlign === "AlignDefault" ? await this.tag(columnNode + 32) : cellAlign]!;
        if (align) await this.attribute("style", `text-align:${align}`);
        await this.add(">"); await this.sequence(this.list(await this.at(cursor, 4), await this.path(path, "[4]"), "block"), this.literal(`</${tag}>`)); continue;
      }
      const tag = await this.tag(job.node), content = await this.tree.property(job.node, "c"), cp = await this.path(job.path, ".c");
      const child = async (index: number) => ({node: await this.at(content!, index), path: await this.path(cp, `[${index}]`)});
      if (job.op === "plainInline") {
        if (tag === "Str") await this.add(await this.scalar(content!));
        else if (["Space", "SoftBreak", "LineBreak"].includes(tag)) await this.add(" ");
        else if (["Code", "Math", "RawInline"].includes(tag)) await this.add(await this.scalar(await this.at(content!, 1)));
        else if (tag !== "Note") await this.push(this.list(["Span", "Link", "Image", "Quoted", "Cite"].includes(tag) ? await this.at(content!, 1) : content!, 0, "plainInline"));
        continue;
      }
      if (job.op === "inline") {
        if (tag === "Str") await this.escape(await this.scalar(content!));
        else if (tag === "Space" || tag === "SoftBreak" || tag === "LineBreak") await this.add(tag === "Space" ? " " : tag === "SoftBreak" ? "\n" : "<br>");
        else if (formatting[tag]) {
          await this.add(`<${formatting[tag]}${tag === "SmallCaps" ? ' class="smallcaps"' : ""}>`);
          await this.sequence(this.list(content!, cp, "inline"), this.literal(`</${formatting[tag]}>`));
        } else if (tag === "Quoted") {
          const single = await this.tag(await this.at(content!, 0)) === "SingleQuote", inner = await child(1);
          await this.add(single ? "‘" : "“"); await this.sequence(this.list(inner.node, inner.path, "inline"), this.literal(single ? "’" : "”"));
        } else if (tag === "Cite") {const inner = await child(1); await this.push(this.list(inner.node, inner.path, "inline"));}
        else if (tag === "Code") {
          await this.add("<code"); await this.attrs(await this.at(content!, 0)); await this.add(">"); await this.escape(await this.scalar(await this.at(content!, 1))); await this.add("</code>");
        } else if (tag === "Math") {
          const inline = await this.tag(await this.at(content!, 0)) === "InlineMath";
          await this.add(`<span class="math ${inline ? "inline" : "display"}">`); await this.escape(inline ? "\\(" : "\\[");
          await this.escape(await this.scalar(await this.at(content!, 1))); await this.escape(inline ? "\\)" : "\\]"); await this.add("</span>");
        } else if (tag === "RawInline") await this.raw(content!, job.path);
        else if (tag === "Span") {
          const task = await this.task(content!);
          if (task !== undefined) await this.add(task ? '<input type="checkbox" checked="" />' : '<input type="checkbox" />');
          else {const inner = await child(1); await this.add("<span"); await this.attrs(await this.at(content!, 0)); await this.add(">"); await this.sequence(this.list(inner.node, inner.path, "inline"), this.literal("</span>"));}
        } else if (tag === "Link" || tag === "Image") {
          const image = tag === "Image", target = await this.at(content!, 2), attrs = await this.at(content!, 0), label = await child(1);
          const url = await this.url(await this.scalar(target + 32)), title = await this.scalar(await this.at(target, 1));
          await this.add(image ? "<img" : "<a"); await this.attribute(image ? "src" : "href", url);
          if (image) await this.attribute("alt", await this.plain(label.node));
          if (title.units) await this.attribute("title", title);
          if (title.units) for await (const pair of this.tree.children(await this.at(attrs, 2))) if (await this.matches(pair + 32, "title")) await this.fail("Duplicate HTML title attribute", job.path);
          await this.attrs(attrs); await this.add(">");
          if (!image) await this.sequence(this.list(label.node, label.path, "inline"), this.literal("</a>"));
        } else if (tag === "Note") {
          const index = ++this.noteCount, id = await this.unique(await this.text.from([`fn${index}`])), ref = await this.unique(await this.text.from([`fnref${index}`]));
          await this.notes.set(BigInt(index), BigInt(await this.record({node: content!, path: cp, id, ref})));
          await this.add("<a"); const href = await this.text.from(["#"]); await this.text.append(href, await this.text.from(this.text.chunks(id)));
          await this.attribute("href", href); await this.attribute("id", ref); await this.add(` class="footnote-ref" role="doc-noteref"><sup>${index}</sup></a>`);
        }
        continue;
      }
      if (tag === "Plain" || tag === "Para") {
        if (tag === "Para") await this.add("<p>");
        await this.sequence(this.list(content!, cp, "inline"), this.literal(tag === "Para" ? "</p>\n" : ""));
      } else if (tag === "CodeBlock") {
        await this.add("<pre><code"); await this.attrs(await this.at(content!, 0)); await this.add(">"); await this.escape(await this.scalar(await this.at(content!, 1))); await this.add("</code></pre>\n");
      } else if (tag === "RawBlock") {await this.raw(content!, job.path); await this.add("\n");}
      else if (tag === "Header") {
        const known = await this.sectionByNode.get(BigInt(job.node)), section = known === undefined ? await this.section(job.node) : await this.read<Section>(Number(known));
        const level = Math.min(await this.number(await this.at(content!, 0)), 6), inner = await child(2);
        await this.add(`<h${level}`); await this.attrs(await this.at(content!, 1), section.id);
        if (this.options.numberSections && section.number) await this.attribute("data-number", section.number);
        await this.add(">");
        if (this.options.numberSections && section.number) {await this.add('<span class="header-section-number">'); await this.escape(section.number); await this.add("</span> ");}
        await this.sequence(this.list(inner.node, inner.path, "inline"), this.literal(`</h${level}>\n`));
      } else if (tag === "HorizontalRule") await this.add("<hr>\n");
      else if (tag === "BlockQuote" || tag === "Div") {
        const blockTag = tag === "Div" ? "div" : "blockquote", inner = tag === "Div" ? await child(1) : {node: content!, path: cp};
        await this.add(`<${blockTag}`); if (tag === "Div") await this.attrs(await this.at(content!, 0)); await this.add(">");
        await this.sequence(this.list(inner.node, inner.path, "block"), this.literal(`</${blockTag}>\n`));
      } else if (tag === "BulletList" || tag === "OrderedList") {
        const ordered = tag === "OrderedList", listTag = ordered ? "ol" : "ul";
        await this.add(`<${listTag}`);
        if (ordered) {
          const attrs = await this.at(content!, 0), start = await this.number(attrs + 32), style = await this.tag(await this.at(attrs, 1));
          if (start !== 1) await this.attribute("start", String(start));
          const numbering: Record<string, string> = {Example: "1", Decimal: "1", LowerRoman: "i", UpperRoman: "I", LowerAlpha: "a", UpperAlpha: "A"};
          if (numbering[style]) await this.attribute("type", numbering[style]!);
        }
        await this.add(">\n"); const items = ordered ? await child(1) : {node: content!, path: cp};
        await this.sequence(this.list(items.node, items.path, "item"), this.literal(`</${listTag}>\n`));
      } else if (tag === "DefinitionList" || tag === "LineBlock") {
        await this.add(tag === "DefinitionList" ? "<dl>\n" : '<div class="line-block">');
        await this.sequence(this.list(content!, cp, tag === "DefinitionList" ? "definition" : "line"), this.literal(tag === "DefinitionList" ? "</dl>\n" : "</div>\n"));
      } else if (tag === "Figure") {
        const body = await child(2), caption = await child(1); await this.add("<figure"); await this.attrs(await this.at(content!, 0)); await this.add(">");
        await this.sequence(this.list(body.node, body.path, "block"), this.literal("<figcaption>"), {op: "caption", ...caption}, this.literal("</figcaption></figure>\n"));
      } else if (tag === "Table") {
        await this.add("<table"); await this.attrs(await this.at(content!, 0)); await this.add(">\n");
        const caption = await child(1), short = await this.at(caption.node, 0), long = await this.at(caption.node, 1);
        const hasCaption = await this.count(long) || (await this.tree.describe(short)).kind === "array" && await this.count(short);
        if (hasCaption) {
          await this.add("<caption>"); await this.sequence({op: "caption", ...caption}, this.literal("</caption>\n"), {op: "tableColumns", node: content!, path: cp});
        } else await this.push({op: "tableColumns", node: content!, path: cp});
      }
    }
  }
  private async meta(metadata: number, key: string): Promise<TextRange | undefined> {
    const node = await this.tree.property(metadata, key);
    if (node === undefined) return undefined;
    const tag = await this.tag(node), content = (await this.tree.property(node, "c"))!;
    if (tag === "MetaString") return this.scalar(content);
    if (tag === "MetaInlines") return this.plain(content);
    return this.fail(`${key} metadata must be text or inlines`, 0, "E_OPTION");
  }
  private async contents(): Promise<void> {
    await this.add('<nav id="TOC" role="doc-toc">\n<ul>\n');
    // Only levels one through three enter the contents, so this stack is fixed.
    const levels: number[] = [];
    for (let i = 0; i < this.sectionCount; i++) {
      const section = await this.read<Section>(Number(await this.sections.get(BigInt(i))));
      const content = (await this.tree.property(section.node, "c"))!, attrs = await this.at(content, 1), level = await this.number(content + 32);
      if (level > 3 || await this.includes(await this.at(attrs, 1), "unlisted")) continue;
      if (levels.length && level > levels[levels.length - 1]!) await this.add("<ul>\n");
      else if (levels.length) {
        await this.add("</li>\n");
        while (levels.length > 1 && level < levels[levels.length - 1]!) {await this.add("</ul>\n</li>\n"); levels.pop();}
        levels.pop();
      }
      levels.push(level); await this.add("<li><a");
      const href = await this.text.from(["#"]); await this.text.append(href, await this.text.from(this.text.chunks(section.id)));
      await this.attribute("href", await this.url(href)); await this.add(">");
      if (this.options.numberSections && section.number) {await this.add('<span class="toc-section-number">'); await this.escape(section.number); await this.add("</span> ");}
      await this.escape(await this.plain(await this.at(content, 2))); await this.add("</a>");
    }
    if (levels.length) await this.add("</li>\n");
    while (levels.length > 1) {await this.add("</ul>\n</li>\n"); levels.pop();}
    await this.add("</ul>\n</nav>\n");
  }
  async render(): Promise<TextRange> {
    const blocks = (await this.tree.property(this.tree.rootPosition, "blocks"))!, metadata = (await this.tree.property(this.tree.rootPosition, "meta"))!;
    const end = (await this.tree.describe(blocks)).end;
    for (let position = blocks; position < end;) {
      const header = await this.tree.describe(position); await this.context.cooperate();
      if (header.kind === "array" && header.children === 3) {
        const id = position + 32, classes = (await this.tree.describe(id)).end, entries = (await this.tree.describe(classes)).end;
        if ((await this.tree.describe(id)).kind === "string" && (await this.tree.describe(classes)).kind === "array" && (await this.tree.describe(entries)).kind === "array") {
          const value = await this.scalar(id); if (value.units) await this.reserved.add(value);
        }
      }
      position = header.kind === "array" || header.kind === "object" ? position + 32 : header.end;
    }
    if (this.options.toc) for (let position = blocks; position < end;) {
      const header = await this.tree.describe(position); await this.context.cooperate();
      if (header.kind === "object") {
        const tag = await this.tree.property(position, "t");
        if (tag !== undefined && await this.tree.smallText(tag, 6) === "Header") {
          const section = await this.record(await this.section(position));
          await this.sections.set(BigInt(this.sectionCount++), BigInt(section)); await this.sectionByNode.set(BigInt(position), BigInt(section));
        }
      }
      position = header.kind === "array" || header.kind === "object" ? position + 32 : header.end;
    }
    const title = await this.meta(metadata, "title") ?? emptyText(), lang = await this.meta(metadata, "lang"), dir = await this.meta(metadata, "dir");
    if (dir) {
      let value = "";
      if (dir.units <= 4) for await (const chunk of this.text.chunks(dir)) value += chunk;
      if (!["ltr", "rtl", "auto"].includes(value)) await this.fail("Invalid dir metadata", 0, "E_OPTION");
    }
    if (this.options.standalone) {
      await this.add('<!DOCTYPE html>\n<html'); if (lang) await this.attribute("lang", lang); if (dir) await this.attribute("dir", dir);
      await this.add('>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>'); await this.escape(title); await this.add("</title>\n</head>\n<body>\n");
    }
    if (this.options.toc && this.options.standalone) await this.contents();
    await this.push(this.list(blocks, await this.path(0, "$.blocks"), "block")); await this.run();
    if (this.noteCount) {
      await this.add('<section class="footnotes" role="doc-endnotes">\n<ol>\n');
      for (let i = 1; i <= this.noteCount; i++) {
        const note = await this.read<Note>(Number(await this.notes.get(BigInt(i))));
        await this.add("<li"); await this.attribute("id", note.id); await this.add(">");
        await this.push(this.list(note.node, note.path, "block")); await this.run();
        await this.add("<a"); const href = await this.text.from(["#"]); await this.text.append(href, await this.text.from(this.text.chunks(note.ref)));
        await this.attribute("href", href); await this.add(' class="footnote-back" role="doc-backlink">↩</a></li>\n');
      }
      await this.add("</ol>\n</section>\n");
    }
    if (this.options.standalone) await this.add("</body>\n</html>\n");
    return this.output;
  }
}

export async function writeRetainedHtml(tree: BackedJson, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions): Promise<void> {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close());
  let failure: {reason: unknown} | undefined;
  try {
    const writer = new HtmlTape(tree, storage, context, options), result = await writer.render();
    const diagnostics = context.snapshotDiagnostics();
    if (options.failIfWarnings && diagnostics.length) {
      const first = diagnostics[0]!;
      throw new PandocError("E_WARNINGS", "convert", `Warnings rejected: ${first.code}: ${first.message}`, first.format, first.location);
    }
    const chunks = async function* () {
      const encoder = new TextEncoder();
      for await (const chunk of writer.text.unicodeChunks(result)) yield encoder.encode(options.eol === "crlf" ? chunk.split("\n").join("\r\n") : chunk);
    };
    if (Number.isFinite(context.limits.outputBytes)) {
      let length = 0; for await (const bytes of chunks()) {length += bytes.length; context.bound("outputBytes", length);}
    }
    for await (const bytes of chunks()) await context.emit(bytes);
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};}
  finally {release();}
  if (failure) throw failure.reason;
}
