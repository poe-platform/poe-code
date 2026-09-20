import type { Alignment, Block, Caption, Cell, ColSpec, Inline, MetaValue, Row } from "./ast-types.js";
import type { AdapterContext, ReaderCapability } from "./types.js";
import { expandTex } from "./latex-expansion.js";
import { parseTex, TexCursor, texError, texSource } from "./latex-syntax.js";
import type { TexToken } from "./latex-syntax.js";
const empty = (): [string, string[], [string, string][]] => ["", [], []];
const unicode: Readonly<Record<string, string>> = {
  ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", o: "ø", O: "Ø", ss: "ß", l: "ł", L: "Ł",
  LaTeX: "LaTeX", TeX: "TeX", textendash: "–", textemdash: "—", ldots: "…", dots: "…", textbackslash: "\\",
  textasciitilde: "~", textasciicircum: "^", copyright: "©", pounds: "£", euro: "€", textless: "<", textgreater: ">"
};
const accents: Readonly<Record<string, string>> = {"'": "\u0301", '"': "\u0308", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307", c: "\u0327", v: "\u030c", u: "\u0306", H: "\u030b", r: "\u030a"};
const emphasis: Readonly<Record<string, "Emph" | "Strong" | "SmallCaps" | "Underline">> = {emph: "Emph", textit: "Emph", textbf: "Strong", textsc: "SmallCaps", underline: "Underline"};
const levels: Readonly<Record<string, number>> = {part: 1, chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5};
function append(out: Inline[], node: Inline): void {
  const last = out.at(-1);
  if (node.t === "Str" && last?.t === "Str") out[out.length - 1] = {t: "Str", c: last.c + node.c};
  else if (node.t !== "Space" || last?.t !== "Space") out.push(node);
}
function trim(inlines: Inline[]): Inline[] {while (inlines[0]?.t === "Space") inlines.shift(); while (inlines.at(-1)?.t === "Space") inlines.pop(); return inlines;}
function textOf(inlines: readonly Inline[]): string {
  return inlines.map(i => i.t === "Str" ? i.c : i.t === "Space" || i.t === "SoftBreak" ? " " : i.t === "Code" || i.t === "Math" ? i.c[1] : i.t === "Emph" || i.t === "Strong" || i.t === "SmallCaps" || i.t === "Underline" ? textOf(i.c) : "").join("");
}
class LatexReader {
  readonly metadata: Record<string, MetaValue> = {};
  readonly labels = new Map<string, readonly Inline[]>();
  readonly references: {name: string; content: Inline[]}[] = [];
  constructor(readonly context: AdapterContext) {}
  raw(source: string): Inline {
    if (!this.context.lossy && this.context.rawContent !== "retain" && this.context.rawContent !== "escape") texError(this.context, `Unsupported LaTeX syntax: ${source}`, "E_CAPABILITY");
    this.context.report({code: "W_RAW_CONTENT", operation: this.context.operation ?? "read", format: "latex", message: `Preserved unsupported LaTeX source: ${source}`});
    return {t: "RawInline", c: ["latex", source]};
  }
  literal(tokens: readonly TexToken[], depth: number): string {
    this.context.bound("depth", depth);
    return tokens.map(t => {
      this.context.checkpoint();
      if (t.kind === "text" || t.kind === "space") return t.text;
      if (t.kind === "comment") return "";
      if (t.kind === "group") return this.literal(t.children, depth + 1);
      if (t.kind === "command" && "{}$%&#_".includes(t.text) && t.text.length === 1) return t.text;
      if (t.kind === "command" && t.text === "textbackslash") return "\\";
      return texError(this.context, "Unsupported syntax in literal resource/link target", "E_CAPABILITY");
    }).join("");
  }
  inlines(tokens: readonly TexToken[], depth = 0): Inline[] {
    this.context.bound("depth", depth);
    const out: Inline[] = [];
    const cursor = new TexCursor(tokens, this.context);
    while (cursor.index < tokens.length) {
      this.context.checkpoint();
      const t = tokens[cursor.index++]!;
      if (t.kind === "comment") continue;
      if (t.kind === "text") append(out, {t: "Str", c: t.text});
      else if (t.kind === "space") append(out, {t: "Space"});
      else if (t.kind === "group") for (const i of this.inlines(t.children, depth + 1)) append(out, i);
      else if (t.kind === "optional") {
        append(out, {t: "Str", c: "["});
        for (const i of this.inlines(t.children, depth + 1)) append(out, i);
        append(out, {t: "Str", c: "]"});
      } else if (t.kind === "code") append(out, {t: "Code", c: [empty(), t.text]});
      else if (t.kind === "math") append(out, {t: "Math", c: [t.display ? "DisplayMath" : "InlineMath", t.text]});
      else if (t.kind === "environment") append(out, this.raw(t.raw));
      else {
        const name = t.text;
        if (emphasis[name]) append(out, {t: emphasis[name], c: this.inlines(cursor.group().children, depth + 1)});
        else if (name === "texttt") append(out, {t: "Code", c: [empty(), texSource(cursor.group().children)]});
        else if (unicode[name]) append(out, {t: "Str", c: unicode[name]});
        else if ("{}$%&#_".includes(name) && name.length === 1) append(out, {t: "Str", c: name});
        else if (name === " " || name === "," || name === ";" || name === ":") append(out, {t: "Space"});
        else if (name === "\\" || name === "newline") append(out, {t: "LineBreak"});
        else if (accents[name]) {
          cursor.skip();
          const next = tokens[cursor.index];
          let value: string;
          let remainder = "";
          if (next?.kind === "group") value = textOf(this.inlines(cursor.group().children, depth + 1));
          else if (next?.kind === "text") {
            const ch = [...next.text][0]!;
            value = ch;
            cursor.index++;
            remainder = next.text.slice(ch.length);
          } else return texError(this.context, "Accent requires text or a group");
          if ([...value].length !== 1) texError(this.context, "Accent requires one Unicode scalar");
          append(out, {t: "Str", c: (value + accents[name]).normalize("NFC") + remainder});
        } else if (name === "href" || name === "url" || name === "includegraphics") {
          const attr = empty();
          const option = name === "includegraphics" ? cursor.optional() : undefined;
          if (option) attr[2].push(["latex-options", option.raw.slice(1, -1)]);
          const url = this.literal(cursor.group().children, depth + 1);
          const label = name === "href" ? this.inlines(cursor.group().children, depth + 1) : name === "url" ? [{t: "Str" as const, c: url}] : [];
          append(out, {t: name === "includegraphics" ? "Image" : "Link", c: [attr, label, [url, ""]]});
        } else if (name === "ref" || name === "eqref" || name === "pageref") {
          const key = texSource(cursor.group().children);
          if (name === "pageref") {append(out, this.raw(t.raw + `{${key}}`)); continue;}
          this.context.charge("references", 1);
          const content: Inline[] = [];
          this.references.push({name: key, content});
          append(out, {t: "Link", c: [empty(), content, [`#${key}`, ""]]});
        } else if (name === "footnote") append(out, {t: "Note", c: this.blocks(cursor.group().children, depth + 1)});
        else {
          let raw = t.raw;
          if (tokens[cursor.index]?.kind === "text" && tokens[cursor.index]?.text === "*") raw += tokens[cursor.index++]!.raw;
          append(out, this.raw(raw + cursor.argumentsRaw()));
        }
      }
    }
    return out;
  }
  table(tokens: readonly TexToken[], depth: number): Block {
    const cursor = new TexCursor(tokens, this.context);
    const spec = texSource(cursor.group().children);
    const cols: ColSpec[] = [];
    const alignments: Record<string, Alignment> = {l: "AlignLeft", c: "AlignCenter", r: "AlignRight"};
    for (const c of spec) {
      this.context.checkpoint();
      if (alignments[c]) cols.push([alignments[c], {t: "ColWidthDefault"}]);
      else if (c !== "|" && c !== " " && c !== "\n") texError(this.context, `Unsupported tabular column specification: ${spec}`, "E_CAPABILITY");
    }
    if (!cols.length) texError(this.context, "Empty tabular columns");
    this.context.bound("tableColumns", cols.length);
    const rows: Row[] = [];
    let cells: Cell[] = [];
    let content: TexToken[] = [];
    let rules = 0;
    const cell = () => {
      const c = new TexCursor(content, this.context); c.skip();
      let span = 1;
      let alignment: Alignment = "AlignDefault";
      let inlines: Inline[];
      if (content[c.index]?.kind === "command" && content[c.index]?.text === "multicolumn") {
        c.index++;
        const count = texSource(c.group().children).trim();
        if (!count || [...count].some(c => c < "0" || c > "9")) texError(this.context, "Invalid multicolumn span");
        span = Number(count);
        if (!Number.isSafeInteger(span) || span < 1 || span > cols.length) texError(this.context, "Invalid multicolumn span");
        const spec = texSource(c.group().children).split("|").join("").trim();
        if (!alignments[spec]) texError(this.context, "Unsupported multicolumn alignment", "E_CAPABILITY");
        alignment = alignments[spec];
        inlines = this.inlines(c.group().children, depth + 1);
        c.skip(); if (c.index !== content.length) texError(this.context, "Content after multicolumn argument");
      } else inlines = trim(this.inlines(content, depth + 1));
      this.context.charge("tableCells", 1);
      cells.push([empty(), alignment, 1, span, [{t: "Plain", c: inlines}]]);
      content = [];
    };
    const row = () => {
      cell();
      if (cells.reduce((n, c) => n + c[3], 0) !== cols.length) texError(this.context, "Tabular row does not match column count");
      this.context.charge("tableRows", 1);
      rows.push([empty(), cells]); cells = [];
    };
    while (cursor.index < tokens.length) {
      const token = tokens[cursor.index++]!;
      if (token.kind === "text" && token.text === "&") cell();
      else if (token.kind === "command" && token.text === "\\") row();
      else if (token.kind === "command" && token.text === "hline") rules++;
      else content.push(token);
    }
    if (cells.length || content.some(t => t.kind !== "space" && t.kind !== "comment")) row();
    if (!rows.length) texError(this.context, "Tabular has no rows");
    const attr = empty();
    attr[2].push(["latex-column-spec", spec]);
    if (rules) attr[2].push(["latex-hlines", String(rules)]);
    return {t: "Table", c: [attr, [null, []], cols, [empty(), []], [[empty(), 0, [], rows]], [empty(), []]]};
  }
  blocks(tokens: readonly TexToken[], depth = 0): Block[] {
    this.context.bound("depth", depth);
    const out: Block[] = [];
    let pending: TexToken[] = [];
    let target: {attr: [string, string[], [string, string][]]; title: readonly Inline[]} | undefined;
    const flush = () => {const c = trim(this.inlines(pending, depth + 1)); if (c.length) out.push({t: "Para", c}); pending = [];};
    const cursor = new TexCursor(tokens, this.context);
    while (cursor.index < tokens.length) {
      this.context.checkpoint();
      const token = tokens[cursor.index++]!;
      if (token.kind === "space" && token.text.split("\n").length > 2 || token.kind === "command" && token.text === "par") {flush(); continue;}
      if (token.kind === "command" && levels[token.text]) {
        flush();
        const attr = empty();
        if (tokens[cursor.index]?.kind === "text" && tokens[cursor.index]?.text === "*") {cursor.index++; attr[1].push("unnumbered");}
        const short = cursor.optional();
        if (short) attr[2].push(["short-title", short.raw.slice(1, -1)]);
        const title = this.inlines(cursor.group().children, depth + 1);
        out.push({t: "Header", c: [levels[token.text]!, attr, title]}); target = {attr, title};
      } else if (token.kind === "command" && ["title", "author", "date", "documentclass"].includes(token.text)) {
        flush();
        const options = token.text === "documentclass" ? cursor.optional() : undefined;
        const content = cursor.group().children;
        this.metadata[token.text] = {t: "MetaInlines", c: this.inlines(content, depth + 1)};
        if (options) this.metadata["documentclass-options"] = {t: "MetaString", c: options.raw.slice(1, -1)};
      } else if (token.kind === "command" && token.text === "maketitle") {
        flush(); // Represent the requested title placement as a Div, retaining metadata.
        const title = this.metadata.title;
        out.push({t: "Div", c: [["", ["title-block"], []], title?.t === "MetaInlines" ? [{t: "Para", c: title.c}] : []]});
      } else if (token.kind === "command" && token.text === "label") {
        const name = texSource(cursor.group().children);
        if (!name || this.labels.has(name)) texError(this.context, "Empty or duplicate label");
        if (!target) {
          const attr = empty();
          pending.push({kind: "group", text: "", raw: "", children: []});
          flush(); out.push({t: "Div", c: [attr, []]}); target = {attr, title: [{t: "Str", c: name}]};
        }
        if (target.attr[0]) texError(this.context, "Multiple labels for one structure are unsupported", "E_CAPABILITY");
        target.attr[0] = name; this.labels.set(name, target.title);
      } else if (token.kind === "environment") {
        flush();
        if (token.text === "document") out.push(...this.blocks(token.children, depth + 1));
        else if (token.text === "quote" || token.text === "quotation") out.push({t: "BlockQuote", c: this.blocks(token.children, depth + 1)});
        else if (token.text === "verbatim" || token.text === "verbatim*") out.push({t: "CodeBlock", c: [empty(), token.children[0]!.text]});
        else if (token.text === "itemize" || token.text === "enumerate" || token.text === "description") {
          const items: Block[][] = [];
          const terms: Inline[][] = [];
          let item: TexToken[] | undefined;
          const inner = new TexCursor(token.children, this.context);
          while (inner.index < token.children.length) {
            const t = token.children[inner.index++]!;
            if (t.kind === "command" && t.text === "item") {
              if (item) items.push(this.blocks(item, depth + 1));
              item = [];
              const label = inner.optional();
              const term = label && "children" in label ? this.inlines(label.children, depth + 1) : [];
              terms.push(term);
              if (term.length && token.text !== "description") item.push(label!);
            } else if (item) item.push(t);
            else if (t.kind !== "space" && t.kind !== "comment") texError(this.context, "Content before first list item");
          }
          if (item) items.push(this.blocks(item, depth + 1));
          if (!items.length) texError(this.context, "List has no items");
          if (token.text === "description") out.push({t: "DefinitionList", c: items.map((item, i) => [terms[i]!, [item]])});
          else out.push(token.text === "itemize" ? {t: "BulletList", c: items} : {t: "OrderedList", c: [[1, "Decimal", "Period"], items]});
        } else if (token.text === "tabular") {
          const block = this.table(token.children, depth + 1); out.push(block);
          if (block.t === "Table") target = {attr: block.c[0] as [string, string[], [string, string][]], title: []};
        } else if (token.text === "figure" || token.text === "table") {
          const inner = new TexCursor(token.children, this.context);
          const position = inner.optional();
          const attr = empty(); if (position) attr[2].push(["latex-placement", position.raw.slice(1, -1)]);
          let caption: Caption = [null, []];
          let hasCaption = false;
          const body: TexToken[] = [];
          while (inner.index < token.children.length) {
            const t = token.children[inner.index++]!;
            if (t.kind === "command" && t.text === "caption") {
              if (hasCaption) texError(this.context, "Repeated float caption");
              hasCaption = true;
              const short = inner.optional(); if (short) attr[2].push(["short-caption", short.raw.slice(1, -1)]);
              const c = this.inlines(inner.group().children, depth + 1); caption = [null, [{t: "Plain", c}]];
            } else if (t.kind === "command" && t.text === "label") {
              const label = texSource(inner.group().children);
              if (!label || attr[0] || this.labels.has(label)) texError(this.context, "Empty or duplicate float label");
              attr[0] = label;
            } else body.push(t);
          }
          const blocks = this.blocks(body, depth + 1);
          const title = caption[1][0]; const inlines = title?.t === "Plain" ? title.c : [];
          if (attr[0]) this.labels.set(attr[0], inlines);
          if (token.text === "figure") out.push({t: "Figure", c: [attr, caption, blocks]});
          else {
            if (blocks.length !== 1 || blocks[0]?.t !== "Table") texError(this.context, "Table float must contain one tabular", "E_CAPABILITY");
            const table = blocks[0];
            for (const pair of table.c[0][2]) attr[2].push([pair[0], pair[1]]);
            out.push({t: "Table", c: [attr, caption, table.c[2], table.c[3], table.c[4], table.c[5]]});
          }
          target = {attr, title: inlines};
        } else {this.raw(token.raw); out.push({t: "RawBlock", c: ["latex", token.raw]});}
      } else pending.push(token);
    }
    flush(); return out;
  }
}
export const latexReader: ReaderCapability = {
  format: "latex",
  async read(input, context) {
    const tokens = await parseTex(input.text ?? await context.decodeUtf8([input.bytes]), context);
    const expanded = await expandTex(tokens, context, input.base);
    const reader = new LatexReader(context);
    const blocks = reader.blocks(expanded);
    const pending = new Map(reader.references.map(ref => [ref.content, ref]));
    const resolved = new Set<string>();
    const resolve = (ref: typeof reader.references[number], stack: readonly string[], depth: number): void => {
      context.bound("depth", depth);
      if (stack.includes(ref.name)) texError(context, `Cyclic reference title: ${ref.name}`, "E_CAPABILITY");
      if (ref.content.length) return;
      const label = reader.labels.get(ref.name);
      if (!label) texError(context, `Unresolved reference: ${ref.name}`, "E_CAPABILITY");
      const visit = (value: unknown, depth: number): void => {
        context.checkpoint(); context.bound("depth", depth);
        if (!value || typeof value !== "object") return;
        const other = pending.get(value as Inline[]);
        if (other) {resolve(other, [...stack, ref.name], depth + 1); return;}
        for (const child of Object.values(value)) visit(child, depth + 1);
      };
      if (!resolved.has(ref.name)) visit(label, depth + 1);
      resolved.add(ref.name);
      for (const inline of label) ref.content.push(inline);
    };
    for (const ref of reader.references) resolve(ref, [], 0);
    return {blocks, metadata: reader.metadata, resources: []};
  }
};
