import type { Alignment, Attr, Block, Caption, ColSpec, Inline, Row } from "./ast-types.js";
import type { AdapterContext, Document, SerializedDocument } from "./types.js";
import type { FormatSelection } from "./formats.js";
import { PandocError } from "./errors.js";
import { placeRows, type Table } from "./tables.js";

const alignments: Record<Alignment, string> = {AlignLeft: "left", AlignRight: "right", AlignCenter: "center", AlignDefault: ""};
const delimiters: Record<Alignment, string> = {AlignLeft: ":---", AlignRight: "---:", AlignCenter: ":---:", AlignDefault: "---"};

/** Every retained fragment is reserved before concatenation or array growth. */
class Projection {
  private readonly chunks: string[] = [];
  private length = 0;
  constructor(readonly context: AdapterContext, readonly format: string) {}
  add(text: string): void {
    this.context.checkpoint(text.length + 1);
    this.context.bound("outputBytes", this.length + text.length);
    this.context.charge("retainedBytes", text.length * 2);
    this.context.charge("references", 1);
    this.chunks.push(text);
    this.length += text.length;
  }
  finish(): SerializedDocument {
    this.context.charge("retainedBytes", this.length * 2);
    return {kind: "text", text: this.chunks.join("")};
  }
  loss(path: string, message: string): void {
    if (!this.context.lossy) throw new PandocError("E_CAPABILITY", this.context.operation ?? "write", message, this.format, path);
    this.context.report({code: "W_TABLE_LOSS", operation: this.context.operation ?? "write", format: this.format, location: path, message});
  }
  escaped(text: string, html: boolean): void {
    for (const ch of text) {
      this.add(html ? ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[ch] ?? ch) :
        ("\\`*_{}[]<>|!#".includes(ch) ? `\\${ch}` : ch === "\n" || ch === "\r" || ch === "\t" ? " " : ch));
    }
  }
  attrs(attr: Attr): void {
    const pairs: (readonly [string, string])[] = [...(attr[0] ? [["id", attr[0]] as const] : []), ...(attr[1].length ? [["class", attr[1].join(" ")] as const] : []), ...attr[2]];
    for (const [key, value] of pairs) {
      // Do not permit arbitrary HTML attribute syntax or active event attributes.
      if (!key || key.toLowerCase().startsWith("on") || [...key].some(ch => !(ch >= "a" && ch <= "z") && !(ch >= "A" && ch <= "Z") && !(ch >= "0" && ch <= "9") && ch !== "-" && ch !== "_"))
        throw new PandocError("E_CAPABILITY", this.context.operation ?? "write", "Unsupported HTML attribute", this.format);
      this.add(` ${key}="`); this.escaped(value, true); this.add('"');
    }
  }
  attributeLoss(attr: Attr, path: string): void {
    if (attr[0] || attr[1].length || attr[2].length) this.loss(path, "Flattened table attributes");
  }
  textProjection(render: (text: Projection) => void, html: boolean): void {
    const text = new Projection(this.context, this.format);
    render(text);
    const value = text.finish();
    if(value.kind === "text") this.escaped(value.text, html);
  }
}

function textInline(node: Inline, out: Projection): void {
  switch (node.t) {
    case "Str": out.add(node.c); return;
    case "Space": case "SoftBreak": case "LineBreak": out.add(" "); return;
    case "Code": case "Math": case "RawInline": out.add(node.c[1]); return;
    case "Link": case "Image": case "Span": textInlines(node.c[1], out); return;
    case "Quoted": textInlines(node.c[1], out); return;
    case "Cite": textInlines(node.c[1], out); return;
    case "Note": textBlocks(node.c, out); return;
    default: textInlines(node.c, out);
  }
}
function textInlines(nodes: readonly Inline[], out: Projection): void {
  for (const node of nodes) textInline(node, out);
}
function textBlocks(nodes: readonly Block[], out: Projection): void {
  for (const [i, node] of nodes.entries()) {
    if (i) out.add(" ");
    switch (node.t) {
      case "Plain": case "Para": textInlines(node.c, out); break;
      case "Header": textInlines(node.c[2], out); break;
      case "CodeBlock": case "RawBlock": out.add(node.c[1]); break;
      case "LineBlock": for (const [j, line] of node.c.entries()) { if(j) out.add(" "); textInlines(line, out); } break;
      case "BlockQuote": textBlocks(node.c, out); break;
      case "Div": textBlocks(node.c[1], out); break;
      case "Figure": textBlocks(node.c[1][1], out); out.add(" "); textBlocks(node.c[2], out); break;
      case "OrderedList": for (const [j, item] of node.c[1].entries()) {if(j) out.add(" "); textBlocks(item, out);} break;
      case "BulletList": for (const [j, item] of node.c.entries()) {if(j) out.add(" "); textBlocks(item, out);} break;
      case "DefinitionList": for (const [term, definitions] of node.c) { textInlines(term, out); for (const d of definitions) {out.add(" "); textBlocks(d, out);} } break;
      case "Table":
        for (const rows of [node.c[3][1], ...node.c[4].flatMap(b => [b[2], b[3]]), node.c[5][1]])
          for (const row of rows) for (const cell of row[1]) {textBlocks(cell[4], out); out.add(" ");}
        break;
      case "HorizontalRule": break;
    }
  }
}
function inline(nodes: readonly Inline[], out: Projection, path: string, html: boolean): void {
  for (const [i, node] of nodes.entries()) {
    const p = `${path}[${i}]`;
    switch (node.t) {
      case "Str":
        if(!html && (node.c.includes("\n") || node.c.includes("\r") || node.c.includes("\t"))) out.loss(p, "Flattened cell text line boundaries");
        out.escaped(node.c, html); break;
      case "Space": case "SoftBreak": out.add(" "); break;
      case "LineBreak":
        if (!html) out.loss(p, "Flattened cell line break");
        out.add(html ? "<br>" : " "); break;
      case "Emph": case "Strong": case "Strikeout": {
        if (!html) {out.loss(p, `Flattened cell inline ${node.t}`); out.textProjection(text => textInline(node, text), false); break;}
        const tag = {Emph: "em", Strong: "strong", Strikeout: "del"}[node.t];
        out.add(`<${tag}>`); inline(node.c, out, `${p}.c`, true); out.add(`</${tag}>`); break;
      }
      case "Code":
        if (html) {out.add("<code"); out.attrs(node.c[0]); out.add(">"); out.escaped(node.c[1], true); out.add("</code>");}
        else {out.loss(p, "Flattened cell code"); out.escaped(node.c[1], false);}
        break;
      case "Link": case "Image":
        if (html && node.t === "Link") {
          out.add('<a href="'); out.escaped(node.c[2][0], true); out.add('" title="'); out.escaped(node.c[2][1], true); out.add('"'); out.attrs(node.c[0]); out.add(">"); inline(node.c[1], out, `${p}.c[1]`, true); out.add("</a>");
        } else {out.loss(p, `Flattened cell ${node.t.toLowerCase()}`); inline(node.c[1], out, `${p}.c[1]`, html);}
        break;
      case "Span":
        if(html) {out.add("<span"); out.attrs(node.c[0]); out.add(">"); inline(node.c[1], out, `${p}.c[1]`, true); out.add("</span>");}
        else {out.loss(p, "Flattened cell span formatting"); inline(node.c[1], out, `${p}.c[1]`, false);} break;
      default: out.loss(p, `Flattened cell inline ${node.t}`); out.textProjection(text => textInline(node, text), html);
    }
  }
}
function caption(c: Caption, out: Projection, path: string, html: boolean): void {
  if (c[0]?.length && c[1].length) out.loss(`${path}[0]`, "Flattened alternative short caption");
  if (c[1].length) blocks(c[1], out, `${path}[1]`, html);
  else if (c[0]) inline(c[0], out, `${path}[0]`, html);
}
function simpleCell(blocks: readonly Block[]): boolean {
  return blocks.length === 0 || (blocks.length === 1 && (blocks[0]?.t === "Plain" || blocks[0]?.t === "Para"));
}
async function htmlRows(rows: readonly Row[], out: Projection, colspecs: readonly ColSpec[], path: string, header: boolean, rowHeads = 0): Promise<void> {
  let current = -1;
  for (const placed of placeRows(rows, colspecs.length, path, rowHeads)) {
    await out.context.cooperate();
    if (!placed) continue;
    while (current < placed.row) {
      if (current >= 0) out.add("</tr>\n");
      current++; out.add("<tr"); out.attrs(rows[current]![0]); out.add(">");
    }
    const cell = placed.cell;
    const isHead = header || placed.column < rowHeads;
    const tag = isHead ? "th" : "td";
    out.add(`<${tag}`); out.attrs(cell[0]);
    if(isHead) out.add(` scope="${header ? "col" : "row"}"`);
    if(cell[2] !== 1) out.add(` rowspan="${cell[2]}"`);
    if(cell[3] !== 1) out.add(` colspan="${cell[3]}"`);
    const alignment = cell[1] === "AlignDefault" ? (colspecs[placed.column]?.[0] ?? "AlignDefault") : cell[1];
    if(alignments[alignment]) out.add(` style="text-align:${alignments[alignment]}"`);
    out.add(">"); blocks(cell[4], out, `${placed.path}[4]`, true); out.add(`</${tag}>`);
  }
  while (current < rows.length - 1) {
    if(current >= 0) out.add("</tr>\n");
    current++; out.add("<tr"); out.attrs(rows[current]![0]); out.add(">");
  }
  if(current >= 0) out.add("</tr>\n");
}
async function htmlTable(t: Table, out: Projection, p: string): Promise<void> {
  out.add("<table"); out.attrs(t.c[0]); out.add(">\n");
  if(t.c[1][1].length || t.c[1][0]?.length) {out.add("<caption>"); caption(t.c[1], out, `${p}.c[1]`, true); out.add("</caption>\n");}
  out.add("<colgroup>");
  for (const [align, width] of t.c[2]) {
    out.add("<col");
    const style = [width.t === "ColWidth" ? `width:${width.c * 100}%` : "", alignments[align] ? `text-align:${alignments[align]}` : ""].filter(Boolean).join(";");
    if(style) out.add(` style="${style}"`);
    out.add(">");
  }
  out.add("</colgroup>\n");
  if (t.c[3][1].length) {
    out.add("<thead"); out.attrs(t.c[3][0]); out.add(">\n"); await htmlRows(t.c[3][1], out, t.c[2], `${p}.c[3][1]`, true); out.add("</thead>\n");
  }
  for(const [i, body] of t.c[4].entries()) {
    out.add("<tbody"); out.attrs(body[0]); out.add(">\n");
    await htmlRows(body[2], out, t.c[2], `${p}.c[4][${i}][2]`, true);
    await htmlRows(body[3], out, t.c[2], `${p}.c[4][${i}][3]`, false, body[1]); out.add("</tbody>\n");
  }
  if(t.c[5][1].length) {out.add("<tfoot"); out.attrs(t.c[5][0]); out.add(">\n"); await htmlRows(t.c[5][1], out, t.c[2], `${p}.c[5][1]`, false); out.add("</tfoot>\n");}
  out.add("</table>\n");
}
function blocks(nodes: readonly Block[], out: Projection, path: string, html: boolean, start = 0): void {
  for(const [i, node] of nodes.entries()) {
    const p = `${path}[${i + start}]`;
    switch(node.t) {
      case "Plain": inline(node.c, out, `${p}.c`, html); break;
      case "Para": if(html) out.add("<p>"); inline(node.c, out, `${p}.c`, html); if(html) out.add("</p>"); else out.add("\n\n"); break;
      case "CodeBlock": if(html) {out.add("<pre><code"); out.attrs(node.c[0]); out.add(">"); out.escaped(node.c[1], true); out.add("</code></pre>");} else {out.loss(p, "Flattened complex block"); out.escaped(node.c[1], false);} break;
      case "BlockQuote": case "Div": {
        if(!html) {out.loss(p, "Flattened complex block"); textBlocks([node], out); break;}
        const tag = node.t === "Div" ? "div" : "blockquote";
        out.add(`<${tag}`); if(node.t === "Div") out.attrs(node.c[0]); out.add(">"); blocks(node.t === "Div" ? node.c[1] : node.c, out, node.t === "Div" ? `${p}.c[1]` : `${p}.c`, true); out.add(`</${tag}>`); break;
      }
      case "BulletList": case "OrderedList": {
        if(!html) {out.loss(p, "Flattened complex block"); textBlocks([node], out); break;}
        const tag = node.t === "BulletList" ? "ul" : "ol";
        if(node.t === "OrderedList" && (node.c[0][1] !== "DefaultStyle" && node.c[0][1] !== "Decimal" || node.c[0][2] !== "DefaultDelim" && node.c[0][2] !== "Period")) out.loss(p, "Flattened list numbering style");
        out.add(`<${tag}${node.t === "OrderedList" ? ` start="${node.c[0][0]}"` : ""}>`);
        for(const [j, item] of (node.t === "BulletList" ? node.c : node.c[1]).entries()) {out.add("<li>"); blocks(item, out, `${p}.c${node.t === "OrderedList" ? "[1]" : ""}[${j}]`, true); out.add("</li>");} out.add(`</${tag}>`); break;
      }
      case "Header": if(html) {out.add(`<h${Math.min(node.c[0], 6)}`); out.attrs(node.c[1]); out.add(">"); inline(node.c[2], out, `${p}.c[2]`, true); out.add(`</h${Math.min(node.c[0], 6)}>`);} else {out.add("#".repeat(Math.min(node.c[0], 6)) + " "); inline(node.c[2], out, `${p}.c[2]`, false); out.add("\n\n");} break;
      case "HorizontalRule": out.add(html ? "<hr>" : "---\n"); break;
      default: out.loss(p, `Flattened complex block ${node.t}`); out.textProjection(text => textBlocks([node], text), html);
    }
  }
}
async function rectangularRows(rows: readonly Row[], out: Projection, columns: number, path: string): Promise<void> {
  let current = -1, nextColumn = 0;
  function separator(): void { out.add(nextColumn + 1 === columns ? " |" : " | "); nextColumn++; }
  function endRow(): void { while(nextColumn < columns) separator(); out.add("\n"); }
  for(const placed of placeRows(rows, columns, path)) {
    await out.context.cooperate(); if(!placed) continue;
    while(current < placed.row) {if(current >= 0) endRow(); current++; nextColumn = 0; out.add("| ");}
    while(nextColumn < placed.column) separator();
    const cell = placed.cell;
    out.attributeLoss(cell[0], `${placed.path}[0]`);
    if(cell[2] !== 1 || cell[3] !== 1) out.loss(placed.path, "Flattened cell span");
    if(cell[1] !== "AlignDefault") out.loss(`${placed.path}[1]`, "Flattened cell alignment");
    if(!simpleCell(cell[4])) {out.loss(`${placed.path}[4]`, "Flattened complex cell blocks");
      // Use a bounded temporary projection, then escape its plain text for GFM.
      out.textProjection(text => textBlocks(cell[4], text), false);
    } else {const block = cell[4][0]; if(block?.t === "Plain" || block?.t === "Para") inline(block.c, out, `${placed.path}[4][0].c`, false);}
    separator();
  }
  while(current < rows.length - 1) {if(current >= 0) endRow(); current++; nextColumn = 0; out.add("| ");}
  if(current >= 0) endRow();
}
async function gfmTable(t: Table, out: Projection, p: string): Promise<void> {
  const columns = t.c[2].length;
  if(!columns) throw new PandocError("E_CAPABILITY", out.context.operation ?? "write", "GFM requires at least one column", "gfm", p);
  out.attributeLoss(t.c[0], `${p}.c[0]`);
  if(t.c[1][0]?.length || t.c[1][1].length) {out.loss(`${p}.c[1]`, "Flattened table caption"); const text = new Projection(out.context, out.format); textBlocks(t.c[1][1], text); if(t.c[1][0]?.length && !t.c[1][1].length) textInlines(t.c[1][0], text); const value = text.finish(); if(value.kind === "text") out.escaped(value.text, false); out.add("\n\n");}
  for(const [i, col] of t.c[2].entries()) if(col[1].t !== "ColWidthDefault") out.loss(`${p}.c[2][${i}][1]`, "Flattened column width");
  out.attributeLoss(t.c[3][0], `${p}.c[3][0]`);
  if(t.c[3][1].length !== 1) out.loss(`${p}.c[3][1]`, "Flattened table header to a single row");
  if(t.c[4].length !== 1) out.loss(`${p}.c[4]`, "Flattened multiple table bodies");
  out.attributeLoss(t.c[5][0], `${p}.c[5][0]`);
  if(t.c[5][1].length) out.loss(`${p}.c[5][1]`, "Flattened table footer");
  for(const [i, body] of t.c[4].entries()) {
    out.attributeLoss(body[0], `${p}.c[4][${i}][0]`);
    if(body[1]) out.loss(`${p}.c[4][${i}][1]`, "Flattened row header columns");
    if(body[2].length) out.loss(`${p}.c[4][${i}][2]`, "Flattened body header");
  }
  const sections: readonly (readonly [readonly Row[], string])[] = [[t.c[3][1], `${p}.c[3][1]`], ...t.c[4].flatMap((b, i) => [[b[2], `${p}.c[4][${i}][2]`] as const, [b[3], `${p}.c[4][${i}][3]`] as const]), [t.c[5][1], `${p}.c[5][1]`]];
  for(const [rows, path] of sections)
    for(const [i, row] of rows.entries()) out.attributeLoss(row[0], `${path}[${i}][0]`);
  // Serialize the whole head first to keep rowspan coordinates valid, then insert
  // the separator after its first physical row. No rectangular array is needed.
  const head = new Projection(out.context, out.format);
  if(t.c[3][1].length) await rectangularRows(t.c[3][1], head, columns, `${p}.c[3][1]`);
  else {out.context.charge("tableCells", columns); head.add("| "); for(let i = 0; i < columns; i++) head.add(i + 1 === columns ? " |" : " | "); head.add("\n");}
  const serialized = head.finish();
  if(serialized.kind !== "text") return;
  const end = serialized.text.indexOf("\n") + 1;
  out.add(serialized.text.slice(0, end));
  out.add("| "); for(const [i, col] of t.c[2].entries()) {if(i) out.add(" | "); out.add(delimiters[col[0]]);} out.add(" |\n");
  out.add(serialized.text.slice(end));
  for(const [i, body] of t.c[4].entries()) {await rectangularRows(body[2], out, columns, `${p}.c[4][${i}][2]`); await rectangularRows(body[3], out, columns, `${p}.c[4][${i}][3]`);}
  await rectangularRows(t.c[5][1], out, columns, `${p}.c[5][1]`);
}
async function plainTable(t: Table, out: Projection, p: string): Promise<void> {
  if(t.c[1][0]?.length && t.c[1][1].length) out.loss(`${p}.c[1][0]`, "Flattened alternative short caption");
  if(t.c[1][1].length) {textBlocks(t.c[1][1], out); out.add("\n");}
  else if(t.c[1][0]?.length) {textInlines(t.c[1][0], out); out.add("\n");}
  const sections: readonly (readonly [readonly Row[], string])[] = [[t.c[3][1], `${p}.c[3][1]`], ...t.c[4].flatMap((b, i) => [[b[2], `${p}.c[4][${i}][2]`] as const, [b[3], `${p}.c[4][${i}][3]`] as const]), [t.c[5][1], `${p}.c[5][1]`]];
  for(const [rows, path] of sections) for(const [i, row] of rows.entries()) {
    await out.context.cooperate();
    for(const [j, cell] of row[1].entries()) {
      const cp = `${path}[${i}][1][${j}]`;
      if(j) out.add("\t");
      if(cell[2] !== 1 || cell[3] !== 1) out.loss(cp, "Flattened cell span");
      if(!simpleCell(cell[4])) out.loss(`${cp}[4]`, "Flattened complex cell blocks");
      else checkPlainNotes(cell[4], `${cp}[4]`, out);
      textBlocks(cell[4], out);
    }
    out.add("\n");
  }
}
function checkPlainNotes(value: unknown, path: string, out: Projection): void {
  out.context.checkpoint();
  if(value === null || typeof value !== "object") return;
  if("t" in value && value.t === "Note") {out.loss(path, "Flattened complex cell note"); return;}
  if(Array.isArray(value)) for(const [i, child] of value.entries()) checkPlainNotes(child, `${path}[${i}]`, out);
  else for(const [key, child] of Object.entries(value)) checkPlainNotes(child, `${path}.${key}`, out);
}
export async function writeHtml5(document: Document, context: AdapterContext): Promise<SerializedDocument> {
  const out = new Projection(context, "html5");
  for(const [i, node] of document.blocks.entries()) {
    await context.cooperate();
    if(node.t === "Table") await htmlTable(node, out, `$.blocks[${i}]`);
    else blocks([node], out, "$.blocks", true, i);
  }
  return out.finish();
}
export async function writeGfm(document: Document, context: AdapterContext, selection?: FormatSelection): Promise<SerializedDocument> {
  const out = new Projection(context, "gfm");
  for(const [i, node] of document.blocks.entries()) {
    await context.cooperate();
    if(node.t === "Table") {
      if(selection?.extensions.pipe_tables === false) throw new PandocError("E_CAPABILITY", context.operation ?? "write", "GFM pipe_tables is disabled", "gfm", `$.blocks[${i}]`);
      await gfmTable(node, out, `$.blocks[${i}]`);
    } else blocks([node], out, "$.blocks", false, i);
  }
  return out.finish();
}
export async function writePlain(document: Document, context: AdapterContext): Promise<SerializedDocument> {
  const out = new Projection(context, "plain");
  for(const [i, node] of document.blocks.entries()) {
    await context.cooperate();
    if(node.t === "Table") await plainTable(node, out, `$.blocks[${i}]`);
    else {textBlocks([node], out); out.add("\n");}
  }
  return out.finish();
}
