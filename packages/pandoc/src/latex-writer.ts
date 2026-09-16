import type { Alignment, Attr, Block, Caption, ColSpec, Inline, MetaValue, Row } from "./ast-types.js";
import type { AdapterContext, Document, SerializedDocument } from "./types.js";
import { PandocError } from "./errors.js";
import { placeRows } from "./tables.js";

const formatting = {Emph: "emph", Strong: "textbf", Underline: "uline", Strikeout: "sout", Superscript: "textsuperscript", Subscript: "textsubscript", SmallCaps: "textsc"};
const languages: Readonly<Record<string, string>> = {en: "english", "en-US": "english", "en-GB": "british", de: "ngerman", "de-DE": "ngerman", fr: "french", es: "spanish", it: "italian", pt: "portuguese", nl: "dutch"};
const mathCommands = new Set(("alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega frac dfrac tfrac sqrt sum prod int iint iiint oint lim limsup liminf sin cos tan log ln exp min max sup inf det gcd left right middle big Big bigg Bigg cdot times div pm mp le leq ge geq ne neq approx equiv sim simeq in notin subset supset subseteq supseteq cup cap emptyset infinity infty partial nabla forall exists neg land lor to mapsto rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow overline underline hat widehat bar vec dot ddot text mathrm mathbf mathit mathsf mathtt mathcal mathbb mathnormal operatorname overset underset underbrace overbrace binom dbinom tbinom quad qquad hspace phantom vphantom hphantom langle rangle lbrace rbrace lvert rvert vert Vert lVert rVert ldots cdots vdots ddots degree prime ast star ell Re Im mod bmod pmod limits nolimits substack displaystyle textstyle scriptstyle scriptscriptstyle" ).split(" "));

/** Serialization only. All code is escaped text; no delimiter can execute it. */
class LatexWriter {
  private readonly chunks: string[] = [];
  private length = 0;
  private readonly labels = new Map<Attr, string>();
  private readonly targets = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  private readonly notes: {blocks: readonly Block[]; path: string}[] = [];
  private printedNotes = 0;
  private tableDepth = 0;
  private figureDepth = 0;
  private noteDepth = 0;
  private listDepth = 0;
  private heading = 0;
  constructor(private readonly context: AdapterContext) {}
  fail(message: string, path?: string, code: "E_CAPABILITY" | "E_OPTION" = "E_CAPABILITY"): never {
    throw new PandocError(code, this.context.operation ?? "write", message, "latex", path);
  }
  loss(message: string, path: string): void {
    if(!this.context.lossy) this.fail(message, path);
    this.context.report({code: "W_TABLE_LOSS", operation: this.context.operation ?? "write", format: "latex", location: path, message});
  }
  add(text: string): void {
    this.context.checkpoint(text.length + 1);
    this.context.bound("outputBytes", this.length + text.length);
    this.context.charge("retainedBytes", text.length * 2);
    this.context.charge("references", 1);
    this.chunks.push(text); this.length += text.length;
  }
  escape(text: string, code = false): void {
    for(const ch of text) {
      if(ch.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(ch) || ch.charCodeAt(0) === 127) this.fail("Unrepresentable LaTeX control character");
      if(code && "\\{}#$%&_~^".includes(ch)) this.add(`\\char"${ch.codePointAt(0)!.toString(16).toUpperCase()}{}`);
      else if(code && (ch === " " || ch === "\t")) this.add(ch === " " ? "\\ " : "\\ \\ \\ \\ ");
      else this.add(({"#": "\\#", "$": "\\$", "%": "\\%", "&": "\\&", "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}", "\\": "\\textbackslash{}", "\r": " ", "\n": " ", "\t": " "}[ch] ?? ch));
    }
  }
  async reserve(value: unknown): Promise<void> {
    await this.context.cooperate();
    if(!value || typeof value !== "object") return;
    if("t" in value && value.t === "Table") {
      const t = (value as Extract<Block, {t: "Table"}>).c;
      await this.reserve(t[0]); await this.reserve(t[1]);
      // Section/row identifiers have no safe alignment position in this profile.
      for(const section of [t[3][1], ...t[4].flatMap(b => [b[2], b[3]]), t[5][1]]) {
        for(const row of section) for(const cell of row[1]) {await this.reserve(cell[0]); await this.reserve(cell[4]);}
      }
      return;
    }
    if(Array.isArray(value)) {
      if(value.length === 3 && typeof value[0] === "string" && Array.isArray(value[1]) && Array.isArray(value[2]) && value[0]) {
        const attr = value as unknown as Attr;
        let base = "pc";
        for(const ch of attr[0]) {this.context.checkpoint(); base += `-${ch.codePointAt(0)!.toString(16)}`;}
        const count = (this.counts.get(base) ?? 0) + 1; this.counts.set(base, count);
        const label = count === 1 ? base : `${base}-dup-${count}`;
        this.context.charge("retainedBytes", label.length * 2); this.context.charge("references", 1);
        this.labels.set(attr, label); if(!this.targets.has(attr[0])) this.targets.set(attr[0], label);
      }
      for(const child of value) await this.reserve(child);
    } else for(const child of Object.values(value)) await this.reserve(child);
  }
  attrs(attr: Attr, path: string, languageClass = false): void {
    if(attr[1].length && !languageClass || attr[2].length) this.loss("Unsupported LaTeX attributes", path);
    const label = this.labels.get(attr);
    if(label) this.add(`\\phantomsection\\label{${label}}`);
  }
  math(source: string, path: string): void {
    if(source.includes("^^")) this.fail("Unsafe TeX superscript preprocessing", path);
    let depth = 0;
    for(let i = 0; i < source.length; i++) {
      this.context.checkpoint(); const ch = source[i]!;
      if(ch === "\\") {
        let name = "";
        while(i + 1 < source.length && (source[i + 1]! >= "a" && source[i + 1]! <= "z" || source[i + 1]! >= "A" && source[i + 1]! <= "Z")) name += source[++i];
        if(name) {if(!mathCommands.has(name)) this.fail(`Unsupported executable math command: ${name}`, path);}
        else {const escaped = source[++i]; if(!escaped || !"{}_%&#$ ,;:!|\\".includes(escaped)) this.fail("Unsafe math delimiter or command", path);}
      } else if(ch === "{") depth++;
      else if(ch === "}") {if(--depth < 0) this.fail("Unbalanced math source", path);}
      else if("$%#".includes(ch) || ch.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(ch)) this.fail("Unsafe math source", path);
    }
    if(depth) this.fail("Unbalanced math source", path);
    this.add(source);
  }
  raw(text: string, path: string): void {
    if(this.context.rawContent === "reject") this.fail("Raw content rejected by explicit policy", path);
    if(this.context.rawContent === "retain") this.fail("Executable raw LaTeX cannot be retained", path);
    if(this.context.rawContent !== "escape") this.loss("Escaped unsupported raw content", path);
    this.escape(text);
  }
  url(value: string, path: string): void {
    if(value.trim() !== value || [...value].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || "\\{}".includes(ch))) this.fail("Unsafe URL characters", path);
    const colon = value.indexOf(":"), boundaries = [value.indexOf("/"), value.indexOf("?"), value.indexOf("#")].filter(n => n >= 0);
    if(colon >= 0 && boundaries.every(n => colon < n) && !["http", "https", "mailto", "tel"].includes(value.slice(0, colon).toLowerCase())) this.fail("Unsupported URI scheme", path);
    for(const ch of value) {this.context.checkpoint(); this.add(({"%": "\\%", "#": "\\#", "&": "\\&", "_": "\\_"}[ch] ?? (" ~^\"<>`".includes(ch) ? encodeURIComponent(ch).split("%").join("\\%") : ch)));}
  }
  imagePath(value: string, path: string): void {
    if(!value || value.trim() !== value || value.split("/").includes("..") || [...value].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || "\\{}%#$~^|:\"".includes(ch))) this.fail("Unsafe or nonlocal image path", path);
    this.add("\\includegraphics{\\detokenize{"); this.add(value); this.add("}}");
  }
  async inlines(nodes: readonly Inline[], path: string): Promise<void> {
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate(); const p = `${path}[${i}]`;
      switch(node.t) {
        case "Str": this.escape(node.c); break;
        case "Space": case "SoftBreak": this.add(" "); break;
        case "LineBreak": this.add("\\protect\\newline{}\n"); break;
        case "Emph": case "Strong": case "Underline": case "Strikeout": case "Superscript": case "Subscript": case "SmallCaps":
          this.add(`\\${formatting[node.t]}{`); await this.inlines(node.c, `${p}.c`); this.add("}"); break;
        case "Quoted": this.add(node.c[0] === "SingleQuote" ? "`" : "``"); await this.inlines(node.c[1], `${p}.c[1]`); this.add(node.c[0] === "SingleQuote" ? "'" : "''"); break;
        case "Cite": if(node.c[0].length) this.loss("Projected unsupported citation to display text", p); await this.inlines(node.c[1], `${p}.c[1]`); break;
        case "Code": this.attrs(node.c[0], p); this.add("\\texttt{"); this.escape(node.c[1], true); this.add("}"); break;
        case "Math": this.add(node.c[0] === "InlineMath" ? "\\(" : "\\["); this.math(node.c[1], p); this.add(node.c[0] === "InlineMath" ? "\\)" : "\\]"); break;
        case "RawInline": this.raw(node.c[1], p); break;
        case "Span": this.attrs(node.c[0], p); this.add("{"); await this.inlines(node.c[1], `${p}.c[1]`); this.add("}"); break;
        case "Note": this.context.charge("references", 1); this.notes.push({blocks: node.c, path: `${p}.c`}); this.add(`\\protect\\footnotemark[${this.notes.length}]`); break;
        case "Link": {
          this.attrs(node.c[0], p); if(node.c[2][1]) this.loss("Dropped link title", p);
          const target = node.c[2][0];
          if(target.startsWith("#")) {
            const label = this.targets.get(target.slice(1));
            if(!label) {this.loss("Unresolved internal reference projected to text", p); await this.inlines(node.c[1], `${p}.c[1]`); break;}
            this.add(`\\hyperref[${label}]{`);
          } else {this.add("\\href{"); this.url(target, p); this.add("}{");}
          await this.inlines(node.c[1], `${p}.c[1]`); this.add("}"); break;
        }
        case "Image": this.attrs(node.c[0], p); if(node.c[2][1]) this.loss("Dropped image title", p); this.imagePath(node.c[2][0], p); break;
      }
    }
  }
  async caption(caption: Caption, path: string): Promise<void> {
    if(caption[1].length) {
      for(const [i, block] of caption[1].entries()) {
        if(i) this.add(" ");
        if(block.t === "Plain" || block.t === "Para") await this.inlines(block.c, `${path}[1][${i}].c`);
        else {this.loss("Unsupported block caption", path); this.escape(block.t);}
      }
    } else if(caption[0]) await this.inlines(caption[0], `${path}[0]`);
  }
  column(align: Alignment, fraction: number): string {
    const command = {AlignDefault: "raggedright", AlignLeft: "raggedright", AlignRight: "raggedleft", AlignCenter: "centering"}[align];
    return `>{\\${command}\\arraybackslash}p{\\dimexpr${fraction.toFixed(6)}\\linewidth-2\\tabcolsep\\relax}`;
  }
  async rows(rows: readonly Row[], cols: readonly ColSpec[], widths: readonly number[], path: string, rowHeads = 0): Promise<void> {
    for(const [i, r] of rows.entries()) {
      if(r[0][0] || r[0][1].length || r[0][2].length) this.loss("Dropped unsupported table row attributes", `${path}[${i}][0]`);
    }
    let row = 0, column = 0;
    const start = (target: number): void => {
      while(row < target) {
        while(column < cols.length) {if(column) this.add(" & "); column++;}
        this.add(" \\\\\n"); row++; column = 0;
      }
    };
    for(const placed of placeRows(rows, cols.length, path, rowHeads)) {
      await this.context.cooperate(); if(!placed) continue;
      start(placed.row);
      while(column < placed.column) {if(column) this.add(" & "); column++;}
      if(column) this.add(" & ");
      const cell = placed.cell;
      const align = cell[1] === "AlignDefault" ? cols[column]![0] : cell[1];
      const spanning = cell[3] > 1 || align !== cols[column]![0];
      if(spanning) {
        let width = 0; for(let k = column; k < column + cell[3]; k++) {this.context.checkpoint(); width += widths[k]!;}
        this.add(`\\multicolumn{${cell[3]}}{${this.column(align, width)}}{`);
      }
      if(cell[2] > 1) this.add(`\\multirow{${cell[2]}}{=}{`);
      this.attrs(cell[0], placed.path); await this.blocks(cell[4], `${placed.path}[4]`);
      if(cell[2] > 1) this.add("}"); if(spanning) this.add("}"); column += cell[3];
    }
    start(rows.length);
  }
  async table(node: Extract<Block, {t: "Table"}>, path: string): Promise<void> {
    const t = node.c;
    if(this.figureDepth || this.noteDepth) this.fail("Longtable requires an outer document context", path);
    if(this.tableDepth) {
      this.loss("Nested table projected to cell text", path);
      this.attrs(t[0], `${path}.c[0]`);
      for(const section of [t[3][1], ...t[4].flatMap(b => [b[2], b[3]]), t[5][1]]) for(const row of section) for(const cell of row[1]) {this.attrs(cell[0], path); await this.blocks(cell[4], path); this.add(" ");}
      return;
    }
    this.tableDepth++;
    this.attrs(t[0], `${path}.c[0]`);
    if(!t[2].length) this.fail("Empty table column specification", path);
    const widths = t[2].map(c => c[1].t === "ColWidth" ? c[1].c : 1 / t[2].length);
    const total = widths.reduce((sum, w) => sum + w, 0);
    for(let i = 0; i < widths.length; i++) widths[i] = widths[i]! / total;
    this.add("\\begin{longtable}{"); for(const [i, col] of t[2].entries()) this.add(this.column(col[0], widths[i]!)); this.add("}\n");
    if(t[1][0]?.length || t[1][1].length) {this.add("\\caption{"); await this.caption(t[1], `${path}.c[1]`); this.add("} \\\\\n");}
    const begin = this.chunks.length;
    if(t[3][0][0] || t[3][0][1].length || t[3][0][2].length) this.loss("Dropped unsupported table head attributes", `${path}.c[3][0]`);
    await this.rows(t[3][1], t[2], widths, `${path}.c[3][1]`);
    const head = this.chunks.slice(begin).filter(chunk => !chunk.startsWith("\\phantomsection\\label{") && !chunk.startsWith("\\label{")).join("");
    this.context.charge("retainedBytes", head.length * 2);
    this.add("\\endfirsthead\n"); this.add(head); this.add("\\endhead\n");
    // A longtable footer is emitted on every page unless bounded by endlastfoot.
    this.add("\\endfoot\n");
    if(t[5][0][0] || t[5][0][1].length || t[5][0][2].length) this.loss("Dropped unsupported table foot attributes", `${path}.c[5][0]`);
    await this.rows(t[5][1], t[2], widths, `${path}.c[5][1]`); this.add("\\endlastfoot\n");
    for(const [i, body] of t[4].entries()) {
      if(body[0][0] || body[0][1].length || body[0][2].length) this.loss("Dropped unsupported table body attributes", `${path}.c[4][${i}][0]`);
      await this.rows(body[2], t[2], widths, `${path}.c[4][${i}][2]`);
      await this.rows(body[3], t[2], widths, `${path}.c[4][${i}][3]`, body[1]);
    }
    this.add("\\end{longtable}\n\n"); this.tableDepth--;
  }
  async blocks(nodes: readonly Block[], path: string): Promise<void> {
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate(); const p = `${path}[${i}]`;
      switch(node.t) {
        case "Plain": case "Para": await this.inlines(node.c, `${p}.c`); this.add(this.tableDepth ? "\\par " : node.t === "Para" ? "\n\n" : "\n"); break;
        case "Header": {
          if(node.c[0] > 5) this.loss("Heading level projected to subparagraph", p);
          this.add(`\\${["section", "subsection", "subsubsection", "paragraph", "subparagraph"][Math.min(node.c[0], 5) - 1]}{`);
          await this.inlines(node.c[2], `${p}.c[2]`); this.add("}"); this.attrs(node.c[1], `${p}.c[1]`);
          if(!node.c[1][0]) this.add(`\\label{pc-section-${++this.heading}}`); this.add("\n\n"); break;
        }
        case "CodeBlock": this.attrs(node.c[0], `${p}.c[0]`, true); this.add("\\begin{flushleft}\\ttfamily\n");
          for(const line of node.c[1].split("\n")) {this.add("\\mbox{"); this.escape(line, true); this.add("}\\\\\n");} this.add("\\end{flushleft}\n\n"); break;
        case "RawBlock": this.raw(node.c[1], p); this.add("\n\n"); break;
        case "HorizontalRule": this.add("\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par\n"); break;
        case "BlockQuote": this.add("\\begin{quote}\n"); await this.blocks(node.c, `${p}.c`); this.add("\\end{quote}\n\n"); break;
        case "Div": this.attrs(node.c[0], `${p}.c[0]`); this.add("{\n"); await this.blocks(node.c[1], `${p}.c[1]`); this.add("}\n"); break;
        case "BulletList": case "OrderedList": {
          const ordered = node.t === "OrderedList";
          if(this.listDepth >= 4) this.fail("LaTeX list nesting exceeds fixed profile", p);
          this.listDepth++; const env = ordered ? "enumerate" : "itemize"; this.add(`\\begin{${env}}`);
          if(ordered) {
            const [start, style, delim] = node.c[0]; if(style === "Example") this.loss("Example list numbering projected to decimal", p);
            const counter = {DefaultStyle: "arabic", Example: "arabic", Decimal: "arabic", LowerRoman: "roman", UpperRoman: "Roman", LowerAlpha: "alph", UpperAlpha: "Alph"}[style];
            this.add(`[start=${start},label=${delim === "TwoParens" ? "(" : ""}\\${counter}*${delim === "OneParen" || delim === "TwoParens" ? ")" : "."}]`);
          }
          this.add("\n"); for(const [j, item] of (ordered ? node.c[1] : node.c).entries()) {this.add("\\item "); await this.blocks(item, `${p}.c${ordered ? "[1]" : ""}[${j}]`);}
          this.add(`\\end{${env}}\n\n`); this.listDepth--; break;
        }
        case "DefinitionList": this.add("\\begin{description}\n"); for(const [j, [term, defs]] of node.c.entries()) {
          this.add("\\item[{"); await this.inlines(term, `${p}.c[${j}][0]`); this.add("}] ");
          for(const [k, def] of defs.entries()) await this.blocks(def, `${p}.c[${j}][1][${k}]`);
        } this.add("\\end{description}\n\n"); break;
        case "LineBlock": this.add("\\begin{flushleft}\n"); for(const [j, line] of node.c.entries()) {if(j) this.add("\\\\\n"); this.add("\\strut{}"); await this.inlines(line, `${p}.c[${j}]`);} this.add("\n\\end{flushleft}\n\n"); break;
        case "Figure":
          if(this.tableDepth || this.figureDepth || this.noteDepth) this.fail("Floating figure requires an outer document context", p);
          this.figureDepth++;
          this.add("\\begin{figure}[htbp]\n"); await this.blocks(node.c[2], `${p}.c[2]`); this.add("\\caption{"); await this.caption(node.c[1], `${p}.c[1]`); this.add("}"); this.attrs(node.c[0], `${p}.c[0]`); this.add("\n\\end{figure}\n\n"); this.figureDepth--; break;
        case "Table": await this.table(node, p); break;
      }
      if(path === "$.blocks") await this.flushNotes();
    }
  }
  async flushNotes(): Promise<void> {
    while(this.printedNotes < this.notes.length) {
      const index = this.printedNotes++, note = this.notes[index]!;
      this.add(`\\footnotetext[${index + 1}]{`); this.noteDepth++;
      await this.blocks(note.blocks, note.path); this.noteDepth--; this.add("}\n");
    }
  }
  meta(value: MetaValue | undefined, key: string): readonly Inline[] | undefined {
    if(value === undefined) return undefined;
    if(value.t === "MetaString") return [{t: "Str", c: value.c}];
    if(value.t === "MetaInlines") return value.c;
    this.fail(`${key} metadata must be text or inlines`, `$.metadata.${key}`, "E_OPTION");
  }
  async write(document: Document): Promise<SerializedDocument> {
    await this.reserve(document.blocks);
    await this.reserve(document.metadata);
    const lang = document.metadata.lang;
    if(lang && lang.t !== "MetaString") this.fail("lang metadata must be a string", "$.metadata.lang", "E_OPTION");
    const language = lang?.c ?? document.language ?? "en";
    if(!languages[language]) this.fail("Unsupported LaTeX language", "$.metadata.lang", "E_OPTION");
    const direction = document.metadata.dir;
    if(direction && (direction.t !== "MetaString" || direction.c !== "ltr") || document.direction && document.direction !== "ltr") this.fail("Unsupported LaTeX direction", "$.metadata.dir", "E_OPTION");
    if(this.context.standalone) {
      this.add("\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n");
      this.add(`\\usepackage[${languages[language]}]{babel}\n`);
      this.add("\\usepackage{amsmath,amssymb}\n\\usepackage{graphicx}\n\\usepackage{array,longtable,multirow}\n\\usepackage{enumitem}\n\\usepackage[normalem]{ulem}\n\\usepackage{hyperref}\n");
      for(const key of ["title", "author", "date"] as const) {this.add(`\\${key}{`); await this.inlines(this.meta(document.metadata[key], key) ?? [], `$.metadata.${key}`); this.add("}\n");}
      this.add("\\begin{document}\n"); if(document.metadata.title) this.add("\\maketitle\n");
    }
    const fragmentLanguage = !this.context.standalone && (lang !== undefined || document.language !== undefined);
    if(fragmentLanguage) this.add(`\\begin{otherlanguage}{${languages[language]}}\n`);
    await this.blocks(document.blocks, "$.blocks");
    await this.flushNotes();
    if(fragmentLanguage) this.add("\\end{otherlanguage}\n");
    if(this.context.standalone) this.add("\\end{document}\n");
    this.context.charge("retainedBytes", this.length * 2);
    const text = this.chunks.join("");
    let end = text.length;
    while(end > 0 && text[end - 1] === "\n") end--;
    this.context.bound("outputBytes", end + 1);
    this.context.charge("retainedBytes", (end + 1) * 2);
    return {kind: "text", text: text.slice(0, end) + "\n"};
  }
}
export async function writeLatex(document: Document, context: AdapterContext): Promise<SerializedDocument> {
  return new LatexWriter(context).write(document);
}
