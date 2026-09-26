import type {Attr, Block, Inline} from "./ast-types.js";
import {assertNever} from "./ast-types.js";
import type {AdapterContext, Document, SerializedDocument} from "./types.js";
import {rstColumnWidth} from "./rst-column-width.js";
import {PandocError} from "./errors.js";

function indent(text: string, width: number): string {
  return text.split("\n").map(line => line ? " ".repeat(width) + line : "").join("\n");
}
function markedBody(marker: string, body: string): string {
  // Establish the content column before an indented first block. Footnote
  // directives otherwise dedent an all-quote body into ordinary paragraphs.
  if(body.startsWith(" ")) return marker.trimEnd() + "\n\n" + indent("..\n\n" + body, marker.length);
  return marker + indent(body, marker.length).slice(body ? marker.length : 0);
}
class RstWriter {
  private readonly definitions: string[] = [];
  private readonly notes: {blocks: readonly Block[]; path: string}[] = [];
  private serial = 0;
  private sourceText = "";
  private readonly labels = new Map<string, string>();
  private readonly usedNames = new Set<string>();
  private readonly ids = new Map<string, number>();
  private readonly targets = new Set<string>();
  constructor(private readonly context: AdapterContext) {}
  fail(message: string, path: string): never {
    throw new PandocError("E_UNSUPPORTED_FEATURE", this.context.operation ?? "write", message, "rst", path);
  }
  loss(message: string, path: string): void {
    if(!this.context.lossy) this.fail(message, path);
    this.context.report({code: "W_TABLE_LOSS", operation: this.context.operation ?? "write", format: "rst", location: path, message});
  }
  retain(text: string): string {
    this.context.checkpoint(text.length + 1);
    this.context.bound("outputBytes", text.length);
    this.context.charge("retainedBytes", text.length * 2);
    return text;
  }
  escape(text: string, path: string, literal = false): string {
    let out = "";
    for(const ch of text) {
      this.context.checkpoint();
      if(ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) this.fail("Control character in inline text", path);
      out += !literal && "\\`*_|<>[]:.+-#!".includes(ch) ? `\\${ch}` : ch;
    }
    return this.retain(out);
  }
  attrs(attr: Attr, path: string, language = false): string {
    if(attr[1].length && !language || attr[2].length || language && attr[1].length > 1) this.loss("Dropped unsupported RST attributes", path);
    if(!attr[0]) return "";
    const count = (this.ids.get(attr[0]) ?? 0) + 1;
    this.ids.set(attr[0], count);
    const base = this.id(attr[0]);
    return `.. _${count > 1 ? this.unique(`${base}-dup-${count}`) : base}:\n\n`;
  }
  id(source: string): string {
    let name = this.labels.get(source);
    if(!name) {
      name = this.unique("pc-id-" + [...source].map(ch => ch.codePointAt(0)!.toString(16)).join("-"));
      this.labels.set(source, name);
    }
    return name;
  }
  unique(base: string): string {
    let name = base, count = 1;
    while(this.usedNames.has(name) || this.sourceText.includes(name)) {this.context.checkpoint(); name = `${base}-ref-${++count}`;}
    this.context.charge("references", 1); this.context.charge("retainedBytes", name.length * 2);
    this.usedNames.add(name); return name;
  }
  reference(kind: string): string {
    let name: string;
    do {this.context.checkpoint(); name = `pc-${kind}-${++this.serial}`;} while(this.sourceText.includes(name) || this.usedNames.has(name));
    return this.unique(name);
  }
  safeTarget(target: string, path: string): string {
    if(!target || target.trim() !== target || [...target].some(ch => ch.charCodeAt(0) <= 32 || "`<>\\".includes(ch))) this.fail("Unsupported RST target syntax", path);
    return target;
  }
  inlines(nodes: readonly Inline[], path: string, nested = false, literal = false): string {
    const pieces: {text: string; markup: boolean}[] = [];
    for(const [i, node] of nodes.entries()) {
      const p = `${path}[${i}]`;
      this.context.checkpoint();
      let text = "", markup = false;
      const children = (c: readonly Inline[]) => this.inlines(c, `${p}.c`, true, literal);
      switch(node.t) {
        case "Str": text = this.escape(node.c, p, literal); break;
        case "Space": case "SoftBreak": text = " "; break;
        case "LineBreak": this.loss("Inline line break projected to space; use LineBlock", p); text = " "; break;
        case "Emph": case "Strong": case "Superscript": case "Subscript": {
          const content = children(node.c);
          if(nested) {this.loss("Nested RST inline style projected to text", p); text = content; break;}
          if(!content || content.trim() !== content) this.fail("Empty or whitespace-bounded inline style", p);
          text = node.t === "Emph" ? `*${content}*` : node.t === "Strong" ? `**${content}**` : `:${node.t === "Superscript" ? "sup" : "sub"}:\`${content}\``;
          markup = true; break;
        }
        case "Underline": case "Strikeout": case "SmallCaps": this.loss(`Projected unsupported ${node.t} to text`, p); text = children(node.c); break;
        case "Quoted": text = (node.c[0] === "SingleQuote" ? "‘" : "“") + this.inlines(node.c[1], `${p}.c[1]`, nested, literal) + (node.c[0] === "SingleQuote" ? "’" : "”"); break;
        case "Span": this.loss("Projected unsupported Span to text", p); text = this.inlines(node.c[1], `${p}.c[1]`, nested, literal); break;
        case "Cite": this.loss("Projected citation to displayed text", p); text = this.inlines(node.c[1], `${p}.c[1]`, nested, literal); break;
        case "Code": {
          if(node.c[0][0] || node.c[0][1].length || node.c[0][2].length) this.loss("Dropped inline code attributes", p);
          if(nested) {this.loss("Nested inline code projected to text", p); text = this.escape(node.c[1], p, literal); break;}
          if(!node.c[1] || node.c[1].trim() !== node.c[1] || node.c[1].includes("``") || node.c[1].startsWith("`") || node.c[1].endsWith("`") || node.c[1].includes("\n")) this.fail("Unrepresentable inline literal", p);
          text = `\`\`${node.c[1]}\`\``; markup = true; break;
        }
        case "Math": this.loss("Math projected to literal source (no math extension)", p); text = this.escape(node.c[1], p, literal); break;
        case "RawInline": this.loss("Raw inline projected to escaped text", p); text = this.escape(node.c[1], p, literal); break;
        case "Link": {
          if(nested) {this.loss("Nested link projected to displayed text", p); text = this.inlines(node.c[1], `${p}.c[1]`, true, literal); break;}
          if(node.c[0][0] || node.c[0][1].length || node.c[0][2].length || node.c[2][1]) this.loss("Dropped link attributes/title", p);
          const label = this.inlines(node.c[1], `${p}.c[1]`, true);
          if(!label || label.trim() !== label) this.fail("Empty or whitespace-bounded link", p);
          const name = this.reference("link"), target = node.c[2][0];
          if(target.startsWith("#") && !this.targets.has(target.slice(1))) this.fail("Unresolved internal reference", p);
          this.definitions.push(`.. _${name}: ${target.startsWith("#") ? this.id(target.slice(1)) + "_" : this.safeTarget(target, p)}`);
          text = `\`${label} <${name}_>\`_`; markup = true; break;
        }
        case "Image": {
          if(nested) this.fail("Image nested in inline markup", p);
          if(node.c[0][0] || node.c[0][1].length || node.c[0][2].length || node.c[2][1]) this.loss("Dropped image attributes/title", p);
          const alt = this.inlines(node.c[1], `${p}.c[1]`, true, true), name = this.reference("image");
          this.definitions.push(`.. |${name}| image:: ${this.safeTarget(node.c[2][0], p)}${alt ? `\n   :alt: ${alt}` : ""}`);
          text = `|${name}|`; markup = true; break;
        }
        case "Note":
          if(nested) this.fail("Note nested in inline markup", p);
          this.notes.push({blocks: node.c, path: `${p}.c`}); text = `[${this.notes.length}]_`; markup = true; break;
        default: assertNever(node);
      }
      pieces.push({text, markup});
    }
    let out = "";
    for(const [i, piece] of pieces.entries()) {
      const previous = pieces[i - 1];
      if(previous && (previous.markup || piece.markup) && previous.text && piece.text && !previous.text.endsWith(" ") && !piece.text.startsWith(" ")) out += "\\ ";
      out += piece.text;
    }
    return this.retain(out);
  }
  blocks(nodes: readonly Block[], path: string): string {
    const pieces: string[] = [];
    for(const [i, node] of nodes.entries()) {
      this.context.checkpoint(); const p = `${path}[${i}]`;
      let text: string;
      switch(node.t) {
        case "Plain": case "Para": text = this.inlines(node.c, `${p}.c`); break;
        case "Header": {
          const [level, attr, content] = node.c;
          if(level > 9) this.loss("Heading level projected to level nine", p);
          text = this.inlines(content, `${p}.c[2]`);
          if(!text) this.fail("Empty heading", p);
          text = this.attrs(attr, p) + text + "\n" + "=-~^\"'+:#"[Math.min(level, 9) - 1]!.repeat(rstColumnWidth(text)); break;
        }
        case "CodeBlock": {
          const lang = node.c[0][1][0];
          if(lang && [...lang].some(ch => !"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-+".includes(ch))) this.fail("Unsupported code language", p);
          if(!node.c[1]) this.fail("Empty code block", p);
          text = this.attrs(node.c[0], p, true) + (lang ? `.. code:: ${lang}` : "::") + "\n\n" + indent(node.c[1], 3); break;
        }
        case "RawBlock": this.loss("Raw block projected to literal code", p); text = "::\n\n" + indent(node.c[1], 3); break;
        case "HorizontalRule":
          if(i === 0 || i === nodes.length - 1 || nodes[i - 1]?.t === "Header" || nodes[i - 1]?.t === "HorizontalRule" || nodes[i + 1]?.t === "HorizontalRule") this.fail("RST transition requires content on both sides", p);
          text = "----"; break;
        case "BlockQuote": {
          const body = this.blocks(node.c, `${p}.c`);
          if(!body) this.fail("Empty block quote", p);
          text = indent(body.startsWith(" ") ? "..\n\n" + body : body, 3); break;
        }
        case "Div": this.loss("Div projected to contained blocks", p); text = this.attrs(node.c[0], p) + this.blocks(node.c[1], `${p}.c[1]`); break;
        case "Figure": this.loss("Figure projected to content and caption", p); text = this.blocks(node.c[2], `${p}.c[2]`) + "\n\n" + this.blocks(node.c[1][1], `${p}.c[1][1]`); if(node.c[1][0]?.length) text += "\n\n" + this.inlines(node.c[1][0], p); break;
        case "LineBlock": text = node.c.map((line, j) => "| " + this.inlines(line, `${p}.c[${j}]`)).join("\n"); break;
        case "BulletList": case "OrderedList": {
          const ordered = node.t === "OrderedList";
          if(ordered && (!["Decimal", "DefaultStyle"].includes(node.c[0][1]) || !["Period", "DefaultDelim"].includes(node.c[0][2]))) this.loss("List style projected to decimal period", p);
          text = (ordered ? node.c[1] : node.c).map((item, j) => {
            const body = this.blocks(item, `${p}.c${ordered ? "[1]" : ""}[${j}]`);
            if(!body) this.fail("Empty list item", p);
            const marker = ordered ? `${node.c[0][0] + j}. ` : "* ";
            // A leading directive/list/literal needs its own indented block after the marker.
            const first = item[0];
            return first?.t === "Para" || first?.t === "Plain" ? marker + indent(body, marker.length).slice(marker.length) : marker.trimEnd() + "\n\n" + indent(body, marker.length);
          }).join("\n\n"); break;
        }
        case "DefinitionList": text = node.c.map(([term, defs], j) => {
          const name = this.inlines(term, `${p}.c[${j}][0]`), body = defs.map((def, k) => this.blocks(def, `${p}.c[${j}][1][${k}]`)).join("\n\n");
          if(!name || !body) this.fail("Empty definition", p);
          if(defs.length > 1) this.loss("Multiple definitions merged into one body", p);
          return name + "\n" + indent(body.startsWith(" ") ? "..\n\n" + body : body, 3);
        }).join("\n\n"); break;
        case "Table": {
          const t = node.c;
          if(t[0][0] || t[0][1].length || t[0][2].length || t[1][0]?.length || t[1][1].length) this.loss("Dropped table attributes/caption", p);
          for(const col of t[2]) if(col[0] !== "AlignDefault" || col[1].t !== "ColWidthDefault") this.loss("Dropped table alignment/width", p);
          const head = t[3][1];
          if(head.length > 1) this.fail("List-table supports one header row", p);
          const rows = [...head, ...t[4].flatMap(b => [...b[2], ...b[3]]), ...t[5][1]];
          for(const section of [t[3][0], ...t[4].map(b => b[0]), t[5][0]]) if(section[0] || section[1].length || section[2].length) this.loss("Dropped table section attributes", p);
          for(const b of t[4]) if(b[1] || b[2].length) this.loss("Dropped body header semantics", p);
          text = `.. list-table::\n   :header-rows: ${head.length}\n\n` + rows.map((row, j) => {
            if(row[0][0] || row[0][1].length || row[0][2].length) this.loss("Dropped row attributes", p);
            if(row[1].length !== t[2].length) this.fail("Incomplete or spanning table row", p);
            return row[1].map((cell, k) => {
              if(cell[2] !== 1 || cell[3] !== 1) this.fail("Table spans unsupported", p);
              if(cell[0][0] || cell[0][1].length || cell[0][2].length || cell[1] !== "AlignDefault") this.loss("Dropped cell attributes/alignment", p);
              const body = this.blocks(cell[4], `${p}.c.rows[${j}][${k}]`);
              return markedBody(k ? "     - " : "   * - ", body);
            }).join("\n");
          }).join("\n");
          if(!rows.length || !t[2].length) this.fail("Empty table", p);
          break;
        }
        default: assertNever(node);
      }
      if(!text && !["Plain", "Para", "Div", "Figure"].includes(node.t)) this.fail("Empty RST structural container", p);
      const previous = nodes[i - 1];
      const lists = ["BulletList", "OrderedList"];
      if(previous && (lists.includes(previous.t) && (lists.includes(node.t) || node.t === "BlockQuote") || previous.t === "DefinitionList" && node.t === "BlockQuote" || previous.t === node.t && ["BlockQuote", "DefinitionList"].includes(node.t))) pieces.push("..");
      pieces.push(this.retain(text));
    }
    return this.retain(pieces.join("\n\n"));
  }
  async write(document: Document): Promise<SerializedDocument> {
    await this.context.cooperate();
    const reserve = (value: unknown): string => {
      this.context.checkpoint();
      if(Array.isArray(value)) {
        return this.retain(value.map(child => reserve(child)).join(""));
      } else if(value && typeof value === "object") {
        if("t" in value && ["Space", "SoftBreak", "LineBreak"].includes(String(value.t))) return " ";
        if("t" in value && "c" in value && ["Header", "CodeBlock", "Div"].includes(String(value.t))) {
          const block = value as Extract<Block, {t: "Header" | "CodeBlock" | "Div"}>;
          const attr = block.t === "Header" ? block.c[1] : block.c[0];
          if(attr[0]) this.targets.add(attr[0]);
        }
        if("c" in value) return reserve(value.c);
        return this.retain(Object.values(value).map(child => reserve(child)).join(""));
      }
      return typeof value === "string" ? value : "";
    };
    this.sourceText = reserve(document.blocks).toLowerCase();
    const text = this.blocks(document.blocks, "$.blocks");
    for(let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i]!, body = this.blocks(note.blocks, note.path);
      if(!body) this.fail("Empty note", note.path);
      const marker = `.. [${i + 1}] `;
      this.definitions.push(markedBody(marker, body));
    }
    return {kind: "text", text: this.retain([text, ...this.definitions].filter(Boolean).join("\n\n") + (text || this.definitions.length ? "\n" : ""))};
  }
}
export async function writeRst(document: Document, context: AdapterContext): Promise<SerializedDocument> {
  return new RstWriter(context).write(document);
}
