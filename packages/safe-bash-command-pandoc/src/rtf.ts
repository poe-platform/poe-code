import type { Attr, Block, Cell, Inline, Row } from "./ast-types.js";
import type { AdapterContext, Document, ReaderCapability, Resource } from "./types.js";
import { destination, hexDigit, parseRtf, rtfError } from "./rtf-syntax.js";
import type { RtfGroup, RtfToken } from "./rtf-syntax.js";

const empty: Attr = ["", [], []];
type RunTag = "Strong" | "Emph" | "Underline" | "Strikeout" | "SmallCaps" | "Superscript" | "Subscript";
interface State {
  codepage: number;
  defaultFont: number | undefined;
  uc: number;
  font: number | undefined;
  color: number;
  size: number | undefined;
  tags: Set<RunTag>;
  list: number | undefined;
  level: number;
  alignment: string | undefined;
  left: number | undefined;
  right: number | undefined;
  indent: number | undefined;
  heading: number | undefined;
}
interface Font {name: string; codepage: number | undefined}
type ListStyle = Extract<Block, {t: "OrderedList"}>["c"][0][1];
type ListDelim = Extract<Block, {t: "OrderedList"}>["c"][0][2];
interface ListLevel {start: number; style: ListStyle | "bullet"; delimiter: ListDelim}
interface ListFrame {id: number; level: number; items: Block[][]}
const runControls: Readonly<Record<string, RunTag>> = {
  b: "Strong", i: "Emph", ul: "Underline", strike: "Strikeout", scaps: "SmallCaps", super: "Superscript", sub: "Subscript"
};
const characters: Readonly<Record<string, string>> = {
  emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
  emspace: "\u2003", enspace: "\u2002", qmspace: "\u2005"
};
// These change layout or document bookkeeping, not textual content in the
// declared subset. Unlisted controls fail rather than pretending to support them.
const layoutControls = new Set([
  "deff", "deflang", "deflangfe", "lang", "langfe", "adeflang", "viewkind", "viewscale", "viewzk",
  "fet", "fromtext", "fromhtml", "nouicompat", "widowctrl", "hyphauto", "deftab", "paperw", "paperh",
  "margl", "margr", "margt", "margb", "gutter", "pgnstart", "facingp", "landscape", "sectd",
  "ql", "qr", "qc", "qj", "fi", "li", "ri", "sb", "sa", "sl", "slmult", "keep", "keepn",
  "widctlpar", "nowidctlpar", "tx", "tql", "tqr", "tqc", "tqdec", "tlhyph", "tldot", "tlul",
  "trgaph", "trleft", "trrh", "trql", "trqr", "trqc", "trkeep", "trhdr", "clvertalt", "clvertalc", "clvertalb"
]);
const metadataDestinations = new Set(["info", "generator", "fonttbl", "colortbl", "stylesheet", "listtable", "listoverridetable"]);
const forbiddenDestinations = new Set(["object", "objdata", "objclass", "objname", "objalias", "datafield", "filetbl"]);
const unsupportedDestinations = new Set(["header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "annotation", "shp", "shptxt", "nonshppict", "upr", "ud", "xmlopen", "xmlattrname", "xmlattrvalue"]);
const initial = (): State => ({codepage: 1252, defaultFont: undefined, uc: 1, font: undefined, color: 0, size: undefined, tags: new Set(), list: undefined, level: 0, alignment: undefined, left: undefined, right: undefined, indent: undefined, heading: undefined});

class RtfReader {
  readonly blocks: Block[] = [];
  readonly fonts = new Map<number, Font>();
  readonly styles = new Map<number, {controls: RtfToken[]; basedOn: number | undefined}>();
  readonly lists = new Map<number, ListLevel[]>();
  readonly overrides = new Map<number, {id: number; levels: Partial<ListLevel>[]}>();
  readonly legacyLists = new Map<string, number>();
  readonly colors: (string | undefined)[] = [];
  inlines: Inline[] = [];
  run = "";
  fallback = 0;
  high: number | undefined;
  literal = false;
  inlineOnly = false;
  inNote = false;
  listStack: ListFrame[] = [];
  rows: Row[] = [];
  cells: Cell[] = [];
  cellBlocks: Block[] = [];
  boundaries: number[] | undefined;
  tableColumns = 0;
  constructor(readonly context: AdapterContext, readonly resources: Resource[] = []) {}

  page(page: number, offset = 0): number {
    if (page !== 1252 && page !== 65001) rtfError(this.context, `Unsupported RTF code page ${page}; supported pages are 1252 and 65001`, "E_ENCODING", offset);
    return page;
  }
  parameter(token: Extract<RtfToken, {kind: "word"}>, min = 0, max = 2147483647): number {
    const n = token.parameter;
    if (n === undefined || n < min || n > max) rtfError(this.context, `Invalid RTF ${token.name} parameter`, "E_PARSE", token.offset);
    return n;
  }
  async decode(bytes: Uint8Array, page: number): Promise<string> {
    this.page(page);
    if (page === 1252) return this.context.decodeCodepage(bytes, page);
    const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 256) {
      await this.context.cooperate(256);
      this.context.charge("retainedBytes", 1024);
      let text: string;
      try {text = decoder.decode(bytes.subarray(offset, offset + 256), {stream: true});}
      catch {return rtfError(this.context, `Invalid RTF bytes for code page ${page}`, "E_ENCODING");}
      this.context.charge("text", text.length);
      parts.push(text);
    }
    let tail: string;
    try {tail = decoder.decode();} catch {return rtfError(this.context, `Truncated RTF code-page sequence ${page}`, "E_ENCODING");}
    this.context.charge("text", tail.length);
    parts.push(tail);
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    this.context.charge("retainedBytes", length * 2);
    return parts.join("");
  }
  append(node: Inline): void {
    const last = this.inlines.at(-1);
    if (last?.t === "Str" && node.t === "Str") {
      this.context.charge("retainedBytes", (last.c.length + node.c.length) * 2);
      this.inlines[this.inlines.length - 1] = {t: "Str", c: last.c + node.c};
    } else {
      this.context.charge("references", 1);
      this.context.charge("retainedBytes", 32);
      this.inlines.push(node);
    }
  }
  emit(text: string): void {
    this.context.charge("retainedBytes", text.length * 2);
    this.run += text;
  }
  unicode(code: number): void {
    this.context.charge("text", 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (this.high !== undefined) rtfError(this.context, "Unpaired RTF Unicode surrogate", "E_ENCODING");
      this.high = code; return;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      if (this.high === undefined) rtfError(this.context, "Unpaired RTF Unicode surrogate", "E_ENCODING");
      this.emit(String.fromCharCode(this.high, code)); this.high = undefined; return;
    }
    this.noSurrogate(); this.emit(String.fromCharCode(code));
  }
  noSurrogate(): void {
    if (this.high !== undefined) rtfError(this.context, "Unpaired RTF Unicode surrogate", "E_ENCODING");
  }
  flush(state: State): void {
    if (!this.run) return;
    const content: Inline[] = [];
    let word = "";
    const addWord = () => {if (word) {content.push({t: "Str", c: word}); word = "";}};
    for (const char of this.run) {
      this.context.checkpoint();
      if (char === " " || char === "\t") {addWord(); content.push({t: "Space"});}
      else word += char;
    }
    addWord(); this.run = "";
    if (this.literal) {for (const n of content) this.append(n); return;}
    let wrapped: Inline[] = content;
    const tags: RunTag[] = ["Strong", "Emph", "Underline", "Strikeout", "SmallCaps", "Superscript", "Subscript"];
    for (const tag of tags.reverse()) if (state.tags.has(tag)) wrapped = [{t: tag, c: wrapped}];
    const attributes: [string, string][] = [];
    const fontId = state.font ?? state.defaultFont;
    if (fontId !== undefined) {
      const font = this.fonts.get(fontId);
      if (!font) rtfError(this.context, `Undefined RTF font ${fontId}`, "E_PARSE");
      attributes.push(["font-family", font.name]);
    }
    if (state.color) {
      const color = this.colors[state.color];
      if (!color) rtfError(this.context, `Undefined RTF color ${state.color}`, "E_PARSE");
      attributes.push(["color", color]);
    }
    if (state.size !== undefined) attributes.push(["font-size", `${state.size / 2}pt`]);
    if (attributes.length) wrapped = [{t: "Span", c: [["", [], attributes], wrapped]}];
    for (const node of wrapped) this.append(node);
  }
  paragraph(state: State, explicit = false): void {
    this.noSurrogate(); this.flush(state);
    if (this.inlineOnly) rtfError(this.context, "Block content in RTF field instruction/result", "E_CAPABILITY");
    if (!this.inlines.length && !explicit) return;
    while (this.inlines[0]?.t === "Space") this.inlines.shift();
    while (this.inlines.at(-1)?.t === "Space") this.inlines.pop();
    let node: Block = state.heading === undefined ? {t: "Para", c: this.inlines} : {t: "Header", c: [state.heading, empty, this.inlines]}; this.inlines = [];
    const attributes: [string, string][] = [];
    if (state.alignment !== undefined) attributes.push(["text-align", state.alignment]);
    for (const [key, value] of [["margin-left", state.left], ["margin-right", state.right], ["text-indent", state.indent]] as const)
      if (value !== undefined) attributes.push([key, `${value / 20}pt`]);
    if (attributes.length) node = {t: "Div", c: [["", [], attributes], [node]]};
    if (this.boundaries !== undefined) {this.cellBlocks.push(node); return;}
    this.finishTable();
    if (state.list === undefined) {this.listStack = []; this.blocks.push(node); return;}
    const override = this.overrides.get(state.list);
    const definition = override && this.lists.get(override.id)?.[state.level];
    if (!definition) rtfError(this.context, `Undefined RTF list ${state.list} level ${state.level}`, "E_CAPABILITY");
    const level = {...definition, ...override.levels[state.level]};
    while (this.listStack.length && (this.listStack.at(-1)!.level > state.level || this.listStack.at(-1)!.id !== state.list)) this.listStack.pop();
    if (this.listStack.at(-1)?.level !== state.level) {
      const parent = this.listStack.at(-1);
      if (state.level !== (parent ? parent.level + 1 : 0)) rtfError(this.context, "RTF list skips a nesting level", "E_PARSE");
      const items: Block[][] = [];
      const list: Block = level.style === "bullet" ? {t: "BulletList", c: items} : {t: "OrderedList", c: [[level.start, level.style, level.delimiter], items]};
      if (parent) parent.items.at(-1)!.push(list); else this.blocks.push(list);
      this.listStack.push({id: state.list, level: state.level, items});
    }
    this.listStack.at(-1)!.items.push([node]);
  }
  finishTable(): void {
    if (!this.rows.length) return;
    this.blocks.push({t: "Table", c: [empty, [null, []], Array.from({length: this.tableColumns}, () => ["AlignDefault", {t: "ColWidthDefault"}]), [empty, []], [[empty, 0, [], this.rows]], [empty, []]]});
    this.rows = []; this.tableColumns = 0; this.listStack = [];
  }
  async literalText(group: RtfGroup, state: State): Promise<string> {
    const saved = this.inlines;
    const previousLiteral = this.literal;
    const previousInline = this.inlineOnly;
    this.inlines = []; this.literal = true; this.inlineOnly = true;
    await this.walk(group.children, {...state, tags: new Set(state.tags)}, true);
    this.noSurrogate(); this.flush(state);
    const text = this.inlines.map(n => n.t === "Str" ? n.c : n.t === "Space" ? " " : rtfError(this.context, "Non-text RTF literal", "E_CAPABILITY")).join("");
    this.inlines = saved; this.literal = previousLiteral; this.inlineOnly = previousInline;
    return text;
  }
  async definitions(group: RtfGroup, state: State): Promise<void> {
    const name = destination(group).name;
    const groups = group.children.filter((t): t is RtfGroup => t.kind === "group");
    if (name === "fonttbl") {
      if (group.children.some(t => t.kind === "word" && t.name === "f")) {
        if (groups.length) rtfError(this.context, "Mixed flat and grouped RTF font table", "E_CAPABILITY");
        let font: RtfGroup | undefined;
        for (const token of group.children.slice(1)) {
          if (token.kind === "word" && token.name === "f") {
            font = {kind: "group", children: [], offset: token.offset}; groups.push(font);
          }
          if (!font) rtfError(this.context, "Malformed flat RTF font table");
          font.children.push(token);
        }
      }
      for (const font of groups) {
        await this.context.cooperate(); this.context.charge("fonts", 1);
        let id: number | undefined, page: number | undefined;
        for (const t of font.children) if (t.kind === "word") {
          if (!["f", "fnil", "froman", "fswiss", "fmodern", "fscript", "fdecor", "ftech", "fbidi", "fcharset", "cpg", "fprq", "fttruetype"].includes(t.name)) rtfError(this.context, `Unsupported RTF font control ${t.name}`, "E_CAPABILITY", t.offset);
          if (t.name === "f") id = this.parameter(t);
          if (t.name === "cpg") page = this.page(this.parameter(t), t.offset);
          if (t.name === "fcharset") {
            const charset = this.parameter(t);
            if (charset !== 0 && charset !== 1) {
              rtfError(this.context, `Unsupported RTF font charset ${charset}; only default/ANSI charsets 0 and 1 are supported`, "E_ENCODING", t.offset);
            }
          }
        } else if (t.kind === "group" || t.kind === "binary") rtfError(this.context, "Embedded fonts and nested font destinations are unsupported", "E_CAPABILITY", t.offset);
        if (id === undefined || this.fonts.has(id)) rtfError(this.context, "Missing or duplicate RTF font id");
        const textTokens = font.children.filter(t => t.kind === "text" || t.kind === "hex" || t.kind === "symbol" && ["\\", "{", "}", "~"].includes(t.name));
        const text = await this.literalText({...font, children: textTokens}, {...state, codepage: page ?? state.codepage});
        const end = text.indexOf(";");
        if (end < 0) rtfError(this.context, "Unterminated RTF font name");
        this.fonts.set(id, {name: text.slice(0, end).trim(), codepage: page});
      }
    } else if (name === "colortbl") {
      let rgb: number[] = [0, 0, 0]; let defined = false;
      for (const token of group.children.slice(1)) {
        await this.context.cooperate();
        if (token.kind === "word") {
          const index = ["red", "green", "blue"].indexOf(token.name);
          if (index < 0) rtfError(this.context, "Unsupported RTF color definition", "E_CAPABILITY", token.offset);
          rgb[index] = this.parameter(token, 0, 255); defined = true;
        } else if (token.kind === "text") for (const byte of token.bytes) {
          this.context.checkpoint();
          if (byte === 59) {
            this.context.charge("references", 1);
            this.colors.push(defined ? "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("") : undefined);
            rgb = [0, 0, 0]; defined = false;
          } else if (byte !== 32) rtfError(this.context, "Malformed RTF color table");
        } else rtfError(this.context, "Unsupported RTF color table", "E_CAPABILITY");
      }
      if (defined) rtfError(this.context, "Unterminated RTF color definition");
    } else if (name === "stylesheet") {
      for (const style of groups) {
        const header = style.children[0];
        if (header?.kind !== "word" || !["s", "cs"].includes(header.name)) rtfError(this.context, "Unsupported RTF style definition", "E_CAPABILITY");
        const id = this.parameter(header); let basedOn: number | undefined;
        const controls: RtfToken[] = [];
        for (const t of style.children.slice(1)) if (t.kind === "word") {
          if (t.name === "sbasedon") basedOn = this.parameter(t);
          else if (!["snext", "sautoupd", "additive", "sqformat", "spriority", "sunhideused", "slink"].includes(t.name)) {
            if (!runControls[t.name] && !layoutControls.has(t.name) && !["f", "fs", "cf", "ulnone", "nosupersub", "outlinelevel"].includes(t.name)) rtfError(this.context, `Unsupported RTF style control ${t.name}`, "E_CAPABILITY", t.offset);
            controls.push(t);
          }
        } else if (t.kind !== "text") rtfError(this.context, "Unsupported nested RTF style syntax", "E_CAPABILITY", t.offset);
        this.context.charge("references", 1);
        if (this.styles.has(id)) rtfError(this.context, "Duplicate RTF style");
        this.styles.set(id, {controls, basedOn});
      }
    } else if (name === "listtable") {
      for (const list of groups) {
        if (destination(list).name !== "list") rtfError(this.context, "Unsupported RTF list table", "E_CAPABILITY");
        const id = list.children.find(t => t.kind === "word" && t.name === "listid");
        if (id?.kind !== "word") rtfError(this.context, "Missing RTF list id");
        const levels: ListLevel[] = [];
        for (const level of list.children) {
          if (level.kind === "group" && destination(level).name === "listlevel") levels.push(this.listLevel(level));
          else if (level.kind === "group" && destination(level).name === "listname") continue;
          else if (level.kind !== "word" || !["list", "listid", "listtemplateid", "listsimple", "listhybrid", "listrestarthdn"].includes(level.name)) rtfError(this.context, "Unsupported RTF list definition", "E_CAPABILITY", level.offset);
        }
        if (!levels.length || levels.length > 9) rtfError(this.context, "Invalid RTF list levels");
        const number = this.parameter(id);
        if (this.lists.has(number)) rtfError(this.context, "Duplicate RTF list id");
        this.lists.set(number, levels);
      }
    } else if (name === "listoverridetable") {
      for (const override of groups) {
        let id: number | undefined, index: number | undefined, count = 0;
        const levels: Partial<ListLevel>[] = [];
        for (const t of override.children) {
          if (t.kind === "word" && t.name === "listoverride") continue;
          if (t.kind === "word" && t.name === "listid") id = this.parameter(t);
          else if (t.kind === "word" && t.name === "ls") index = this.parameter(t);
          else if (t.kind === "word" && t.name === "listoverridecount") count = this.parameter(t, 0, 9);
          else if (t.kind === "group") {
            if (destination(t).name !== "lfolevel") rtfError(this.context, "Unsupported RTF list override group", "E_CAPABILITY", t.offset);
            const level: Partial<ListLevel> = {};
            for (const control of t.children) {
              if (control.kind === "word" && control.name === "levelstartat") level.start = this.parameter(control, 1);
              else if (control.kind === "group" && destination(control).name === "listlevel") Object.assign(level, this.listLevel(control));
              else if (control.kind !== "word" || !["lfolevel", "listoverrideformat", "listoverridestartat"].includes(control.name)) rtfError(this.context, "Unsupported RTF list override", "E_CAPABILITY", control.offset);
            }
            levels.push(level);
          } else rtfError(this.context, "Unsupported RTF list override syntax", "E_CAPABILITY", t.offset);
        }
        if (id === undefined || index === undefined || this.overrides.has(index) || count !== levels.length) rtfError(this.context, "Invalid RTF list override");
        this.overrides.set(index, {id, levels});
      }
    }
  }
  listLevel(group: RtfGroup): ListLevel {
    const styles: Readonly<Record<number, ListStyle | "bullet">> = {0: "Decimal", 1: "UpperRoman", 2: "LowerRoman", 3: "UpperAlpha", 4: "LowerAlpha", 23: "bullet"};
    let start = 1, style: ListStyle | "bullet" = "Decimal";
    for (const t of group.children) if (t.kind === "word") {
      if (!runControls[t.name] && !layoutControls.has(t.name) && !["listlevel", "levelnfc", "levelnfcn", "leveljc", "leveljcn", "levelstartat", "levelfollow", "levelspace", "levelindent", "levellegal", "levelold", "levelprev", "levelprevspace", "leveltemplateid", "levelnorestart", "f", "fs", "cf"].includes(t.name)) rtfError(this.context, `Unsupported RTF list level control ${t.name}`, "E_CAPABILITY", t.offset);
      if (t.name === "levelstartat") start = this.parameter(t, 1);
      if (t.name === "levelnfc" || t.name === "levelnfcn") {
        const nfc = this.parameter(t);
        if (!Object.hasOwn(styles, nfc)) rtfError(this.context, `Unsupported RTF list numbering ${nfc}`, "E_CAPABILITY", t.offset);
        style = styles[nfc]!;
      }
    } else if (t.kind === "group") {
      const name = destination(t).name;
      if (!["leveltext", "levelnumbers"].includes(name)) rtfError(this.context, "Unsupported RTF list level destination", "E_CAPABILITY", t.offset);
      for (const value of t.children.slice(1)) {
        if (value.kind === "hex" || value.kind === "text") continue;
        if (name === "leveltext" && value.kind === "word" && ["u", "uc"].includes(value.name)) continue;
        rtfError(this.context, "Unsupported RTF list label syntax", "E_CAPABILITY", value.offset);
      }
    } else rtfError(this.context, "Unsupported RTF list level syntax", "E_CAPABILITY", t.offset);
    let delimiter: ListDelim = "Period";
    const label = group.children.find(t => t.kind === "group" && destination(t).name === "leveltext");
    if (label?.kind === "group" && style !== "bullet") {
      const values: number[] = [];
      for (const t of label.children.slice(1)) {
        if (t.kind === "hex") values.push(t.byte);
        else if (t.kind === "text") for (const byte of t.bytes) values.push(byte);
        else rtfError(this.context, "Unsupported RTF list label", "E_CAPABILITY", t.offset);
      }
      const length = values.shift();
      if (length === undefined || values[length] !== 59 || values.length !== length + 1) rtfError(this.context, "Malformed RTF list label");
      const pattern = values.slice(0, length).map(v => v <= 8 ? "#" : String.fromCharCode(v)).join("");
      if (pattern === "#.") delimiter = "Period";
      else if (pattern === "#)") delimiter = "OneParen";
      else if (pattern === "(#)") delimiter = "TwoParens";
      else rtfError(this.context, `Unsupported RTF list label ${pattern}`, "E_CAPABILITY");
    }
    return {start, style, delimiter};
  }
  async legacyList(group: RtfGroup, state: State): Promise<void> {
    let style: ListStyle | "bullet" = "Decimal", start = 1;
    let before = "", after = "";
    const styles: Readonly<Record<string, ListStyle | "bullet">> = {pndec: "Decimal", pnucrm: "UpperRoman", pnlcrm: "LowerRoman", pnucltr: "UpperAlpha", pnlcltr: "LowerAlpha", pnlvlblt: "bullet"};
    for (const token of group.children) {
      await this.context.cooperate();
      if (token.kind === "symbol" && token.name === "*") continue;
      if (token.kind === "word") {
        if (styles[token.name]) style = styles[token.name]!;
        else if (token.name === "pnstart") start = this.parameter(token, 1);
        else if (!["pn", "pnlvlbody", "pnf", "pnfs", "pnindent", "pnsp", "pnhang", "pncont", "pnb", "pni"].includes(token.name)) rtfError(this.context, `Unsupported RTF legacy list control ${token.name}`, "E_CAPABILITY", token.offset);
      } else if (token.kind === "group") {
        const name = destination(token).name;
        if (name !== "pntxta" && name !== "pntxtb") rtfError(this.context, "Unsupported RTF legacy list label", "E_CAPABILITY", token.offset);
        const text = await this.literalText({...token, children: token.children.slice(1)}, state);
        if (name === "pntxta") after = text; else before = text;
      } else rtfError(this.context, "Unsupported RTF legacy list definition", "E_CAPABILITY", token.offset);
    }
    let delimiter: ListDelim = "Period";
    if (style !== "bullet") {
      if (before === "(" && after === ")") delimiter = "TwoParens";
      else if (!before && after === ")") delimiter = "OneParen";
      else if (before || after && after !== ".") rtfError(this.context, "Unsupported RTF legacy list label", "E_CAPABILITY");
    }
    const key = `${style}:${start}:${delimiter}`;
    let id = this.legacyLists.get(key);
    if (id === undefined) {
      id = -this.legacyLists.size - 1; this.legacyLists.set(key, id);
      this.lists.set(id, [{start, style, delimiter}]); this.overrides.set(id, {id, levels: []});
    }
    state.list = id; state.level = 0;
  }
  async picture(group: RtfGroup): Promise<void> {
    if (this.literal) rtfError(this.context, "Picture in RTF literal", "E_CAPABILITY");
    this.context.charge("images", 1);
    let encoding: "png" | "jpeg" | undefined;
    let width: number | undefined, height: number | undefined;
    const data: number[] = [];
    let nibble: number | undefined;
    for (const token of group.children.slice(1)) {
      await this.context.cooperate();
      if (token.kind === "word") {
        if (token.name === "pngblip" || token.name === "jpegblip") {
          if (encoding) rtfError(this.context, "Multiple RTF picture encodings");
          encoding = token.name === "pngblip" ? "png" : "jpeg";
        } else if (token.name === "picw") width = this.parameter(token, 1, 100000);
        else if (token.name === "pich") height = this.parameter(token, 1, 100000);
        else if (["picwgoal", "pichgoal", "picscalex", "picscaley", "piccropl", "piccropr", "piccropt", "piccropb", "bliptag"].includes(token.name)) this.parameter(token, -2147483648);
        else rtfError(this.context, `Unsupported RTF picture control ${token.name}`, "E_CAPABILITY", token.offset);
      } else if (token.kind === "binary") {
        if (nibble !== undefined) rtfError(this.context, "Binary picture follows incomplete hex byte");
        this.context.bound("resourceBytes", data.length + token.bytes.length);
        this.context.charge("retainedBytes", token.bytes.length * 8);
        for (const byte of token.bytes) {data.push(byte); this.context.checkpoint(); if (data.length % 256 === 0) await this.context.cooperate(0);}
      } else if (token.kind === "text") {
        for (const byte of token.bytes) {
          this.context.checkpoint();
          if ([9, 10, 13, 32].includes(byte)) continue;
          const n = hexDigit(byte);
          if (n < 0) rtfError(this.context, "Malformed RTF picture hex", "E_PARSE", token.offset);
          if (nibble === undefined) nibble = n;
          else {
            this.context.charge("binaryBytes", 1);
            this.context.bound("resourceBytes", data.length + 1);
            this.context.charge("retainedBytes", 8);
            data.push(nibble * 16 + n); nibble = undefined;
          }
          if (data.length % 256 === 0) await this.context.cooperate(0);
        }
      } else rtfError(this.context, "Unsupported RTF picture data", "E_CAPABILITY", token.offset);
    }
    if (!encoding) rtfError(this.context, "RTF picture encoding must be PNG or JPEG", "E_CAPABILITY");
    if (nibble !== undefined || !data.length) rtfError(this.context, "Incomplete RTF picture data");
    if (width !== undefined && height !== undefined) this.context.bound("layoutWork", width * height);
    const signature = encoding === "png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216];
    if (!signature.every((byte, index) => data[index] === byte)) rtfError(this.context, "Invalid RTF picture signature");
    this.context.charge("retainedBytes", data.length);
    const id = `rtf-picture-${this.resources.length + 1}.${encoding === "jpeg" ? "jpg" : "png"}`;
    this.resources.push({id, bytes: Uint8Array.from(data)});
    this.append({t: "Image", c: [empty, [], [id, ""]]});
  }
  async field(group: RtfGroup, state: State): Promise<void> {
    for (const t of group.children.slice(1)) {
      if (t.kind === "group" && ["fldinst", "fldrslt"].includes(destination(t).name)) continue;
      if (t.kind === "word" && ["flddirty", "fldlock", "fldedit", "fldpriv"].includes(t.name)) continue;
      rtfError(this.context, "Unsupported extra RTF field content", "E_CAPABILITY", t.offset);
    }
    const instruction = group.children.filter((t): t is RtfGroup => t.kind === "group" && destination(t).name === "fldinst");
    const results = group.children.filter((t): t is RtfGroup => t.kind === "group" && destination(t).name === "fldrslt");
    if (instruction.length !== 1 || results.length !== 1) rtfError(this.context, "Malformed RTF field");
    const source = (await this.literalText(instruction[0]!, state)).trim();
    const words: string[] = [];
    let i = 0;
    while (i < source.length) {
      while (source[i] === " " || source[i] === "\t") i++;
      if (i === source.length) break;
      let word = "";
      const quote = source[i] === '"'; if (quote) i++;
      while (i < source.length && (quote ? source[i] !== '"' : source[i] !== " " && source[i] !== "\t")) {this.context.checkpoint(); word += source[i++]!;}
      if (quote && source[i++] !== '"') rtfError(this.context, "Unclosed RTF field quote");
      words.push(word);
    }
    if (words[0]?.toUpperCase() !== "HYPERLINK") rtfError(this.context, "Only inert HYPERLINK fields are supported; active fields are never evaluated", "E_CAPABILITY");
    let target: string;
    if (words.length === 2) target = words[1]!;
    else if (words.length === 3 && words[1] === "\\l") target = "#" + words[2]!;
    else if (words.length === 4 && words[2] === "\\l") target = words[1]! + "#" + words[3]!;
    else rtfError(this.context, "Unsupported RTF HYPERLINK instruction", "E_CAPABILITY");
    const colon = target.indexOf(":");
    if (colon >= 0 && !["http", "https", "mailto"].includes(target.slice(0, colon).toLowerCase())) rtfError(this.context, "Unsupported RTF hyperlink scheme", "E_CAPABILITY");
    const saved = this.inlines; const previous = this.inlineOnly;
    this.inlines = []; this.inlineOnly = true;
    const resultState = {...state, tags: new Set(state.tags)};
    await this.walk(results[0]!.children, resultState, true);
    this.noSurrogate(); this.flush(resultState);
    const content = this.inlines; this.inlines = saved; this.inlineOnly = previous;
    this.append({t: "Link", c: [empty, content, [target, ""]]});
  }
  async note(group: RtfGroup, state: State): Promise<void> {
    if (this.literal || this.inNote) rtfError(this.context, "Nested footnote or note in RTF literal", "E_CAPABILITY", group.offset);
    const reader = new RtfReader(this.context, this.resources);
    for (const [key, value] of this.fonts) {await this.context.cooperate(); reader.fonts.set(key, value);}
    for (const [key, value] of this.styles) {await this.context.cooperate(); reader.styles.set(key, value);}
    for (const [key, value] of this.lists) {await this.context.cooperate(); reader.lists.set(key, value);}
    for (const [key, value] of this.overrides) {await this.context.cooperate(); reader.overrides.set(key, value);}
    reader.colors.push(...this.colors); reader.inNote = true;
    const local = {...state, tags: new Set(state.tags)};
    await reader.walk(group.children.slice(destination(group).ignorable ? 2 : 1), local);
    reader.paragraph(local);
    if (reader.boundaries !== undefined) rtfError(this.context, "Unfinished RTF footnote table");
    reader.finishTable();
    this.append({t: "Note", c: reader.blocks});
  }
  async style(id: number, state: State, seen = new Set<number>()): Promise<void> {
    this.context.bound("depth", seen.size + 1);
    if (seen.has(id)) rtfError(this.context, "Cyclic RTF stylesheet");
    const style = this.styles.get(id);
    if (!style) {if (id === 0) return; rtfError(this.context, `Undefined RTF style ${id}`);}
    seen.add(id);
    if (style.basedOn !== undefined && style.basedOn !== id) await this.style(style.basedOn, state, seen);
    for (const token of style.controls) {
      await this.context.cooperate();
      if (token.kind === "word") await this.control(token, state);
    }
  }
  async control(token: Extract<RtfToken, {kind: "word"}>, state: State): Promise<void> {
    const {name, parameter: n} = token;
    if (name === "rtf") return;
    if (this.literal && ["fldinst", "fldrslt"].includes(name)) return;
    if (name === "fldrslt" && this.inlineOnly) return;
    if (name === "ansi") state.codepage = 1252;
    else if (name === "mac" || name === "pc" || name === "pca") rtfError(this.context, `RTF ${name} encoding is outside the pinned 1252/65001 profile`, "E_ENCODING", token.offset);
    else if (name === "ansicpg") state.codepage = this.page(this.parameter(token), token.offset);
    else if (name === "deff") state.defaultFont = this.parameter(token);
    else if (name === "uc") state.uc = this.parameter(token, 0, 32767);
    else if (name === "u") {const code = this.parameter(token, -32768, 32767); this.unicode(code < 0 ? code + 65536 : code); this.fallback = state.uc;}
    else if (characters[name]) {this.noSurrogate(); this.context.charge("text", 1); this.emit(characters[name]);}
    else if (name === "par") this.paragraph(state, true);
    else if (name === "line") {this.noSurrogate(); this.flush(state); this.append({t: "LineBreak"});}
    else if (name === "tab") {this.noSurrogate(); this.emit("\t");}
    else if (name === "plain") {state.tags.clear(); state.font = undefined; state.color = 0; state.size = undefined;}
    else if (name === "pard") {
      state.list = undefined; state.level = 0; state.alignment = undefined; state.left = undefined; state.right = undefined; state.indent = undefined; state.heading = undefined;
    }
    else if (["ql", "qc", "qr", "qj"].includes(name)) state.alignment = ({ql: "left", qc: "center", qr: "right", qj: "justify"} as Record<string, string>)[name];
    else if (name === "li") state.left = this.parameter(token, -2147483648);
    else if (name === "ri") state.right = this.parameter(token, -2147483648);
    else if (name === "fi") state.indent = this.parameter(token, -2147483648);
    else if (name === "outlinelevel") {const level = this.parameter(token, 0, 9); state.heading = level === 9 ? undefined : level + 1;}
    else if (name === "chftn" && this.inNote) return;
    else if (name === "f") {state.font = this.parameter(token); if (!this.fonts.has(state.font)) rtfError(this.context, "Undefined RTF font");}
    else if (name === "cf") state.color = this.parameter(token);
    else if (name === "fs") state.size = this.parameter(token, 1, 32767);
    else if (runControls[name]) {
      if (n !== undefined && n !== 0 && n !== 1) rtfError(this.context, `Invalid RTF ${name} toggle`);
      if (name === "sub") state.tags.delete("Superscript");
      if (name === "super") state.tags.delete("Subscript");
      if (n === 0) state.tags.delete(runControls[name]); else state.tags.add(runControls[name]);
    } else if (name === "ulnone") state.tags.delete("Underline");
    else if (name === "nosupersub") {state.tags.delete("Superscript"); state.tags.delete("Subscript");}
    else if (name === "s" || name === "cs") await this.style(this.parameter(token), state);
    else if (name === "ls") state.list = this.parameter(token);
    else if (name === "ilvl") state.level = this.parameter(token, 0, 8);
    else if (name === "trowd") {
      if (this.inlineOnly || this.boundaries !== undefined || this.inlines.length) rtfError(this.context, "Invalid RTF table row boundary");
      this.boundaries = []; this.cells = []; this.cellBlocks = [];
    } else if (name === "cellx") {
      if (!this.boundaries) rtfError(this.context, "RTF cell boundary outside row");
      const boundary = this.parameter(token, -2147483648);
      if (this.boundaries.length && boundary <= this.boundaries.at(-1)!) rtfError(this.context, "Non-increasing RTF cell boundaries");
      this.context.bound("tableColumns", this.boundaries.length + 1); this.boundaries.push(boundary);
    } else if (name === "intbl") {if (!this.boundaries) rtfError(this.context, "RTF table paragraph outside row");}
    else if (name === "cell") {
      if (!this.boundaries || this.cells.length >= this.boundaries.length) rtfError(this.context, "RTF cell outside declared row");
      this.paragraph(state);
      this.context.bound("tableCells", this.cells.length + 1);
      this.cells.push([empty, "AlignDefault", 1, 1, this.cellBlocks]); this.cellBlocks = [];
    } else if (name === "row") {
      if (!this.boundaries?.length || this.cells.length !== this.boundaries.length || this.inlines.length || this.cellBlocks.length) rtfError(this.context, "Incomplete RTF table row");
      if (this.tableColumns && this.tableColumns !== this.cells.length) rtfError(this.context, "Changing RTF table geometry is unsupported", "E_CAPABILITY");
      this.context.bound("tableRows", this.rows.length + 1); this.tableColumns = this.cells.length;
      this.rows.push([empty, this.cells]); this.cells = []; this.boundaries = undefined;
    } else if (!layoutControls.has(name)) rtfError(this.context, `Unsupported RTF control ${name}`, "E_CAPABILITY", token.offset);
  }
  async walk(tokens: readonly RtfToken[], state: State, skipDestination = false): Promise<void> {
    let start = 0;
    if (skipDestination) start = tokens[0]?.kind === "symbol" && tokens[0].name === "*" ? 1 : 0;
    for (let index = start; index < tokens.length; index++) {
      await this.context.cooperate();
      const token = tokens[index]!;
      if (token.kind === "text" || token.kind === "hex") {
        const parts: Uint8Array[] = []; let size = 0;
        do {
          const t = tokens[index]!;
          const part = t.kind === "text" ? t.bytes : t.kind === "hex" ? Uint8Array.of(t.byte) : new Uint8Array();
          const skipped = Math.min(this.fallback, part.length); this.fallback -= skipped;
          const remaining = part.subarray(skipped);
          parts.push(remaining); size += remaining.length;
          await this.context.cooperate();
          index++;
        } while (tokens[index]?.kind === "text" || tokens[index]?.kind === "hex");
        index--;
        if (size) {
          this.noSurrogate(); this.context.charge("retainedBytes", size);
          const raw = new Uint8Array(size); let offset = 0;
          for (const part of parts) {raw.set(part, offset); offset += part.length;}
          const font = state.font ?? state.defaultFont;
          const page = font === undefined ? state.codepage : this.fonts.get(font)?.codepage ?? state.codepage;
          this.emit(await this.decode(raw, page));
        }
        continue;
      }
      if (token.kind === "group") {
        this.fallback = 0;
        this.flush(state);
        const dest = destination(token);
        if (forbiddenDestinations.has(dest.name)) rtfError(this.context, `Embedded RTF ${dest.name} is unsupported and never executed`, "E_CAPABILITY", token.offset);
        if (unsupportedDestinations.has(dest.name)) rtfError(this.context, `Unsupported text-bearing RTF destination ${dest.name}`, "E_CAPABILITY", token.offset);
        if (metadataDestinations.has(dest.name)) await this.definitions(token, state);
        else if (dest.name === "pict") {this.noSurrogate(); await this.picture(token);}
        else if (dest.name === "field") {this.noSurrogate(); await this.field(token, state);}
        else if (dest.name === "footnote") {this.noSurrogate(); await this.note(token, state);}
        else if (dest.name === "pn") await this.legacyList(token, state);
        else if (dest.name === "shppict") await this.walk(token.children.slice(dest.ignorable ? 2 : 1), {...state, tags: new Set(state.tags)});
        else if (dest.name === "listtext" || dest.name === "pntext") {
          const pendingLegacy = tokens.slice(index + 1).some(t => t.kind === "group" && destination(t).name === "pn");
          if (state.list === undefined && !pendingLegacy) rtfError(this.context, "RTF list label without a supported list definition", "E_CAPABILITY", token.offset);
        } else if (!dest.ignorable) {
          const child = {...state, tags: new Set(state.tags)};
          await this.walk(token.children, child);
          this.flush(child);
        } else rtfError(this.context, `Unsupported ignorable RTF destination ${dest.name || "(missing control word)"}`, "E_CAPABILITY", token.offset);
        this.fallback = 0;
      } else if (this.fallback > 0) {
        // A control word or symbol counts as one fallback character; bin data
        // is one opaque fallback unit, regardless of its byte length.
        this.fallback--;
      } else if (token.kind === "symbol") {
        const symbols: Readonly<Record<string, string>> = {"\\": "\\", "{": "{", "}": "}", "~": "\u00a0", "_": "\u2011", "-": "\u00ad", "\n": "\n", "\r": "\n"};
        if (!Object.hasOwn(symbols, token.name)) rtfError(this.context, `Unsupported RTF control symbol ${token.name}`, "E_CAPABILITY", token.offset);
        this.noSurrogate(); this.context.charge("text", 1); this.emit(symbols[token.name]!);
      } else if (token.kind === "word") {
        if (token.name !== "u") this.flush(state);
        if (token.name === "chftn") {
          const next = tokens[index + 1];
          if (next?.kind === "group" && destination(next).name === "footnote") continue;
        }
        await this.control(token, state);
      } else rtfError(this.context, "Binary data outside an RTF picture/destination", "E_CAPABILITY", token.offset);
    }
  }
  async read(root: RtfGroup): Promise<Document> {
    const state = initial();
    await this.walk(root.children, state);
    this.paragraph(state);
    if (this.boundaries !== undefined) rtfError(this.context, "Unfinished RTF table");
    this.finishTable();
    return {blocks: this.blocks, metadata: {}, resources: this.resources};
  }
}

export const rtfReader: ReaderCapability = {
  format: "rtf",
  async read(input, context) {return new RtfReader(context).read(await parseRtf(input.bytes, context));}
};
