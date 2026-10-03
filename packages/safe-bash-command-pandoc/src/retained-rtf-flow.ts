import {emptyText, type TextRange} from "./backed-text.js";
import {rtfError} from "./rtf-syntax.js";
import {runControls, type RtfState} from "./rtf-profile.js";
import type {AdapterContext} from "./types.js";
import type {RetainedRtfAst, RtfValue} from "./retained-rtf-ast.js";
import type {RetainedRtfDefinitions} from "./retained-rtf-definitions.js";
import type {RetainedRtfLists} from "./retained-rtf-lists.js";

/** Parser document state. All variable-size content uses the supplied AST
 * store (also used by definitions). Only the supported nine-level list stack,
 * current formatting, and table counters remain resident. */
export class RetainedRtfFlow {
  blocks!: RtfValue;
  inlines!: RtfValue;
  private rows!: RtfValue;
  private cells!: RtfValue;
  private cellBlocks!: RtfValue;
  private empty!: RtfValue;
  private run = emptyText();
  private high: number | undefined;
  private listStack: {id: number; level: number; items: RtfValue}[] = [];
  private boundaries: {count: number; last: number} | undefined;
  private tableColumns = 0;
  literal = false;
  inlineOnly = false;
  private constructor(readonly ast: RetainedRtfAst, private readonly definitions: RetainedRtfDefinitions, private readonly lists: RetainedRtfLists, private readonly context: AdapterContext) {}
  static async create(ast: RetainedRtfAst, definitions: RetainedRtfDefinitions, lists: RetainedRtfLists, context: AdapterContext): Promise<RetainedRtfFlow> {
    const flow = new RetainedRtfFlow(ast, definitions, lists, context);
    flow.blocks = await ast.array(); flow.inlines = await ast.array(); flow.rows = await ast.array();
    flow.cells = await ast.array(); flow.cellBlocks = await ast.array(); flow.empty = await ast.value(["", [], []]);
    return flow;
  }
  async emit(text: string): Promise<void> {await this.ast.text.append(this.run, await this.ast.text.from([text]));}
  noSurrogate(): void {if (this.high !== undefined) rtfError(this.context, "Unpaired RTF Unicode surrogate", "E_ENCODING");}
  async unicode(code: number): Promise<void> {
    this.context.charge("text", 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      this.noSurrogate(); this.high = code; return;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      if (this.high === undefined) rtfError(this.context, "Unpaired RTF Unicode surrogate", "E_ENCODING");
      await this.emit(String.fromCharCode(this.high, code)); this.high = undefined; return;
    }
    this.noSurrogate(); await this.emit(String.fromCharCode(code));
  }
  async append(node: RtfValue): Promise<void> {
    const last = await this.ast.edge(this.inlines, true);
    if (last && await this.ast.name(last) === "Str" && await this.ast.name(node) === "Str") {
      await this.ast.appendText((await this.ast.content(last))!, await this.ast.range((await this.ast.content(node))!));
    } else {this.context.charge("references", 1); await this.ast.push(this.inlines, node);}
  }
  async flush(state: RtfState): Promise<void> {
    if (!this.run.units) return;
    const ast = this.ast, content = await ast.array();
    let word = emptyText(), buffer = "";
    const save = async () => {if (buffer) {await ast.text.append(word, await ast.text.from([buffer])); buffer = "";}};
    const endWord = async () => {
      await save();
      if (word.units) {await ast.push(content, await ast.tag("Str", await ast.string(word))); word = emptyText();}
    };
    for await (const chunk of ast.text.unicodeChunks(this.run)) for (const char of chunk) {
      this.context.checkpoint();
      if (char === " " || char === "\t") {await endWord(); await ast.push(content, await ast.tag("Space"));}
      else {buffer += char; if (buffer.length >= 4096) await save();}
    }
    await endWord(); this.run = emptyText();
    if (this.literal) {for await (const node of ast.children(content)) await this.append(node); return;}
    let wrapped = content;
    for (const tag of Object.values(runControls).reverse()) if (state.tags.has(tag)) wrapped = await ast.value([await ast.tag(tag, wrapped)]);
    const attributes = await ast.array(), fontId = state.font ?? state.defaultFont;
    if (fontId !== undefined) {
      const font = await this.definitions.font(fontId);
      if (!font) rtfError(this.context, `Undefined RTF font ${fontId}`, "E_PARSE");
      await ast.push(attributes, await ast.value(["font-family", await ast.string(font.name)]));
    }
    if (state.color) {
      const color = await this.definitions.color(state.color);
      if (!color) rtfError(this.context, `Undefined RTF color ${state.color}`, "E_PARSE");
      await ast.push(attributes, await ast.value(["color", color]));
    }
    if (state.size !== undefined) await ast.push(attributes, await ast.value(["font-size", `${state.size / 2}pt`]));
    if (await ast.count(attributes)) wrapped = await ast.value([await ast.tag("Span", await ast.value([["", [], attributes], wrapped]))]);
    for await (const node of ast.children(wrapped)) await this.append(node);
  }
  async literalText(state: RtfState): Promise<TextRange> {
    this.noSurrogate(); await this.flush(state);
    const result = emptyText();
    for await (const node of this.ast.children(this.inlines)) {
      const name = await this.ast.name(node);
      if (name === "Str") await this.ast.text.append(result, await this.ast.range((await this.ast.content(node))!));
      else if (name === "Space") await this.ast.text.append(result, await this.ast.text.from([" "]));
      else rtfError(this.context, "Non-text RTF literal", "E_CAPABILITY");
    }
    return result;
  }
  async paragraph(state: RtfState, explicit = false): Promise<void> {
    this.noSurrogate(); await this.flush(state);
    if (this.inlineOnly) rtfError(this.context, "Block content in RTF field instruction/result", "E_CAPABILITY");
    const ast = this.ast;
    if (!await ast.count(this.inlines) && !explicit) return;
    for (const last of [false, true]) {
      let edge = await ast.edge(this.inlines, last);
      while (edge && await ast.name(edge) === "Space") {await ast.remove(this.inlines, last); edge = await ast.edge(this.inlines, last);}
    }
    let node = state.heading === undefined ? await ast.tag("Para", this.inlines) : await ast.tag("Header", await ast.value([state.heading, this.empty, this.inlines]));
    this.inlines = await ast.array();
    const attributes = await ast.array();
    if (state.alignment !== undefined) await ast.push(attributes, await ast.value(["text-align", state.alignment]));
    for (const [key, value] of [["margin-left", state.left], ["margin-right", state.right], ["text-indent", state.indent]] as const)
      if (value !== undefined) await ast.push(attributes, await ast.value([key, `${value / 20}pt`]));
    if (await ast.count(attributes)) node = await ast.tag("Div", await ast.value([["", [], attributes], [node]]));
    if (this.boundaries !== undefined) {await ast.push(this.cellBlocks, node); return;}
    await this.finishTable();
    if (state.list === undefined) {this.listStack = []; await ast.push(this.blocks, node); return;}
    const level = await this.lists.resolve(state.list, state.level);
    if (!level) rtfError(this.context, `Undefined RTF list ${state.list} level ${state.level}`, "E_CAPABILITY");
    while (this.listStack.length && (this.listStack.at(-1)!.level > state.level || this.listStack.at(-1)!.id !== state.list)) this.listStack.pop();
    if (this.listStack.at(-1)?.level !== state.level) {
      const parent = this.listStack.at(-1);
      if (state.level !== (parent ? parent.level + 1 : 0)) rtfError(this.context, "RTF list skips a nesting level", "E_PARSE");
      const items = await ast.array();
      const list = level.style === "bullet" ? await ast.tag("BulletList", items) : await ast.tag("OrderedList", await ast.value([[level.start, await ast.tag(level.style), await ast.tag(level.delimiter)], items]));
      if (parent) await ast.push((await ast.edge(parent.items, true))!, list); else await ast.push(this.blocks, list);
      this.listStack.push({id: state.list, level: state.level, items});
    }
    await ast.push(this.listStack.at(-1)!.items, await ast.value([node]));
  }
  private async finishTable(): Promise<void> {
    const ast = this.ast;
    if (!await ast.count(this.rows)) return;
    const columns = await ast.array();
    for (let column = 0; column < this.tableColumns; column++) await ast.push(columns, await ast.value([await ast.tag("AlignDefault"), await ast.tag("ColWidthDefault")]));
    await ast.push(this.blocks, await ast.tag("Table", await ast.value([this.empty, [null, []], columns, [this.empty, []], [[this.empty, 0, [], this.rows]], [this.empty, []]])));
    this.rows = await ast.array(); this.tableColumns = 0; this.listStack = [];
  }
  async startRow(): Promise<void> {
    if (this.inlineOnly || this.boundaries !== undefined || await this.ast.count(this.inlines)) rtfError(this.context, "Invalid RTF table row boundary");
    this.boundaries = {count: 0, last: 0}; this.cells = await this.ast.array(); this.cellBlocks = await this.ast.array();
  }
  get inTable(): boolean {return this.boundaries !== undefined;}
  boundary(value: number): void {
    if (!this.boundaries) rtfError(this.context, "RTF cell boundary outside row");
    if (this.boundaries.count && value <= this.boundaries.last) rtfError(this.context, "Non-increasing RTF cell boundaries");
    this.context.bound("tableColumns", this.boundaries.count + 1);
    this.boundaries.count++; this.boundaries.last = value;
  }
  tableParagraph(): void {if (!this.boundaries) rtfError(this.context, "RTF table paragraph outside row");}
  async cell(state: RtfState): Promise<void> {
    const ast = this.ast, count = await ast.count(this.cells);
    if (!this.boundaries || count >= this.boundaries.count) rtfError(this.context, "RTF cell outside declared row");
    await this.paragraph(state);
    this.context.bound("tableCells", count + 1);
    await ast.push(this.cells, await ast.value([this.empty, await ast.tag("AlignDefault"), 1, 1, this.cellBlocks])); this.cellBlocks = await ast.array();
  }
  async row(): Promise<void> {
    const ast = this.ast, count = await ast.count(this.cells);
    if (!this.boundaries?.count || count !== this.boundaries.count || await ast.count(this.inlines) || await ast.count(this.cellBlocks)) rtfError(this.context, "Incomplete RTF table row");
    if (this.tableColumns && this.tableColumns !== count) rtfError(this.context, "Changing RTF table geometry is unsupported", "E_CAPABILITY");
    this.context.bound("tableRows", await ast.count(this.rows) + 1); this.tableColumns = count;
    await ast.push(this.rows, await ast.value([this.empty, this.cells])); this.cells = await ast.array(); this.boundaries = undefined;
  }
  async finish(state: RtfState, note = false): Promise<void> {
    await this.paragraph(state);
    if (this.boundaries !== undefined) rtfError(this.context, note ? "Unfinished RTF footnote table" : "Unfinished RTF table");
    await this.finishTable();
  }
}
