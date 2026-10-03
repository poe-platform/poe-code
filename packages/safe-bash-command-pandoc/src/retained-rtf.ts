import type {backedJsonOrder} from "./backed-json-order.js";
import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import {BackedTextOrder} from "./backed-text-order.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {readJsonNumber} from "./json-number.js";
import {PandocError} from "./errors.js";

import {readRtfFontSize, RtfFontSizeError} from "./rtf-font-size.js";


type ListSpec = {id: number; level: number; nfc: number; start: number; delim: string};
type Paragraph = {indent: number; marker?: string | undefined; style?: number; cell?: string; list?: ListSpec};
type Job = {op: string; node: number; path: number; cursor?: number; end?: number; index?: number; mode?: string; value?: string;
  depth?: number; state?: Paragraph; columns?: number; width?: number; start?: number; style?: string; delim?: string};
export type RetainedRtfImage = {width: number; height: number; encoding: "png" | "jpeg"; chunks: AsyncIterable<Uint8Array>};
const formatting: Readonly<Record<string, string>> = {Emph: "i", Strong: "b", Underline: "ul", Strikeout: "strike", Superscript: "super", Subscript: "sub", SmallCaps: "scaps"};
const alignments: Readonly<Record<string, string>> = {AlignDefault: "ql", AlignLeft: "ql", AlignRight: "qr", AlignCenter: "qc"};

class RtfTape {
  readonly text: BackedText;
  private output = emptyText();
  private top = 0;
  private readonly fonts: BackedTextOrder;
  private readonly colors: BackedTextOrder;
  private readonly fontRanks: IntegerTable;
  private readonly colorRanks: IntegerTable;
  private readonly lists: IntegerTable;
  private readonly listNodes: IntegerTable;
  private listCount = 0;
  constructor(private readonly tree: BackedJson, private readonly storage: PagedStorage,
    private readonly context: ExecutionContext, private readonly options: ConversionOptions,
    private readonly order: Awaited<ReturnType<typeof backedJsonOrder>>,
    private readonly image: (node: number) => Promise<RetainedRtfImage>) {
    this.text = new BackedText(storage, units => context.cooperate(units));
    this.fonts = new BackedTextOrder(storage, this.text); this.colors = new BackedTextOrder(storage, this.text);
    this.fontRanks = new IntegerTable(storage, 64); this.colorRanks = new IntegerTable(storage, 64);
    this.lists = new IntegerTable(storage, 64); this.listNodes = new IntegerTable(storage, 64);
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
  private async at(node: number, index: number): Promise<number> {
    let child = node + 32;
    for (let i = 0; i < index; i++) {child = (await this.tree.describe(child)).end; await this.context.cooperate();}
    return child;
  }
  private async count(node: number): Promise<number> {return (await this.tree.describe(node)).children;}
  private async scalar(node: number): Promise<TextRange> {return this.text.from(this.tree.scalarChunks(node));}
  private async tag(node: number): Promise<string> {return (await this.tree.smallText((await this.tree.property(node, "t"))!, 32))!;}
  private async number(node: number): Promise<number> {return readJsonNumber(this.tree.scalarChunks(node), units => this.context.cooperate(units));}
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
  private fail(message: string, code: "E_UNSUPPORTED_FEATURE" | "E_RESOURCE" | "E_OPTION" = "E_UNSUPPORTED_FEATURE"): never {
    throw new PandocError(code, "convert", message, "rtf");
  }
  private loss(message: string): void {
    if (!this.options.lossy) this.fail(message);
    this.context.report({code: "W_PRESENTATION_LOSS", operation: "convert", format: "rtf", message});
  }
  private async present(node: number): Promise<boolean> {
    return (await this.tree.describe(node + 32)).end > node + 64 || !!await this.count(await this.at(node, 1)) || !!await this.count(await this.at(node, 2));
  }
  private async add(value: string | TextRange): Promise<void> {
    await this.text.append(this.output, await this.text.from(typeof value === "string" ? [value] : this.text.chunks(value)));
  }
  private async put(position: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); await this.storage.write(position, bytes);
  }
  private async pointer(position: number): Promise<number> {
    const bytes = await this.storage.read(position, 8); return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  private async escaped(value: TextRange): Promise<void> {
    let buffer = "", cr = false;
    for await (const chunk of this.text.chunks(value)) for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i]!, unit = chunk.charCodeAt(i);
      if (cr) {if (char !== "\n") buffer += "\\line "; cr = false;}
      if ("{}\\".includes(char)) buffer += "\\" + char;
      else if (char === "\t") buffer += "\\tab ";
      else if (char === "\n") buffer += "\\line ";
      else if (char === "\r") cr = true;
      else if (unit < 32 || unit === 127) this.fail("Unsupported RTF text control");
      else if (unit >= 128) buffer += "\\u" + (unit > 32767 ? unit - 65536 : unit) + " ?";
      else buffer += char;
      if (buffer.length >= 4096) {await this.add(buffer); buffer = "";}
    }
    if (cr) buffer += "\\line ";
    if (buffer) await this.add(buffer);
  }
  private async attrs(node: number, paragraph = false): Promise<void> {
    if ((await this.tree.describe(node + 32)).end > node + 64 || await this.count(await this.at(node, 1))) this.loss("Unsupported RTF identifiers or classes");
    for await (const pair of this.tree.children(await this.at(node, 2))) {
      const key = await this.tree.smallText(pair + 32, 16), valueNode = await this.at(pair, 1);
      if (key === "font-family") {
        const id = await this.fonts.find(await this.scalar(valueNode));
        if (!id) this.fail("Font reference must be explicitly declared in rtf-fonts metadata", "E_RESOURCE");
        await this.add("\\f" + Number(await this.fontRanks.get(BigInt(id))));
      } else if (key === "color") {
        const id = await this.colors.find(await this.text.lower(await this.scalar(valueNode)));
        await this.add("\\cf" + Number(await this.colorRanks.get(BigInt(id)) ?? 0n));
      } else if (key === "font-size") {
        let size: number;
        try {size = await readRtfFontSize(this.tree.scalarChunks(valueNode));}
        catch (error) {if (!(error instanceof RtfFontSizeError)) throw error; this.fail(error.message);}
        await this.add("\\fs" + size);
      } else {
        const value = await this.tree.smallText(valueNode, 7);
        if (key === "dir" && (value === "ltr" || value === "rtl")) await this.add("\\" + value + (paragraph ? "par" : "ch"));
        else if (key === "text-align" && paragraph && value && ["left", "right", "center", "justify"].includes(value))
          await this.add("\\" + ({left: "ql", right: "qr", center: "qc", justify: "qj"} as Record<string, string>)[value]);
        else {let name = ""; for await (const chunk of this.tree.scalarChunks(pair + 32)) name += chunk; this.loss("Unsupported RTF attribute: " + name);}
      }
    }
  }
  private async collect(node: number): Promise<void> {
    await this.push({op: "collect", node, path: 0, depth: 0});
    while (this.top) {
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent; const job = frame.job;
      await this.context.cooperate();
      if (job.op === "array") {
        if (job.node < job.end!) {await this.push({...job, node: (await this.tree.describe(job.node)).end}); await this.push({...job, op: "collect"});} continue;
      }
      if (job.op === "object") {
        if (!job.cursor) continue;
        const value = (await this.tree.describe(job.cursor)).end;
        await this.push({...job, cursor: await this.order.next(value, job.node)}); await this.push({...job, op: "collect", node: value}); continue;
      }
      const header = await this.tree.describe(job.node);
      if (header.kind === "object") {
        const tagNode = await this.tree.property(job.node, "t"), tag = tagNode === undefined ? undefined : await this.tree.smallText(tagNode, 11);
        if (tag === "OrderedList" || tag === "BulletList") {
          if (job.depth! > 8) this.fail("RTF supports at most nine nested list levels");
          const content = (await this.tree.property(job.node, "c"))!, spec = content + 32, ordered = tag === "OrderedList";
          const start = ordered ? await this.number(spec + 32) : 1, style = ordered ? await this.tag(await this.at(spec, 1)) : "DefaultStyle";
          this.marker(start, style);
          const list: ListSpec = {id: ++this.listCount, level: job.depth!++, start,
            nfc: ordered ? ({UpperRoman: 1, LowerRoman: 2, UpperAlpha: 3, LowerAlpha: 4} as Record<string, number>)[style] ?? 0 : 23,
            delim: ordered ? await this.tag(await this.at(spec, 2)) : "Period"};
          const record = BigInt(await this.record(list)); await this.lists.set(BigInt(list.id), record); await this.listNodes.set(BigInt(job.node), record);
        }
        if (header.children) await this.push({...job, op: "object", cursor: await this.order.first(job.node)});
      } else if (header.kind === "array") {
        if (header.children === 2 && (await this.tree.describe(job.node + 32)).kind === "string" && await this.tree.smallText(job.node + 32, 5) === "color") {
          const value = await this.tree.smallText(await this.at(job.node, 1), 7);
          if (value?.length !== 7 || value[0] !== "#" || [...value.slice(1)].some(char => !"0123456789abcdefABCDEF".includes(char))) this.fail("Invalid RTF RGB color");
          await this.colors.add(await this.text.from([value.toLowerCase()]));
        }
        await this.push({...job, op: "array", node: job.node + 32, end: header.end});
      }
    }
  }
  private async paragraph(state: Paragraph, attr?: number): Promise<void> {
    await this.add("{\\pard\\plain\\s" + (state.style ?? 0));
    if (state.style) await this.add("\\b\\fs" + (40 - state.style * 2));
    await this.add("\\li" + state.indent + "\\fi" + (state.marker ? -360 : 0) + "\\ltrpar");
    if (state.cell) await this.add("\\intbl\\" + alignments[state.cell]);
    if (attr !== undefined) await this.attrs(attr, true);
    if (state.marker && state.list) await this.add("\\tx" + state.indent + "\\ls" + state.list.id + "\\ilvl" + state.list.level);
    await this.add(" ");
    if (state.marker) {await this.add("{\\listtext "); await this.escaped(await this.text.from([state.marker])); await this.add("\\tab}");}
  }
  private async task(node: number): Promise<boolean | undefined> {
    const attr = node + 32;
    if (await this.count(await this.at(node, 1)) || (await this.tree.describe(attr + 32)).end > attr + 64) return undefined;
    const classes = await this.at(attr, 1), pairs = await this.at(attr, 2);
    if (await this.count(classes) !== 1 || await this.tree.smallText(classes + 32, 16) !== "task-list-marker" || await this.count(pairs) !== 1 || await this.tree.smallText(pairs + 64, 7) !== "checked") return undefined;
    const state = await this.tree.smallText(await this.at(pairs + 32, 1), 5); return state === "true" ? true : state === "false" ? false : undefined;
  }
  async render(): Promise<TextRange> {
    const meta = (await this.tree.property(this.tree.rootPosition, "meta"))!, blocks = (await this.tree.property(this.tree.rootPosition, "blocks"))!;
    const declared = await this.tree.property(meta, "rtf-fonts");
    if (declared !== undefined) {
      if (await this.tag(declared) !== "MetaList") this.fail("rtf-fonts requires a list of reference names", "E_OPTION");
      for await (const item of this.tree.children((await this.tree.property(declared, "c"))!)) {
        if (await this.tag(item) !== "MetaString") this.fail("Invalid RTF font reference", "E_OPTION");
        const value = await this.scalar((await this.tree.property(item, "c"))!);
        let first = "", last = "";
        for await (const chunk of this.text.chunks(value)) {
          first ||= chunk[0] ?? ""; last = chunk.slice(-1);
          for (const char of chunk) if (char.charCodeAt(0) < 32 || char.charCodeAt(0) >= 127 || ";{}\\".includes(char)) this.fail("Invalid RTF font reference", "E_OPTION");
        }
        if (!value.units || !first.trim() || !last.trim()) this.fail("Invalid RTF font reference", "E_OPTION");
        await this.fonts.add(value);
      }
    }
    await this.collect(blocks);
    await this.add("{\\rtf1\\ansi\\ansicpg1252\\uc1{\\fonttbl{\\f0\\fnil ;}");
    let index = 0;
    for await (const font of this.fonts.entries()) {
      await this.fontRanks.set(BigInt(font.identity), BigInt(++index));
      await this.add("{\\f" + index + "\\fnil "); await this.add(font.value); await this.add(";}");
    }
    await this.add("}\n{\\colortbl;"); index = 0;
    for await (const color of this.colors.entries()) {
      let value = ""; for await (const chunk of this.text.chunks(color.value)) value += chunk;
      await this.colorRanks.set(BigInt(color.identity), BigInt(++index));
      await this.add("\\red" + parseInt(value.slice(1, 3), 16) + "\\green" + parseInt(value.slice(3, 5), 16) + "\\blue" + parseInt(value.slice(5), 16) + ";");
    }
    await this.add("}\n{\\stylesheet{\\s0\\fs24 Normal;}");
    for (let level = 1; level <= 6; level++) await this.add("{\\s" + level + "\\sbasedon0\\snext0\\b\\fs" + (40 - level * 2) + " Heading " + level + ";}");
    await this.add("}\n");
    if (this.listCount) {
      await this.add("{\\*\\listtable");
      for (let i = 1; i <= this.listCount; i++) {
        const list = await this.read<ListSpec>(Number(await this.lists.get(BigInt(i))));
        await this.add("{\\list\\listtemplateid" + list.id);
        for (let level = 0; level <= list.level; level++) {
          await this.add("{\\listlevel\\levelnfc" + list.nfc + "\\levelstartat" + list.start + "{\\leveltext");
          if (list.nfc === 23) await this.add("\\'01\\u8226 ?;}{\\levelnumbers;}");
          else {
            const both = list.delim === "TwoParens";
            await this.add(both ? "\\'03(" : "\\'02");
            await this.add("\\'" + level.toString(16).padStart(2, "0") + (["OneParen", "TwoParens"].includes(list.delim) ? ")" : ".") + ";}{\\levelnumbers\\'0" + (both ? 2 : 1) + ";}");
          }
          await this.add("\\fi-360\\li" + (level + 1) * 360 + "}");
        }
        await this.add("\\listid" + list.id + "}");
      }
      await this.add("}\n{\\*\\listoverridetable");
      for (let i = 1; i <= this.listCount; i++) await this.add("{\\listoverride\\listid" + i + "\\listoverridecount0\\ls" + i + "}");
      await this.add("}\n");
    }
    await this.push(this.list(blocks, 0, "block", {state: {indent: 0}}));
    while (this.top) {
      await this.context.cooperate();
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent; const job = frame.job;
      if (job.op === "literal") {await this.add(job.value!); continue;}
      if (job.op === "list") {
        const cursor = job.cursor ?? job.node + 32, index = job.index ?? 0;
        if (cursor >= (await this.tree.describe(job.node)).end) continue;
        await this.push({...job, cursor: (await this.tree.describe(cursor)).end, index: index + 1});
        await this.push({...job, op: job.mode!, node: cursor, index}); continue;
      }
      if (job.op === "paragraph") {
        await this.paragraph(job.state!); await this.sequence(this.list(job.node, 0, "inline"), this.literal("\\par}\n")); continue;
      }
      if (job.op === "item") {
        let marker = "•";
        if (job.style) marker = (job.delim === "TwoParens" ? "(" : "") + this.marker(job.start! + job.index!, job.style) + (["OneParen", "TwoParens"].includes(job.delim!) ? ")" : ".");
        await this.push(this.list(job.node, 0, "block", {state: {...job.state!, marker}})); continue;
      }
      if (job.op !== "inline" && job.op !== "block") {await this.table(job); continue;}
      const tag = await this.tag(job.node), content = await this.tree.property(job.node, "c");
      if (job.op === "inline") {
        if (tag === "Str") {await this.escaped(await this.scalar(content!)); continue;}
        if (tag === "Space" || tag === "SoftBreak") {await this.add(" "); continue;}
        if (tag === "LineBreak") {await this.add("\\line "); continue;}
        if (formatting[tag]) {await this.sequence(this.literal("{\\" + formatting[tag] + " "), this.list(content!, 0, "inline"), this.literal("}")); continue;}
        if (tag === "Cite") {await this.push(this.list(await this.at(content!, 1), 0, "inline")); continue;}
        if (tag === "Span" || tag === "Code") {
          if (tag === "Span") {const task = await this.task(content!); if (task !== undefined) {await this.escaped(await this.text.from([task ? "☒ " : "☐ "])); continue;}}
          await this.add("{"); await this.attrs(content! + 32);
          if (await this.count(await this.at(content! + 32, 2))) await this.add(" ");
          if (tag === "Code") {await this.escaped(await this.scalar(await this.at(content!, 1))); await this.add("}");}
          else await this.sequence(this.list(await this.at(content!, 1), 0, "inline"), this.literal("}"));
          continue;
        }
        if (tag === "Quoted") {
          const single = await this.tag(content! + 32) === "SingleQuote";
          await this.escaped(await this.text.from([single ? "‘" : "“"]));
          await this.sequence(this.list(await this.at(content!, 1), 0, "inline"), {op: "quoteEnd", node: 0, path: 0, value: single ? "’" : "”"}); continue;
        }
        if (tag === "Link") {
          const target = await this.at(content!, 2), value = await this.scalar(target + 32);
          let first = "", last = "", scheme = "", colon = false;
          for await (const chunk of this.text.chunks(value)) {
            first ||= chunk[0] ?? ""; last = chunk.slice(-1);
            for (const char of chunk) {
              if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || '\\{}"'.includes(char)) this.fail("Unsafe RTF hyperlink");
              if (!colon) {if (char === ":") colon = true; else if (scheme.length <= 6) scheme += char;}
            }
          }
          if (!value.units || !first.trim() || !last.trim()) this.fail("Unsafe RTF hyperlink");
          if (colon && !["https", "http", "mailto", "tel"].includes(scheme.toLowerCase())) this.fail("Unsupported RTF hyperlink scheme");
          if ((await this.tree.describe(await this.at(target, 1))).end > await this.at(target, 1) + 32) this.fail("RTF link titles unsupported");
          await this.add('{\\field{\\*\\fldinst HYPERLINK "'); await this.escaped(value); await this.add('"}{\\fldrslt ');
          await this.attrs(content! + 32); if (await this.count(await this.at(content! + 32, 2))) await this.add(" ");
          await this.sequence(this.list(await this.at(content!, 1), 0, "inline"), this.literal("}}")); continue;
        }
        if (tag === "Image") {
          const target = await this.at(content!, 2);
          if (await this.present(content! + 32) || (await this.tree.describe(await this.at(target, 1))).end > await this.at(target, 1) + 32) this.fail("RTF picture attributes/titles unsupported");
          const picture = await this.image(target + 32);
          await this.add("{\\pict\\" + picture.encoding + "blip\\picw" + picture.width + "\\pich" + picture.height + "\\picwgoal" + picture.width * 15 + "\\pichgoal" + picture.height * 15 + " ");
          let buffer = "";
          for await (const bytes of picture.chunks) for (const byte of bytes) {
            buffer += byte.toString(16).padStart(2, "0");
            if (buffer.length >= 4096) {await this.add(buffer); buffer = "";}
          }
          if (buffer) await this.add(buffer); await this.add("}"); continue;
        }
        this.fail("Unsupported RTF inline: " + tag);
      }
      const state = job.state!, current: Paragraph = {...state, marker: job.index === 0 ? state.marker : undefined};
      if (tag === "Plain" || tag === "Para") {await this.push({op: "paragraph", node: content!, path: 0, state: current}); continue;}
      if (tag === "Header") {
        await this.paragraph({...current, style: await this.number(content! + 32)}, await this.at(content!, 1));
        await this.sequence(this.list(await this.at(content!, 2), 0, "inline"), this.literal("\\par}\n")); continue;
      }
      if (tag === "CodeBlock") {
        await this.paragraph(current); await this.add("{"); await this.attrs(content! + 32);
        if (await this.count(await this.at(content! + 32, 2))) await this.add(" ");
        await this.escaped(await this.scalar(await this.at(content!, 1))); await this.add("}\\par}\n"); continue;
      }
      if (tag === "LineBlock") {await this.push(this.list(content!, 0, "paragraph", {state: current})); continue;}
      if (tag === "BlockQuote") {await this.push(this.list(content!, 0, "block", {state: {...current, indent: state.indent + 720}})); continue;}
      if (tag === "Div") {
        if (await this.present(content! + 32)) this.loss("Attributed RTF Div projected to contained blocks");
        await this.push(this.list(await this.at(content!, 1), 0, "block", {state: current})); continue;
      }
      if (tag === "OrderedList" || tag === "BulletList") {
        if (current.marker) this.fail("List item must begin with a paragraph");
        const ordered = tag === "OrderedList", spec = content! + 32, list = await this.read<ListSpec>(Number(await this.listNodes.get(BigInt(job.node))));
        const extra: Partial<Job> = {state: {...current, indent: state.indent + 360, list}};
        if (ordered) {extra.start = await this.number(spec + 32); extra.style = await this.tag(await this.at(spec, 1)); extra.delim = await this.tag(await this.at(spec, 2));}
        await this.push(this.list(ordered ? await this.at(content!, 1) : content!, 0, "item", extra)); continue;
      }
      if (tag === "Table") {await this.push({op: "table", node: content!, path: 0, state}); continue;}
      this.fail("Unsupported RTF block: " + tag);
    }
    await this.add("}\n"); return this.output;
  }
  private async table(job: Job): Promise<void> {
    if (job.op === "quoteEnd") {await this.escaped(await this.text.from([job.value!])); return;}
    if (job.op === "table") {
      if (job.state!.cell) this.fail("Nested RTF tables unsupported");
      const head = await this.at(job.node, 3), bodies = await this.at(job.node, 4), foot = await this.at(job.node, 5);
      if (await this.present(job.node + 32) || await this.present(head + 32)) this.fail("Attributed RTF table sections unsupported");
      for await (const body of this.tree.children(bodies)) if (await this.present(body + 32)) this.fail("Attributed RTF table sections unsupported");
      if (await this.present(foot + 32)) this.fail("Attributed RTF table sections unsupported");
      const caption = await this.at(job.node, 1), long = await this.at(caption, 1);
      await this.push({...job, op: "tableStart"});
      if (await this.count(long)) await this.push(this.list(long, 0, "block", {state: job.state!}));
      else if ((await this.tree.describe(caption + 32)).kind === "array") await this.push({op: "paragraph", node: caption + 32, path: 0, state: job.state!});
      return;
    }
    if (job.op === "tableStart") {
      const cols = await this.at(job.node, 2), width = await this.count(cols), columns = this.storage.allocate(width * 16);
      let total = 0, index = 0;
      for await (const col of this.tree.children(cols)) {
        const spec = await this.at(col, 1), fraction = await this.tag(spec) === "ColWidth" ? await this.number((await this.tree.property(spec, "c"))!) : 1 / width;
        await this.put(columns + index * 16, col); await this.put(columns + index * 16 + 8, fraction); total += fraction; index++; await this.context.cooperate();
      }
      if (!width || !Number.isFinite(total) || total <= 0) this.fail("Invalid RTF table widths");
      for (let i = 0; i < width; i++) await this.put(columns + i * 16 + 8, await this.pointer(columns + i * 16 + 8) / total * 8640);
      const bodies = await this.at(job.node, 4);
      for await (const body of this.tree.children(bodies)) if (await this.number(await this.at(body, 1))) this.fail("RTF row headers unsupported");
      const extra = {columns, width, state: job.state!};
      await this.sequence(this.list(await this.at(await this.at(job.node, 3), 1), 0, "row", extra), this.list(bodies, 0, "body", extra), this.list(await this.at(await this.at(job.node, 5), 1), 0, "row", extra)); return;
    }
    if (job.op === "body") {
      const extra = {columns: job.columns!, width: job.width!, state: job.state!};
      await this.sequence(this.list(await this.at(job.node, 2), 0, "row", extra), this.list(await this.at(job.node, 3), 0, "row", extra)); return;
    }
    if (job.op === "row") {
      const cells = await this.at(job.node, 1);
      if (await this.present(job.node + 32) || await this.count(cells) !== job.width) this.fail("Unsupported RTF table row");
      await this.add("{\\trowd"); let width = 0, previous = 0;
      for (let i = 0; i < job.width!; i++) {
        width += await this.pointer(job.columns! + i * 16 + 8); const end = Math.round(width);
        if (end <= previous || !Number.isSafeInteger(end)) this.fail("RTF column width too small");
        await this.add("\\cellx" + end); previous = end;
      }
      await this.add("\\intbl ");
      await this.sequence(this.list(cells, 0, "cell", {columns: job.columns!, state: job.state!}), this.literal("\\row}\n")); return;
    }
    if (job.op === "cell") {
      if (await this.number(await this.at(job.node, 2)) !== 1 || await this.number(await this.at(job.node, 3)) !== 1 || await this.present(job.node + 32)) this.fail("RTF merged or attributed cells unsupported");
      const col = await this.pointer(job.columns! + job.index! * 16), align = await this.tag(await this.at(job.node, 1)), blocks = await this.at(job.node, 4);
      const state = {...job.state!, indent: 0, cell: align === "AlignDefault" ? await this.tag(col + 32) : align};
      await this.push(this.literal("\\cell "));
      if (await this.count(blocks)) await this.push(this.list(blocks, 0, "block", {state}));
      else {await this.paragraph(state); await this.add("\\par}\n");}
      return;
    }
    throw new Error("Unknown retained RTF job " + job.op);
  }
}

export async function writeRetainedRtf(tree: BackedJson, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions, order: Awaited<ReturnType<typeof backedJsonOrder>>, image: (node: number) => Promise<RetainedRtfImage>): Promise<void> {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close()); let failure: {reason: unknown} | undefined;
  try {
    const writer = new RtfTape(tree, storage, context, options, order, image), result = await writer.render();
    const diagnostics = context.snapshotDiagnostics();
    if (options.failIfWarnings && diagnostics.length) {const first = diagnostics[0]!; throw new PandocError("E_WARNINGS", "convert", `Warnings rejected: ${first.code}: ${first.message}`, first.format, first.location);}
    const chunks = async function* () {
      const encoder = new TextEncoder();
      for await (const part of writer.text.unicodeChunks(result)) yield encoder.encode(options.eol === "crlf" ? part.split("\n").join("\r\n") : part);
    };
    if (Number.isFinite(context.limits.outputBytes)) {let length = 0; for await (const bytes of chunks()) {length += bytes.length; context.bound("outputBytes", length);}}
    for await (const bytes of chunks()) await context.emit(bytes);
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};} finally {release();}
  if (failure) throw failure.reason;
}
