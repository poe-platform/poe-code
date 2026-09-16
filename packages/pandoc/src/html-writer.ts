import type { Alignment, Attr, Block, Caption, ColSpec, Inline, MetaValue, Row } from "./ast-types.js";
import type { AdapterContext, Document, SerializedDocument } from "./types.js";
import { PandocError } from "./errors.js";
import { placeRows } from "./tables.js";

const alignment: Record<Alignment, string> = {AlignLeft: "left", AlignRight: "right", AlignCenter: "center", AlignDefault: ""};
const numbering = {DefaultStyle: "", Example: "1", Decimal: "1", LowerRoman: "i", UpperRoman: "I", LowerAlpha: "a", UpperAlpha: "A"};
const formatting = {Emph: "em", Underline: "u", Strong: "strong", Strikeout: "del", Superscript: "sup", Subscript: "sub", SmallCaps: "span"};

/** Pure serialization, never resource resolution or sanitization. */
class HtmlWriter {
  private readonly chunks: string[] = [];
  private length = 0;
  private readonly reserved = new Set<string>();
  private readonly headings = new Set<string>();
  private readonly notes: {blocks: readonly Block[]; id: string; ref: string; path: string}[] = [];
  constructor(readonly context: AdapterContext) {}
  fail(message: string, path?: string, code: "E_CAPABILITY" | "E_OPTION" = "E_CAPABILITY"): never {
    throw new PandocError(code, this.context.operation ?? "write", message, "html5", path);
  }
  add(text: string): void {
    this.context.checkpoint(text.length + 1);
    this.context.bound("outputBytes", this.length + text.length);
    this.context.charge("retainedBytes", text.length * 2);
    this.context.charge("references", 1);
    this.chunks.push(text); this.length += text.length;
  }
  escape(text: string, attribute = false): void {
    let chunk = "";
    for(const ch of text) {
      if(ch === "\0") this.fail("NUL cannot be represented in HTML");
      chunk += ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\r": "&#13;"}[ch] ?? (attribute && ch === '"' ? "&quot;" : ch));
      if(chunk.length >= 256) {this.add(chunk); chunk = "";}
    }
    if(chunk) this.add(chunk);
  }
  attribute(key: string, value: string): void {this.add(` ${key}="`); this.escape(value, true); this.add('"');}
  attrs(attr: Attr, id = attr[0]): void {
    if(id) this.attribute("id", id);
    if(attr[1].length) this.attribute("class", attr[1].join(" "));
    const seen = new Set(["id", "class"]);
    for(const [key, value] of attr[2]) {
      // Explicit passive vocabulary; URL-bearing and active attributes cannot bypass targets.
      if(seen.has(key) || !( ["title", "lang", "dir", "role"].includes(key) || key.startsWith("data-") || key.startsWith("aria-")) ||
        [...key].some(ch => !(ch >= "a" && ch <= "z") && !(ch >= "0" && ch <= "9") && ch !== "-")) this.fail("Unsupported HTML attribute");
      if(key === "dir" && !["ltr", "rtl", "auto"].includes(value)) this.fail("Invalid HTML direction");
      seen.add(key); this.attribute(key, value);
    }
  }
  url(value: string): string {
    if(value.trim() !== value || [...value].some(ch => ch.charCodeAt(0) <= 31 || ch.charCodeAt(0) === 127 || ch === "\\")) this.fail("Unsupported URL characters");
    const colon = value.indexOf(":"), boundary = [value.indexOf("/"), value.indexOf("?"), value.indexOf("#")].filter(n => n >= 0);
    if(colon >= 0 && boundary.every(n => colon < n)) {
      const scheme = value.slice(0, colon).toLowerCase();
      if(!["http", "https", "mailto", "tel"].includes(scheme)) this.fail("Unsupported URI scheme");
    }
    // Percent-encode URL syntax hazards first; then attribute-escape the resulting URL.
    let result = "";
    for(const ch of value) {this.context.checkpoint(); result += ch === " " || ch === '"' || ch === "<" || ch === ">" || ch === "`" ? encodeURIComponent(ch) : ch;}
    this.context.charge("retainedBytes", result.length * 2);
    return result;
  }
  reserve(value: unknown): void {
    this.context.checkpoint();
    if(!value || typeof value !== "object") return;
    if(Array.isArray(value)) {
      if(value.length === 3 && typeof value[0] === "string" && Array.isArray(value[1]) && Array.isArray(value[2]) && value[0]) this.reserved.add(value[0]);
      for(const child of value) this.reserve(child);
    } else for(const child of Object.values(value)) this.reserve(child);
  }
  unique(base: string, used = this.reserved): string {
    let id = base, suffix = 1;
    while(used.has(id) || (id !== base && this.reserved.has(id))) {this.context.checkpoint(); id = `${base}-${suffix++}`;}
    used.add(id); this.reserved.add(id); return id;
  }
  plain(nodes: readonly Inline[]): string {
    let result = "";
    for(const node of nodes) {
      this.context.checkpoint();
      switch(node.t) {
        case "Str": result += node.c; break;
        case "Space": case "SoftBreak": case "LineBreak": result += " "; break;
        case "Code": case "Math": case "RawInline": result += node.c[1]; break;
        case "Span": case "Link": case "Image": case "Quoted": case "Cite": result += this.plain(node.c[1]); break;
        case "Note": break;
        default: result += this.plain(node.c);
      }
      this.context.bound("text", result.length);
    }
    this.context.charge("retainedBytes", result.length * 2); return result;
  }
  raw(format: string, text: string, path: string): void {
    const policy = this.context.rawContent ?? (this.context.lossy ? "escape" : "reject");
    if(policy === "reject") this.fail("Raw content requires an explicit HTML policy", path);
    if(policy === "retain") {
      if(!["html", "html5"].includes(format)) this.fail("Only HTML raw content can be retained", path);
      this.context.report({code: "W_RAW_CONTENT", operation: this.context.operation ?? "write", format: "html5", location: path,
        message: "Retained raw HTML may contain dangerous markup; conversion is not sanitization"});
      this.add(text);
    } else {
      if(this.context.rawContent === undefined && this.context.lossy) this.context.report({code: "W_TABLE_LOSS", operation: this.context.operation ?? "write", format: "html5", location: path, message: "Escaped raw content"});
      this.escape(text);
    }
  }
  async inlines(nodes: readonly Inline[], path: string): Promise<void> {
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate(); const p = `${path}[${i}]`;
      switch(node.t) {
        case "Str": this.escape(node.c); break;
        case "Space": this.add(" "); break;
        case "SoftBreak": this.add("\n"); break;
        case "LineBreak": this.add("<br>"); break;
        case "Emph": case "Underline": case "Strong": case "Strikeout": case "Superscript": case "Subscript": case "SmallCaps": {
          const tag = formatting[node.t]; this.add(`<${tag}${node.t === "SmallCaps" ? ' class="smallcaps"' : ""}>`);
          await this.inlines(node.c, `${p}.c`); this.add(`</${tag}>`); break;
        }
        case "Quoted": this.add(node.c[0] === "SingleQuote" ? "‘" : "“"); await this.inlines(node.c[1], `${p}.c[1]`); this.add(node.c[0] === "SingleQuote" ? "’" : "”"); break;
        case "Cite": await this.inlines(node.c[1], `${p}.c[1]`); break;
        case "Code": this.add("<code"); this.attrs(node.c[0]); this.add(">"); this.escape(node.c[1]); this.add("</code>"); break;
        case "Math": this.add(`<span class="math ${node.c[0] === "InlineMath" ? "inline" : "display"}">`); this.escape(node.c[0] === "InlineMath" ? `\\(${node.c[1]}\\)` : `\\[${node.c[1]}\\]`); this.add("</span>"); break;
        case "RawInline": this.raw(node.c[0], node.c[1], p); break;
        case "Span": this.add("<span"); this.attrs(node.c[0]); this.add(">"); await this.inlines(node.c[1], `${p}.c[1]`); this.add("</span>"); break;
        case "Link": case "Image": {
          const image = node.t === "Image"; this.add(image ? "<img" : "<a"); this.attribute(image ? "src" : "href", this.url(node.c[2][0]));
          if(image) this.attribute("alt", this.plain(node.c[1]));
          if(node.c[2][1]) this.attribute("title", node.c[2][1]);
          if(node.c[0][2].some(([key]) => key === "title") && node.c[2][1]) this.fail("Duplicate HTML title attribute", p);
          this.attrs(node.c[0]); this.add(">");
          if(!image) {await this.inlines(node.c[1], `${p}.c[1]`); this.add("</a>");} break;
        }
        case "Note": {
          const n = this.notes.length + 1, id = this.unique(`fn${n}`), ref = this.unique(`fnref${n}`);
          this.context.charge("references", 1); this.notes.push({blocks: node.c, id, ref, path: `${p}.c`});
          this.add('<a'); this.attribute("href", `#${id}`); this.attribute("id", ref); this.add(` class="footnote-ref" role="doc-noteref"><sup>${n}</sup></a>`); break;
        }
      }
    }
  }
  async caption(c: Caption, path: string): Promise<void> {
    if(c[1].length) await this.blocks(c[1], `${path}[1]`);
    else if(c[0]) await this.inlines(c[0], `${path}[0]`);
  }
  async rows(rows: readonly Row[], cols: readonly ColSpec[], path: string, header: boolean, rowHeads = 0): Promise<void> {
    let current = -1;
    for(const placed of placeRows(rows, cols.length, path, rowHeads)) {
      await this.context.cooperate(); if(!placed) continue;
      while(current < placed.row) {if(current >= 0) this.add("</tr>\n"); current++; this.add("<tr"); this.attrs(rows[current]![0]); this.add(">");}
      const cell = placed.cell, head = header || placed.column < rowHeads, tag = head ? "th" : "td";
      this.add(`<${tag}`); this.attrs(cell[0]);
      if(head) this.attribute("scope", header ? "col" : "row");
      if(cell[2] !== 1) this.attribute("rowspan", String(cell[2]));
      if(cell[3] !== 1) this.attribute("colspan", String(cell[3]));
      const align = alignment[cell[1] === "AlignDefault" ? cols[placed.column]![0] : cell[1]];
      if(align) this.attribute("style", `text-align:${align}`);
      this.add(">"); await this.blocks(cell[4], `${placed.path}[4]`); this.add(`</${tag}>`);
    }
    while(current < rows.length - 1) {if(current >= 0) this.add("</tr>\n"); current++; this.add("<tr"); this.attrs(rows[current]![0]); this.add(">");}
    if(current >= 0) this.add("</tr>\n");
  }
  async table(node: Extract<Block, {t: "Table"}>, p: string): Promise<void> {
    const t = node.c; this.add("<table"); this.attrs(t[0]); this.add(">\n");
    if(t[1][1].length || t[1][0]?.length) {this.add("<caption>"); await this.caption(t[1], `${p}.c[1]`); this.add("</caption>\n");}
    this.add("<colgroup>");
    for(const [align, width] of t[2]) {
      this.add("<col"); const style = [width.t === "ColWidth" ? `width:${width.c * 100}%` : "", alignment[align] ? `text-align:${alignment[align]}` : ""].filter(Boolean).join(";");
      if(style) this.attribute("style", style); this.add(">");
    }
    this.add("</colgroup>\n");
    if(t[3][1].length) {this.add("<thead"); this.attrs(t[3][0]); this.add(">\n"); await this.rows(t[3][1], t[2], `${p}.c[3][1]`, true); this.add("</thead>\n");}
    for(const [i, body] of t[4].entries()) {this.add("<tbody"); this.attrs(body[0]); this.add(">\n"); await this.rows(body[2], t[2], `${p}.c[4][${i}][2]`, true); await this.rows(body[3], t[2], `${p}.c[4][${i}][3]`, false, body[1]); this.add("</tbody>\n");}
    if(t[5][1].length) {this.add("<tfoot"); this.attrs(t[5][0]); this.add(">\n"); await this.rows(t[5][1], t[2], `${p}.c[5][1]`, false); this.add("</tfoot>\n");}
    this.add("</table>\n");
  }
  async blocks(nodes: readonly Block[], path: string): Promise<void> {
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate(); const p = `${path}[${i}]`;
      switch(node.t) {
        case "Plain": await this.inlines(node.c, `${p}.c`); break;
        case "Para": this.add("<p>"); await this.inlines(node.c, `${p}.c`); this.add("</p>\n"); break;
        case "CodeBlock": this.add("<pre><code"); this.attrs(node.c[0]); this.add(">"); this.escape(node.c[1]); this.add("</code></pre>\n"); break;
        case "RawBlock": this.raw(node.c[0], node.c[1], p); this.add("\n"); break;
        case "Header": {
          const text = this.plain(node.c[2]).toLowerCase(); let base = node.c[1][0];
          if(!base) {for(const ch of text) {this.context.checkpoint(); if(ch === " " || ch === "\n") base += "-"; else if(!"!\"#$%&'()*+,./:;<=>?@[\\]^`{|}~".includes(ch)) base += ch;} if(!base) base = "section";}
          const id = this.unique(base, node.c[1][0] ? this.headings : this.reserved), level = Math.min(node.c[0], 6);
          this.headings.add(id);
          this.add(`<h${level}`); this.attrs(node.c[1], id); this.add(">"); await this.inlines(node.c[2], `${p}.c[2]`); this.add(`</h${level}>\n`); break;
        }
        case "HorizontalRule": this.add("<hr>\n"); break;
        case "BlockQuote": case "Div": {
          const tag = node.t === "Div" ? "div" : "blockquote"; this.add(`<${tag}`); if(node.t === "Div") this.attrs(node.c[0]); this.add(">");
          await this.blocks(node.t === "Div" ? node.c[1] : node.c, node.t === "Div" ? `${p}.c[1]` : `${p}.c`); this.add(`</${tag}>\n`); break;
        }
        case "BulletList": case "OrderedList": {
          const ordered = node.t === "OrderedList", tag = ordered ? "ol" : "ul"; this.add(`<${tag}`);
          if(ordered) {if(node.c[0][0] !== 1) this.attribute("start", String(node.c[0][0])); if(numbering[node.c[0][1]]) this.attribute("type", numbering[node.c[0][1]]);}
          this.add(">\n"); for(const [j, item] of (ordered ? node.c[1] : node.c).entries()) {this.add("<li>"); await this.blocks(item, `${p}.c${ordered ? "[1]" : ""}[${j}]`); this.add("</li>\n");} this.add(`</${tag}>\n`); break;
        }
        case "DefinitionList": this.add("<dl>\n"); for(const [j, [term, defs]] of node.c.entries()) {this.add("<dt>"); await this.inlines(term, `${p}.c[${j}][0]`); this.add("</dt>\n"); for(const [k, def] of defs.entries()) {this.add("<dd>"); await this.blocks(def, `${p}.c[${j}][1][${k}]`); this.add("</dd>\n");}} this.add("</dl>\n"); break;
        case "LineBlock": this.add('<div class="line-block">'); for(const [j, line] of node.c.entries()) {if(j) this.add("<br>"); await this.inlines(line, `${p}.c[${j}]`);} this.add("</div>\n"); break;
        case "Figure": this.add("<figure"); this.attrs(node.c[0]); this.add(">"); await this.blocks(node.c[2], `${p}.c[2]`); this.add("<figcaption>"); await this.caption(node.c[1], `${p}.c[1]`); this.add("</figcaption></figure>\n"); break;
        case "Table": await this.table(node, p); break;
      }
    }
  }
  meta(value: MetaValue | undefined, key: string): string | undefined {
    if(value === undefined) return undefined;
    if(value.t === "MetaString") return value.c;
    if(value.t === "MetaInlines") return this.plain(value.c);
    this.fail(`${key} metadata must be text or inlines`, undefined, "E_OPTION");
  }
  async write(document: Document): Promise<SerializedDocument> {
    this.reserve(document.blocks);
    const title = this.meta(document.metadata.title, "title") ?? "";
    const lang = this.meta(document.metadata.lang, "lang") ?? document.language;
    const dir = this.meta(document.metadata.dir, "dir") ?? document.direction;
    if(dir !== undefined && !["ltr", "rtl", "auto"].includes(dir)) this.fail("Invalid dir metadata", undefined, "E_OPTION");
    if(this.context.standalone) {
      this.add('<!DOCTYPE html>\n<html'); if(lang !== undefined) this.attribute("lang", lang); if(dir !== undefined) this.attribute("dir", dir);
      this.add('>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>'); this.escape(title); this.add("</title>\n</head>\n<body>\n");
    }
    await this.blocks(document.blocks, "$.blocks");
    if(this.notes.length) {
      this.add('<section class="footnotes" role="doc-endnotes">\n<ol>\n');
      for(let i = 0; i < this.notes.length; i++) {const note = this.notes[i]!; this.add("<li"); this.attribute("id", note.id); this.add(">"); await this.blocks(note.blocks, note.path); this.add("<a"); this.attribute("href", `#${note.ref}`); this.add(' class="footnote-back" role="doc-backlink">↩</a></li>\n');}
      this.add("</ol>\n</section>\n");
    }
    if(this.context.standalone) this.add("</body>\n</html>\n");
    this.context.charge("retainedBytes", this.length * 2); return {kind: "text", text: this.chunks.join("")};
  }
}
export async function writeHtml5(document: Document, context: AdapterContext): Promise<SerializedDocument> {
  return new HtmlWriter(context).write(document);
}
