import { PandocError } from "./errors.js";
import type { Attr, Block, Inline, Alignment } from "./ast-types.js";
import type { AdapterContext, Document, SerializedDocument } from "./types.js";
import { inspectRtfPicture } from "./rtf-pictures.js";

const formatting = {Emph: "i", Strong: "b", Underline: "ul", Strikeout: "strike", Superscript: "super", Subscript: "sub", SmallCaps: "scaps"};
const alignments = {AlignDefault: "ql", AlignLeft: "ql", AlignRight: "qr", AlignCenter: "qc"};
interface ListSpec {id: number; level: number; nfc: number; start: number; delim: string}
interface Paragraph {indent: number; direction: "ltr" | "rtl"; cell?: Alignment; marker?: string | undefined; style?: number; list?: ListSpec}

class RtfWriter {
  private readonly chunks: string[] = [];
  private length = 0;
  private readonly fonts: string[] = [];
  private readonly colors: string[] = [];
  private readonly resources = new Map<string, Uint8Array>();
  private readonly imageTargets = new Set<string>();
  private readonly lists = new Map<object, ListSpec>();
  constructor(private readonly context: AdapterContext) {}
  fail(message: string, code: "E_CAPABILITY" | "E_RESOURCE" | "E_OPTION" = "E_CAPABILITY"): never {
    throw new PandocError(code, this.context.operation ?? "write", message, "rtf");
  }
  add(text: string): void {
    this.context.checkpoint(text.length + 1);
    this.context.bound("outputBytes", this.length + text.length);
    this.context.charge("retainedBytes", text.length * 2);
    this.context.charge("references", 1);
    this.length += text.length; this.chunks.push(text);
  }
  text(text: string): void {
    // UTF-16 units deliberately encode both halves of a non-BMP scalar.
    for(let i = 0; i < text.length; i++) {
      const n = text.charCodeAt(i), ch = text[i]!;
      if("{}\\".includes(ch)) this.add("\\" + ch);
      else if(ch === "\t") this.add("\\tab ");
      else if(ch === "\n") this.add("\\line ");
      else if(ch === "\r") {if(text[i + 1] !== "\n") this.add("\\line ");}
      else if(n < 32 || n === 127) this.fail("Unsupported RTF text control");
      else if(n >= 128) this.add(`\\u${n > 32767 ? n - 65536 : n} ?`);
      else this.add(ch);
    }
  }
  attrs(attr: Attr, paragraph = false): void {
    if(attr[0] || attr[1].length) this.fail("Unsupported RTF identifiers or classes");
    for(const [key, value] of attr[2]) {
      if(key === "font-family") {
        const id = this.fonts.indexOf(value);
        if(id < 0) this.fail("Font reference must be explicitly declared in rtf-fonts metadata", "E_RESOURCE");
        this.add(`\\f${id + 1}`);
      } else if(key === "color") this.add(`\\cf${this.colors.indexOf(value.toLowerCase()) + 1}`);
      else if(key === "font-size") {
        if(!value.endsWith("pt")) this.fail("RTF font-size requires points");
        const n = Number(value.slice(0, -2)) * 2;
        if(!Number.isSafeInteger(n) || n < 1 || n > 32767) this.fail("Invalid RTF font-size");
        this.add(`\\fs${n}`);
      } else if(key === "dir" && ["ltr", "rtl"].includes(value)) this.add(`\\${value}${paragraph ? "par" : "ch"}`);
      else if(key === "text-align" && paragraph && ["left", "right", "center", "justify"].includes(value))
        this.add(`\\${{left: "ql", right: "qr", center: "qc", justify: "qj"}[value]}`);
      else this.fail(`Unsupported RTF attribute: ${key}`);
    }
  }
  async collect(value: unknown, listDepth = 0): Promise<void> {
    await this.context.cooperate();
    if(!value || typeof value !== "object") return;
    if("t" in value && (value.t === "OrderedList" || value.t === "BulletList")) {
      if(listDepth > 8) this.fail("RTF supports at most nine nested list levels");
      const node = value as Extract<Block, {t: "OrderedList" | "BulletList"}>;
      const ordered = node.t === "OrderedList";
      const start = ordered ? node.c[0][0] : 1;
      const style = ordered ? node.c[0][1] : "DefaultStyle";
      this.marker(start, style);
      this.context.charge("references", 1);
      this.lists.set(value, {id: this.lists.size + 1, level: listDepth++, start,
        nfc: ordered ? ({UpperRoman: 1, LowerRoman: 2, UpperAlpha: 3, LowerAlpha: 4} as Record<string, number>)[style] ?? 0 : 23,
        delim: ordered ? node.c[0][2] : "Period"});
    }
    if("t" in value && value.t === "Image") this.imageTargets.add((value as Extract<Inline, {t: "Image" | "Link"}>).c[2][0]);
    if(Array.isArray(value) && value.length === 2 && value[0] === "color") {
      const color = value[1];
      if(typeof color !== "string" || color.length !== 7 || color[0] !== "#" || [...color.slice(1)].some(c => !"0123456789abcdefABCDEF".includes(c))) this.fail("Invalid RTF RGB color");
      if(!this.colors.includes(color.toLowerCase())) {this.context.charge("references", 1); this.colors.push(color.toLowerCase());}
    }
    for(const child of Object.values(value)) await this.collect(child, listDepth);
  }
  async inlines(nodes: readonly Inline[]): Promise<void> {
    for(const node of nodes) {
      await this.context.cooperate();
      switch(node.t) {
        case "Str": this.text(node.c); break;
        case "Space": case "SoftBreak": this.add(" "); break;
        case "LineBreak": this.add("\\line "); break;
        case "Emph": case "Strong": case "Underline": case "Strikeout": case "Superscript": case "Subscript": case "SmallCaps":
          this.add(`{\\${formatting[node.t]} `); await this.inlines(node.c); this.add("}"); break;
        case "Span": this.add("{"); this.attrs(node.c[0]); if(node.c[0][2].length) this.add(" "); await this.inlines(node.c[1]); this.add("}"); break;
        case "Code": this.add("{"); this.attrs(node.c[0]); if(node.c[0][2].length) this.add(" "); this.text(node.c[1]); this.add("}"); break;
        case "Quoted": this.text(node.c[0] === "SingleQuote" ? "‘" : "“"); await this.inlines(node.c[1]); this.text(node.c[0] === "SingleQuote" ? "’" : "”"); break;
        case "Link": {
          const url = node.c[2][0];
          if(!url || url.trim() !== url || [...url].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '\\{}"'.includes(c))) this.fail("Unsafe RTF hyperlink");
          const colon = url.indexOf(":");
          if(colon >= 0 && !["https", "http", "mailto", "tel"].includes(url.slice(0, colon).toLowerCase())) this.fail("Unsupported RTF hyperlink scheme");
          if(node.c[2][1]) this.fail("RTF link titles unsupported");
          this.add('{\\field{\\*\\fldinst HYPERLINK "'); this.text(url); this.add('"}{\\fldrslt ');
          this.attrs(node.c[0]); if(node.c[0][2].length) this.add(" "); await this.inlines(node.c[1]); this.add("}}"); break;
        }
        case "Image": {
          if(node.c[0][0] || node.c[0][1].length || node.c[0][2].length || node.c[2][1]) this.fail("RTF picture attributes/titles unsupported");
          const id = node.c[2][0];
          let bytes = this.resources.get(id);
          if(!bytes && this.context.resources) {
            bytes = await this.context.resources.resolve(id, undefined, this.context.signal);
            if(!(bytes instanceof Uint8Array)) this.fail("Invalid resource bytes", "E_RESOURCE");
            this.context.charge("resources", 1); this.context.charge("resourceBytes", bytes.length);
          }
          if(!bytes) this.fail(`Missing explicit picture resource: ${id}`, "E_RESOURCE");
          const picture = await inspectRtfPicture(bytes, this.context);
          const header = `{\\pict\\${picture.encoding}blip\\picw${picture.width}\\pich${picture.height}\\picwgoal${picture.width * 15}\\pichgoal${picture.height * 15} `;
          this.context.bound("outputBytes", this.length + bytes.length * 2 + header.length + 1);
          this.add(header);
          for(const byte of bytes) this.add(byte.toString(16).padStart(2, "0"));
          this.add("}"); break;
        }
        default: this.fail(`Unsupported RTF inline: ${node.t}`);
      }
    }
  }
  async paragraph(nodes: readonly Inline[], state: Paragraph, attr?: Attr): Promise<void> {
    this.add(`{\\pard\\plain\\s${state.style ?? 0}`);
    if(state.style) this.add(`\\b\\fs${40 - state.style * 2}`);
    this.add(`\\li${state.indent}\\fi${state.marker ? -360 : 0}\\${state.direction}par`);
    if(state.cell) this.add(`\\intbl\\${alignments[state.cell]}`);
    if(attr) this.attrs(attr, true);
    if(state.marker && state.list) this.add(`\\tx${state.indent}\\ls${state.list.id}\\ilvl${state.list.level}`);
    this.add(" ");
    if(state.marker) {
      this.add("{\\listtext "); this.text(state.marker); this.add("\\tab}");
    }
    await this.inlines(nodes); this.add("\\par}\n");
  }
  marker(n: number, style: string): string {
    if(!Number.isSafeInteger(n) || n < 1 || n > 32767) this.fail("RTF list number outside supported range");
    if(style === "LowerAlpha" || style === "UpperAlpha") {
      let out = ""; while(n) {n--; out = String.fromCharCode(97 + n % 26) + out; n = Math.floor(n / 26);}
      return style === "UpperAlpha" ? out.toUpperCase() : out;
    }
    if(style === "LowerRoman" || style === "UpperRoman") {
      if(n > 3999) this.fail("Roman list number exceeds supported range");
      let out = "";
      for(const [value, letters] of [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]] as const)
        while(n >= value) {n -= value; out += letters;}
      return style === "LowerRoman" ? out.toLowerCase() : out;
    }
    if(style === "Example") this.fail("Example list numbering unsupported");
    return String(n);
  }
  async blocks(nodes: readonly Block[], state: Paragraph): Promise<void> {
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate();
      const current = {...state, marker: i === 0 ? state.marker : undefined};
      switch(node.t) {
        case "Plain": case "Para": await this.paragraph(node.c, current); break;
        case "Header": await this.paragraph(node.c[2], {...current, style: node.c[0]}, node.c[1]); break;
        case "CodeBlock": await this.paragraph([{t: "Code", c: node.c}], current); break;
        case "LineBlock": for(const line of node.c) await this.paragraph(line, current); break;
        case "BlockQuote": await this.blocks(node.c, {...current, indent: state.indent + 720}); break;
        case "Div":
          // Attributes belong to each paragraph so pard/plain cannot erase them.
          if(node.c[0][2].length || node.c[0][0] || node.c[0][1].length) this.fail("Attributed RTF Div unsupported; use paragraph/run attributes");
          await this.blocks(node.c[1], current); break;
        case "BulletList": case "OrderedList": {
          if(current.marker) this.fail("List item must begin with a paragraph");
          const ordered = node.t === "OrderedList";
          const items = ordered ? node.c[1] : node.c;
          for(const [j, item] of items.entries()) {
            let marker = "•";
            if(ordered) {const [start, style, delim] = node.c[0]; marker = (delim === "TwoParens" ? "(" : "") + this.marker(start + j, style) + (["OneParen", "TwoParens"].includes(delim) ? ")" : ".");}
            await this.blocks(item, {...current, indent: state.indent + 360, marker, list: this.lists.get(node)!});
          }
          break;
        }
        case "Table": {
          if(state.cell) this.fail("Nested RTF tables unsupported");
          const t = node.c;
          for(const attr of [t[0], t[3][0], ...t[4].map(b => b[0]), t[5][0]]) if(attr[0] || attr[1].length || attr[2].length) this.fail("Attributed RTF table sections unsupported");
          if(t[1][1].length) await this.blocks(t[1][1], state); else if(t[1][0]) await this.paragraph(t[1][0], state);
          const widths = t[2].map(c => c[1].t === "ColWidth" ? c[1].c : 1 / t[2].length);
          const total = widths.reduce((sum, n) => sum + n, 0);
          if(!widths.length || !Number.isFinite(total) || total <= 0) this.fail("Invalid RTF table widths");
          for(const body of t[4]) if(body[1]) this.fail("RTF row headers unsupported");
          for(const section of [t[3][1], ...t[4].flatMap(b => [b[2], b[3]]), t[5][1]]) for(const row of section) {
            if(row[0][0] || row[0][1].length || row[0][2].length || row[1].length !== widths.length) this.fail("Unsupported RTF table row");
            this.add("{\\trowd"); let width = 0, previous = 0;
            for(const fraction of widths) {
              width += fraction / total * 8640; const end = Math.round(width);
              if(end <= previous || !Number.isSafeInteger(end)) this.fail("RTF column width too small");
              this.add(`\\cellx${end}`); previous = end;
            }
            this.add("\\intbl ");
            for(const [j, cell] of row[1].entries()) {
              if(cell[2] !== 1 || cell[3] !== 1 || cell[0][0] || cell[0][1].length || cell[0][2].length) this.fail("RTF merged or attributed cells unsupported");
              const cellState = {...state, indent: 0, cell: cell[1] === "AlignDefault" ? t[2][j]![0] : cell[1]};
              await this.blocks(cell[4].length ? cell[4] : [{t: "Plain", c: []}], cellState);
              this.add("\\cell ");
            }
            this.add("\\row}\n");
          }
          break;
        }
        default: this.fail(`Unsupported RTF block: ${node.t}`);
      }
    }
  }
  async write(document: Document): Promise<SerializedDocument> {
    const declared = document.metadata["rtf-fonts"];
    if(declared) {
      if(declared.t !== "MetaList") this.fail("rtf-fonts requires a list of reference names", "E_OPTION");
      for(const name of declared.c) {
        if(name.t !== "MetaString" || !name.c || name.c.trim() !== name.c || [...name.c].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 || ";{}\\".includes(c))) this.fail("Invalid RTF font reference", "E_OPTION");
        if(!this.fonts.includes(name.c)) {this.context.charge("fonts", 1); this.fonts.push(name.c);}
      }
    }
    this.fonts.sort(); await this.collect(document.blocks); this.colors.sort();
    for(const resource of document.resources) {
      if(!this.imageTargets.has(resource.id)) this.fail("Unreferenced RTF resource; embedded fonts/objects unsupported", "E_RESOURCE");
      if(this.resources.has(resource.id)) this.fail("Duplicate RTF resource id", "E_RESOURCE");
      this.resources.set(resource.id, resource.bytes);
    }
    this.add("{\\rtf1\\ansi\\ansicpg1252\\uc1{\\fonttbl{\\f0\\fnil ;}");
    for(const [i, font] of this.fonts.entries()) this.add(`{\\f${i + 1}\\fnil ${font};}`);
    this.add("}\n{\\colortbl;");
    for(const color of this.colors) this.add(`\\red${parseInt(color.slice(1, 3), 16)}\\green${parseInt(color.slice(3, 5), 16)}\\blue${parseInt(color.slice(5), 16)};`);
    this.add("}\n{\\stylesheet{\\s0\\fs24 Normal;}");
    for(let level = 1; level <= 6; level++) this.add(`{\\s${level}\\sbasedon0\\snext0\\b\\fs${40 - level * 2} Heading ${level};}`);
    this.add("}\n");
    if(this.lists.size) {
      this.add("{\\*\\listtable");
      for(const list of this.lists.values()) {
        this.add(`{\\list\\listtemplateid${list.id}`);
        for(let level = 0; level <= list.level; level++) {
          this.add(`{\\listlevel\\levelnfc${list.nfc}\\levelstartat${list.start}{\\leveltext`);
          if(list.nfc === 23) this.add("\\'01\\u8226 ?;}{\\levelnumbers;}");
          else {
            const both = list.delim === "TwoParens";
            this.add(both ? "\\'03(" : "\\'02");
            this.add(`\\'${level.toString(16).padStart(2, "0")}${["OneParen", "TwoParens"].includes(list.delim) ? ")" : "."};}{\\levelnumbers\\'0${both ? 2 : 1};}`);
          }
          this.add(`\\fi-360\\li${(level + 1) * 360}}`);
        }
        this.add(`\\listid${list.id}}`);
      }
      this.add("}\n{\\*\\listoverridetable");
      for(const list of this.lists.values()) this.add(`{\\listoverride\\listid${list.id}\\listoverridecount0\\ls${list.id}}`);
      this.add("}\n");
    }
    if(document.direction === "auto") this.fail("Automatic RTF direction unsupported; declare ltr or rtl");
    await this.blocks(document.blocks, {indent: 0, direction: document.direction ?? "ltr"});
    this.add("}\n"); this.context.charge("retainedBytes", this.length * 2);
    return {kind: "text", text: this.chunks.join("")};
  }
}
export async function writeRtf(document: Document, context: AdapterContext): Promise<SerializedDocument> {
  return new RtfWriter(context).write(document);
}
