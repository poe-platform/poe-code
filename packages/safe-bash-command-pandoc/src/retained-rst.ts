import {wireEnums} from "./retained-ast-budgets.js";
import {emitRetainedOutput, reserveRetainedOutput} from "./retained-output-budgets.js";
import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {readJsonNumber} from "./json-number.js";
import {rstColumnWidth} from "./rst-column-width.js";
import {listMarker} from "./rst-syntax.js";
import {PandocError} from "./errors.js";

type Job = {op: string; node: number; path: number; mode?: string | undefined; stage?: number | undefined; cursor?: number | undefined;
  end?: number | undefined; index?: number | undefined; text?: TextRange | undefined; saved?: TextRange | undefined;
  parts?: Job[] | undefined; sep?: string | undefined; previous?: string | undefined; next?: string | undefined; tag?: string | undefined;
  nested?: boolean | undefined; literal?: boolean | undefined; markup?: boolean | undefined; first?: string | undefined; last?: string | undefined;
  count?: number | undefined; start?: number | undefined; width?: number | undefined; parentPath?: number | undefined};

/** Explicit writer continuations, names, notes and output all use caller pages. */
class RstTape {
  readonly text: BackedText;
  private top = 0;
  private source = emptyText();
  private readonly used: BackedTextSet;
  private readonly targets: BackedTextSet;
  private readonly keys: BackedTextSet;
  private readonly labels: IntegerTable;
  private readonly counts: IntegerTable;
  private serial = 0;
  private strikeout = false;
  private definitions = emptyText();
  private firstNote = 0;
  private lastNote = 0;
  private noteCount = 0;
  constructor(private readonly tree: BackedJson, private readonly storage: PagedStorage, private readonly context: ExecutionContext, private readonly options: ConversionOptions) {
    this.text = new BackedText(storage, units => context.cooperate(units));
    this.used = new BackedTextSet(storage, this.text); this.targets = new BackedTextSet(storage, this.text); this.keys = new BackedTextSet(storage, this.text);
    this.labels = new IntegerTable(storage, 64); this.counts = new IntegerTable(storage, 64);
  }
  private async record(value: unknown): Promise<number> {
    const payload = new TextEncoder().encode(JSON.stringify(value)), bytes = new Uint8Array(8 + payload.length);
    new DataView(bytes.buffer).setFloat64(0, payload.length, true); bytes.set(payload, 8); return this.storage.append(bytes);
  }
  private async read<T>(position: number): Promise<T> {
    const bytes = await this.storage.read(position, 8), length = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
    return JSON.parse(new TextDecoder().decode(await this.storage.read(position + 8, length))) as T;
  }
  private async push(job: Job): Promise<void> {this.top = await this.record({parent: this.top, job});}
  private async path(parent: number, suffix: string): Promise<number> {return this.record({parent, suffix});}
  private async location(path: number): Promise<string> {
    let text = ""; while (path) {const part = await this.read<{parent: number; suffix: string}>(path); text = part.suffix + text; path = part.parent; await this.context.cooperate();} return text;
  }
  private async fail(message: string, path: number): Promise<never> {throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", message, "rst", await this.location(path));}
  private async loss(message: string, path: number): Promise<void> {
    if (!this.options.lossy) await this.fail(message, path);
    this.context.report({code: "W_TABLE_LOSS", operation: "convert", format: "rst", location: await this.location(path), message});
  }
  private async at(node: number, index: number): Promise<number> {let child = node + 32; for (let i = 0; i < index; i++) child = (await this.tree.describe(child)).end; return child;}
  private async count(node: number): Promise<number> {return (await this.tree.describe(node)).children;}
  private async number(node: number): Promise<number> {return readJsonNumber(this.tree.scalarChunks(node), units => this.context.cooperate(units));}
  private async tag(node: number): Promise<string> {return (await this.tree.smallText((await this.tree.property(node, "t"))!, 32))!;}
  private async scalar(node: number): Promise<TextRange> {return this.text.from(this.tree.scalarChunks(node));}
  private async literal(value: string): Promise<TextRange> {return this.text.from([value]);}
  private async join(...values: TextRange[]): Promise<TextRange> {const output = emptyText(); for (const value of values) await this.text.append(output, value); return output;}
  private async copy(value: TextRange): Promise<TextRange> {return this.text.from(this.text.chunks(value));}
  private async edges(value: TextRange): Promise<{first: string; last: string}> {
    let first = "", last = ""; for await (const chunk of this.text.unicodeChunks(value)) {first ||= [...chunk.slice(0, 2)][0] ?? ""; last = chunk.slice(-1);} return {first, last};
  }
  private async attrsPresent(node: number): Promise<boolean> {return (await this.tree.describe(node + 32)).end > node + 64 || !!await this.count(await this.at(node, 1)) || !!await this.count(await this.at(node, 2));}
  private async escape(value: TextRange, path: number, literal = false): Promise<TextRange> {
    const output = emptyText(); let buffer = "";
    for await (const chunk of this.text.chunks(value)) for (const char of chunk) {
      if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) await this.fail("Control character in inline text", path);
      buffer += !literal && "\\`*_|<>[]".includes(char) ? `\\${char}` : char;
      if (buffer.length >= 4096) {await this.text.append(output, await this.literal(buffer)); buffer = "";}
    }
    if (buffer) await this.text.append(output, await this.literal(buffer));
    if (Number.isFinite(this.context.limits.references) || Number.isFinite(this.context.limits.retainedBytes)) {this.context.bound("outputBytes", output.units); if (Number.isFinite(this.context.limits.retainedBytes)) this.context.charge("retainedBytes", output.units * 2);}
    return output;
  }
  private async unique(base: TextRange): Promise<TextRange> {
    let name = base, count = 1;
    while (await this.used.has(name) || await this.text.includes(this.source, name)) {
      name = await this.join(await this.copy(base), await this.literal(`-ref-${++count}`)); await this.context.cooperate();
    }
    if (Number.isFinite(this.context.limits.references)) this.context.charge("references", 1);
    if (Number.isFinite(this.context.limits.retainedBytes)) this.context.charge("retainedBytes", name.units * 2);
    await this.used.add(name); return name;
  }
  private async id(source: TextRange): Promise<TextRange> {
    const identity = BigInt(await this.keys.add(source)), existing = Number(await this.labels.get(identity) ?? 0n);
    if (existing) return this.read<TextRange>(existing);
    const base = await this.literal("pc-id-"); let first = true, buffer = "";
    for await (const chunk of this.text.unicodeChunks(source)) for (const char of chunk) {
      buffer += (first ? "" : "-") + char.codePointAt(0)!.toString(16); first = false;
      if (buffer.length >= 4096) {await this.text.append(base, await this.literal(buffer)); buffer = "";}
    }
    if (buffer) await this.text.append(base, await this.literal(buffer));
    const name = await this.unique(base); await this.labels.set(identity, BigInt(await this.record(name))); return name;
  }
  private async attrs(node: number, path: number, language = false, container = false): Promise<TextRange> {
    const classes = await this.count(await this.at(node, 1));
    if (classes && !language && !container || await this.count(await this.at(node, 2)) || language && classes > 1) await this.loss("Dropped unsupported RST attributes", path);
    const source = await this.scalar(node + 32); if (!source.units) return emptyText();
    const identity = BigInt(await this.keys.add(source)), count = Number(await this.counts.get(identity) ?? 0n) + 1; await this.counts.set(identity, BigInt(count));
    const base = await this.id(source), label = count > 1 ? await this.unique(await this.join(await this.copy(base), await this.literal(`-dup-${count}`))) : base;
    return this.join(await this.literal(".. _"), await this.copy(label), await this.literal(":\n\n"));
  }
  private async reference(kind: string): Promise<TextRange> {
    let name: TextRange;
    do {name = await this.literal(`pc-${kind}-${++this.serial}`); await this.context.cooperate();} while (await this.text.includes(this.source, name) || await this.used.has(name));
    return this.unique(name);
  }
  private async safeTarget(value: TextRange, path: number): Promise<TextRange> {
    const edges = await this.edges(value);
    if (!value.units || !edges.first.trim() || !edges.last.trim()) await this.fail("Unsupported RST target syntax", path);
    for await (const chunk of this.text.chunks(value)) for (const char of chunk) if (char.charCodeAt(0) <= 32 || "`<>\\".includes(char)) await this.fail("Unsupported RST target syntax", path);
    return value;
  }
  private async definition(value: TextRange): Promise<void> {if (this.definitions.units) await this.text.append(this.definitions, await this.literal("\n\n")); await this.text.append(this.definitions, value);}
  private async note(node: number, path: number): Promise<number> {
    const position = this.storage.allocate(24), bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
    view.setFloat64(8, node, true); view.setFloat64(16, path, true); await this.storage.write(position, bytes);
    if (this.lastNote) {const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true); await this.storage.write(this.lastNote, link);} else this.firstNote = position;
    this.lastNote = position; return ++this.noteCount;
  }
  private async repeat(char: string, count: number): Promise<TextRange> {return this.text.from((async function* () {while (count) {const size = Math.min(4096, count); yield char.repeat(size); count -= size;}})());}
  private async continued(body: TextRange, width: number): Promise<TextRange> {
    const indented = await this.text.indent(body, " ".repeat(width), " ".repeat(width)), source = this.text.chunks(indented);
    return this.text.from((async function* () {
      let skip = width;
      for await (const chunk of source) {const count = Math.min(skip, chunk.length); skip -= count; yield chunk.slice(count);}
    })());
  }
  private async marked(marker: string, body: TextRange): Promise<TextRange> {
    if ((await this.edges(body)).first === " ") return this.join(await this.literal(marker.trimEnd() + "\n\n"), await this.text.indent(await this.join(await this.literal("..\n\n"), body), " ".repeat(marker.length), " ".repeat(marker.length)));
    return this.join(await this.literal(marker), await this.continued(body, marker.length));
  }
  private async paragraph(value: TextRange): Promise<TextRange> {
    let prefix = "", last = "", first = "", allAdornment = true, trailingWhitespace = false, fieldEnd = -1, afterField = "", index = 0;
    for await (const chunk of this.text.unicodeChunks(value)) for (const char of chunk) {
      if (prefix.length < 35) prefix += char;
      first ||= char;
      if (char.trimEnd() === "") trailingWhitespace = true;
      else {if (trailingWhitespace || char !== first) allAdornment = false; trailingWhitespace = false;}
      if (first === ":" && index > 0 && fieldEnd < 0 && char === ":") fieldEnd = index;
      else if (fieldEnd >= 0 && index === fieldEnd + 1) afterField = char;
      last = (last + char).slice(-2); index += char.length;
    }
    const structural = listMarker(prefix) || fieldEnd > 1 && (!afterField || afterField === " ") || value.units && allAdornment && "=!\"#$%&'()*+,-./:;<>?@[\\]^_`{|}~".includes(first) || prefix.startsWith("+-") && last.endsWith("+") || value.units === 2 && prefix === ".." || prefix.startsWith(".. ");
    if (structural) value = await this.join(await this.literal("\\"), value);
    if (last === "::") {
      const source = this.text.chunks(value);
      value = await this.text.from((async function* () {let pending = ""; for await (const chunk of source) {const text = pending + chunk; yield text.slice(0, -1); pending = text.slice(-1);} yield "\\:";})());
    }
    return value;
  }
  private list(node: number, path: number, mode: string, extra: Partial<Job> = {}): Job {return {op: "list", node, path, mode, ...extra};}
  private async task(node: number): Promise<boolean | undefined> {
    const attr = node + 32;
    if (await this.count(await this.at(node, 1)) || (await this.tree.describe(attr + 32)).end > attr + 64) return undefined;
    const classes = await this.at(attr, 1), pairs = await this.at(attr, 2);
    if (await this.count(classes) !== 1 || await this.tree.smallText(classes + 32, 16) !== "task-list-marker" || await this.count(pairs) !== 1 || await this.tree.smallText(pairs + 64, 7) !== "checked") return undefined;
    const state = await this.tree.smallText(await this.at(pairs + 32, 1), 5); return state === "true" ? true : state === "false" ? false : undefined;
  }
  private async reserve(blocks: number): Promise<void> {
    // Reproduce the writer's string projection using stored sibling continuations.
    await this.push({op: "reserve", node: blocks, path: 0});
    while (this.top) {
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent; const job = frame.job;
      await this.context.cooperate();
      if (job.op === "reserveFinish") {
        this.context.bound("outputBytes", this.source.units - job.start!);
        if (Number.isFinite(this.context.limits.retainedBytes)) this.context.charge("retainedBytes", (this.source.units - job.start!) * 2); continue;
      }
      if (job.op === "reserveNext") {
        if (job.node < job.end!) {await this.push({...job, node: (await this.tree.describe(job.node)).end}); await this.push({op: "reserve", node: job.node, path: 0});} continue;
      }
      const header = await this.tree.describe(job.node);
      if (header.kind === "string") {await this.text.append(this.source, await this.scalar(job.node)); continue;}
      if (header.kind === "object") {
        const tagPosition = await this.tree.property(job.node, "t"), tag = tagPosition === undefined ? undefined : await this.tree.smallText(tagPosition, 16);
        if (tag && ["Space", "SoftBreak", "LineBreak"].includes(tag)) {await this.text.append(this.source, await this.literal(" ")); continue;}
        if (tag && wireEnums.has(tag)) {await this.text.append(this.source, await this.scalar(tagPosition!)); continue;}
        const content = await this.tree.property(job.node, "c");
        if (content !== undefined) {
          if (tag && ["Header", "CodeBlock", "Div"].includes(tag)) {
            const attr = tag === "Header" ? await this.at(content, 1) : content + 32, id = await this.scalar(attr + 32);
            if (id.units) await this.targets.add(id);
          }
          await this.push({op: "reserve", node: content, path: 0}); continue;
        }
      }
      if (header.kind === "object" || header.kind === "array") {
        if (Number.isFinite(this.context.limits.references) || Number.isFinite(this.context.limits.retainedBytes)) await this.push({op: "reserveFinish", node: 0, path: 0, start: this.source.units});
        await this.push({op: "reserveNext", node: job.node + 32, path: 0, end: header.end});
      }
    }
    this.source = await this.text.lower(this.source);
  }
  async render(): Promise<TextRange> {
    const blocks = (await this.tree.property(this.tree.rootPosition, "blocks"))!;
    await this.reserve(blocks);
    await this.push(this.list(blocks, await this.path(0, "$.blocks"), "block", {sep: "\n\n"}));
    let result = emptyText(), markup = false, body = emptyText(), note = 0, noteIndex = 0, notesStarted = false;
    while (this.top || !notesStarted || note) {
      if (!this.top) {
        if (!notesStarted) {body = result; note = this.firstNote; notesStarted = true;}
        if (!note) break;
        const bytes = await this.storage.read(note, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        const node = view.getFloat64(8, true), path = view.getFloat64(16, true);
        await this.push({op: "finishNote", node: note, path, index: ++noteIndex}); await this.push(this.list(node, path, "block", {sep: "\n\n"}));
      }
      await this.context.cooperate();
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent; const job = frame.job;
      const part = async (index: number, op: string): Promise<Job> => ({op, node: await this.at(job.node, index), path: await this.path(job.path, `[${index}]`)});
      if (job.op === "finishNote") {
        if (!result.units) await this.fail("Empty note", job.path);
        await this.definition(await this.marked(`.. [${job.index}] `, result));
        const bytes = await this.storage.read(job.node, 8); note = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true); continue;
      }
      if (job.op === "empty") {result = emptyText(); markup = false; continue;}
      if (job.op === "list" || job.op === "parts") {
        if (!job.stage) {job.text = emptyText(); job.index = 0; job.cursor = job.node + 32; job.end = job.op === "parts" ? 0 : (await this.tree.describe(job.node)).end;}
        else {
          let separator = job.index ? job.sep ?? "" : "";
          if (job.mode === "inline") {
            const edges = await this.edges(result);
            separator = job.index && (job.markup || markup) && job.last && edges.first && job.last !== " " && edges.first !== " " ? "\\ " : "";
            job.last = edges.last; job.markup = markup;
          }
          if (job.mode === "block" && job.index) {
            const lists = ["BulletList", "OrderedList"], previous = job.previous!, current = job.next!;
            if (lists.includes(previous) && (lists.includes(current) || current === "BlockQuote") || previous === "DefinitionList" && current === "BlockQuote" || previous === current && ["BlockQuote", "DefinitionList"].includes(current)) separator = "\n\n..\n\n";
          }
          await this.text.append(job.text!, await this.literal(separator)); await this.text.append(job.text!, result); job.index!++; job.previous = job.next;
        }
        let child: Job | undefined;
        if (job.op === "parts") child = job.parts![job.index!];
        else if (job.cursor! < job.end!) {
          const node = job.cursor!, after = (await this.tree.describe(node)).end;
          child = {op: job.mode!, node, path: await this.path(job.path, `[${job.index}]`), index: job.index, nested: job.nested, literal: job.literal, start: job.start, parentPath: job.parentPath}; job.cursor = after;
          if (job.mode === "block") {child.previous = job.previous; child.next = after < job.end! ? await this.tag(after) : ""; job.next = await this.tag(node);}
        }
        if (child) {await this.push({...job, stage: 1}); await this.push(child);} else {
          result = job.text!; markup = false;
          if ((Number.isFinite(this.context.limits.references) || Number.isFinite(this.context.limits.retainedBytes)) && (job.mode === "inline" || job.mode === "block")) {this.context.bound("outputBytes", result.units); if (Number.isFinite(this.context.limits.retainedBytes)) this.context.charge("retainedBytes", result.units * 2);}
        }
        continue;
      }
      if (job.op === "post") {
        if (job.mode === "surround") result = await this.join(await this.literal(job.first!), result, await this.literal(job.last!));
        if (job.mode === "structural" && !result.units && !["Plain", "Para", "Div", "Figure"].includes(job.tag!)) await this.fail("Empty RST structural container", job.path);
        if (job.mode === "structural" && (Number.isFinite(this.context.limits.references) || Number.isFinite(this.context.limits.retainedBytes))) {this.context.bound("outputBytes", result.units); if (Number.isFinite(this.context.limits.retainedBytes)) this.context.charge("retainedBytes", result.units * 2);}
        if (job.mode === "paragraph") result = await this.paragraph(result);
        if (job.mode === "style") {
          if (job.nested) await this.loss("Nested RST inline style projected to text", job.path);
          else {
            const edges = await this.edges(result); if (!result.units || !edges.first.trim() || !edges.last.trim()) await this.fail("Empty or whitespace-bounded inline style", job.path);
            if (job.tag === "Strikeout") this.strikeout = true;
            result = await this.join(await this.literal(job.first!), result, await this.literal(job.last!));
          }
        }
        if (job.markup !== undefined) markup = job.markup; continue;
      }
      if (job.op === "inline" || job.op === "block") {
        const tag = await this.tag(job.node), content = await this.tree.property(job.node, "c"), cp = await this.path(job.path, ".c");
        const child = async (index: number, mode: string, extra: Partial<Job> = {}): Promise<Job> => this.list(await this.at(content!, index), await this.path(cp, `[${index}]`), mode, extra);
        if (job.op === "block") await this.push({op: "post", node: 0, path: job.path, mode: "structural", tag});
        markup = false;
        if (tag === "Str") {result = await this.escape(await this.scalar(content!), job.path, job.literal); continue;}
        if (["Space", "SoftBreak", "LineBreak"].includes(tag)) {if (tag === "LineBreak") await this.loss("Inline line break projected to space; use LineBlock", job.path); result = await this.literal(" "); continue;}
        if (["Emph", "Strong", "Superscript", "Subscript", "Strikeout"].includes(tag)) {
          const first = tag === "Emph" ? "*" : tag === "Strong" ? "**" : tag === "Strikeout" ? ":strikeout:`" : tag === "Superscript" ? ":sup:`" : ":sub:`";
          await this.push({op: "post", node: 0, path: job.path, mode: "style", tag, nested: job.nested, first, last: tag === "Emph" ? "*" : tag === "Strong" ? "**" : "`", markup: !job.nested});
          await this.push(this.list(content!, cp, "inline", {nested: true, literal: job.literal})); continue;
        }
        if (tag === "Underline" || tag === "SmallCaps") {await this.loss(`Projected unsupported ${tag} to text`, job.path); await this.push(this.list(content!, cp, "inline", {nested: true, literal: job.literal})); continue;}
        if (tag === "Quoted") {
          const single = await this.tag(content! + 32) === "SingleQuote";
          await this.push({op: "post", node: 0, path: job.path, mode: "surround", first: single ? "‘" : "“", last: single ? "’" : "”", markup: false}); await this.push(await child(1, "inline", {nested: job.nested, literal: job.literal})); continue;
        }
        if (tag === "Span" || tag === "Cite") {
          const state = tag === "Span" ? await this.task(content!) : undefined;
          if (state !== undefined) result = await this.literal(state ? "☒ " : "☐ ");
          else {await this.loss(tag === "Span" ? "Projected unsupported Span to text" : "Projected citation to displayed text", job.path); await this.push(await child(1, "inline", {nested: job.nested, literal: job.literal}));} continue;
        }
        if (tag === "Code") {
          if (await this.attrsPresent(content! + 32)) await this.loss("Dropped inline code attributes", job.path);
          const value = await this.scalar(await this.at(content!, 1));
          if (job.nested) {await this.loss("Nested inline code projected to text", job.path); result = await this.escape(value, job.path, job.literal);}
          else {const edges = await this.edges(value); if (!value.units || !edges.first.trim() || !edges.last.trim() || edges.first === "`" || edges.last === "`" || await this.text.includes(value, await this.literal("``")) || await this.text.includes(value, await this.literal("\n"))) await this.fail("Unrepresentable inline literal", job.path); result = await this.join(await this.literal("``"), value, await this.literal("``")); markup = true;} continue;
        }
        if (tag === "Math" || tag === "RawInline") {await this.loss(tag === "Math" ? "Math projected to literal source (no math extension)" : "Raw inline projected to escaped text", job.path); result = await this.escape(await this.scalar(await this.at(content!, 1)), job.path, job.literal); continue;}
        if (tag === "Link" || tag === "Image") {
          if (job.nested && tag === "Image") await this.fail("Image nested in inline markup", job.path);
          if (job.nested) {await this.loss("Nested link projected to displayed text", job.path); await this.push(await child(1, "inline", {nested: true, literal: job.literal})); continue;}
          const target = await this.at(content!, 2);
          if (await this.attrsPresent(content! + 32) || (await this.tree.describe(await this.at(target, 1))).end > await this.at(target, 1) + 32) await this.loss(`Dropped ${tag === "Link" ? "link" : "image"} attributes/title`, job.path);
          await this.push({op: "target", node: target + 32, path: job.path, tag}); await this.push(await child(1, "inline", {nested: true, literal: tag === "Image"})); continue;
        }
        if (tag === "Note") {if (job.nested) await this.fail("Note nested in inline markup", job.path); result = await this.literal(`[${await this.note(content!, cp)}]_`); markup = true; continue;}
        if (tag === "Plain" || tag === "Para") {await this.push({op: "post", node: 0, path: job.path, mode: "paragraph"}); await this.push(this.list(content!, cp, "inline")); continue;}
        if (tag === "Header") {
          if (await this.number(content! + 32) > 9) await this.loss("Heading level projected to level nine", job.path);
          await this.push({op: "heading", node: content!, path: job.path}); await this.push(await child(2, "inline")); continue;
        }
        if (tag === "CodeBlock" || tag === "RawBlock") {
          const value = await this.scalar(await this.at(content!, 1)); let prefix = emptyText(), language = emptyText();
          if (tag === "RawBlock") await this.loss("Raw block projected to literal code", job.path);
          else {
            const attr = content! + 32, classes = await this.at(attr, 1);
            if (await this.count(classes)) language = await this.scalar(classes + 32);
            for await (const chunk of this.text.chunks(language)) for (const char of chunk) if (!"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-+".includes(char)) await this.fail("Unsupported code language", job.path);
            if (!value.units) await this.fail("Empty code block", job.path);
            prefix = await this.attrs(attr, job.path, true);
          }
          result = await this.join(prefix, language.units ? await this.join(await this.literal(".. code:: "), language) : await this.literal("::"), await this.literal("\n\n"), await this.text.indent(value, "   ", "   ")); continue;
        }
        if (tag === "HorizontalRule") {if (job.index === 0 || !job.next || job.previous === "Header" || job.previous === "HorizontalRule" || job.next === "HorizontalRule") await this.fail("RST transition requires content on both sides", job.path); result = await this.literal("----"); continue;}
        if (tag === "BlockQuote" || tag === "Div") {
          if (tag === "Div") {
            const classes = await this.at(content! + 32, 1);
            for await (const node of this.tree.children(classes)) {if ((await this.tree.describe(node)).end === node + 32) await this.fail("Unsupported RST container class", job.path); for await (const chunk of this.tree.scalarChunks(node)) for (const char of chunk) if (!"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".includes(char)) await this.fail("Unsupported RST container class", job.path);}
          }
          await this.push({op: tag === "Div" ? "container" : "quote", node: content!, path: job.path});
          await this.push(tag === "Div" ? await child(1, "block", {sep: "\n\n"}) : this.list(content!, cp, "block", {sep: "\n\n"})); continue;
        }
        if (tag === "Figure") {
          await this.loss("Figure projected to content and caption", job.path);
          const caption = await this.at(content!, 1), short = caption + 32;
          const parts: Job[] = [await child(2, "block", {sep: "\n\n"}), this.list(await this.at(caption, 1), await this.path(cp, "[1][1]"), "block", {sep: "\n\n"})];
          if (await this.count(short)) parts.push(this.list(short, job.path, "inline"));
          await this.push({op: "parts", node: 0, path: cp, parts, sep: "\n\n"}); continue;
        }
        if (tag === "LineBlock") {await this.push(this.list(content!, cp, "line", {sep: "\n"})); continue;}
        if (tag === "BulletList" || tag === "OrderedList") {
          const ordered = tag === "OrderedList", spec = content! + 32;
          if (ordered && (!["Decimal", "DefaultStyle"].includes(await this.tag(await this.at(spec, 1))) || !["Period", "DefaultDelim"].includes(await this.tag(await this.at(spec, 2))))) await this.loss("List style projected to decimal period", job.path);
          await this.push(this.list(ordered ? await this.at(content!, 1) : content!, ordered ? await this.path(cp, "[1]") : cp, "item", {sep: "\n\n", start: ordered ? await this.number(spec + 32) : undefined, parentPath: job.path})); continue;
        }
        if (tag === "DefinitionList") {await this.push(this.list(content!, cp, "definition", {sep: "\n\n", parentPath: job.path})); continue;}
        if (tag === "Table") {await this.push({op: "table", node: content!, path: job.path}); continue;}
        throw new Error(`Unknown RST constructor ${tag}`);
      }
      if (job.op === "target") {
        const edges = await this.edges(result);
        if (job.tag === "Link" && (!result.units || !edges.first.trim() || !edges.last.trim())) await this.fail("Empty or whitespace-bounded link", job.path);
        const name = await this.reference(job.tag === "Link" ? "link" : "image"); let target = await this.scalar(job.node);
        if (job.tag === "Link") {
          if ((await this.edges(target)).first === "#") {
            const source = this.text.chunks(target); target = await this.text.from((async function* () {let first = true; for await (const chunk of source) {yield first ? chunk.slice(1) : chunk; first = false;}})());
            if (!await this.targets.has(target)) await this.fail("Unresolved internal reference", job.path);
            target = await this.join(await this.copy(await this.id(target)), await this.literal("_"));
          } else target = await this.safeTarget(target, job.path);
          await this.definition(await this.join(await this.literal(".. _"), await this.copy(name), await this.literal(": "), target));
          result = await this.join(await this.literal("`"), result, await this.literal(" <"), await this.copy(name), await this.literal("_>`_"));
        } else {
          await this.definition(await this.join(await this.literal(".. |"), await this.copy(name), await this.literal("| image:: "), await this.safeTarget(target, job.path), result.units ? await this.join(await this.literal("\n   :alt: "), result) : emptyText()));
          result = await this.join(await this.literal("|"), await this.copy(name), await this.literal("|"));
        }
        markup = true; continue;
      }
      if (job.op === "heading") {
        if (!result.units) await this.fail("Empty heading", job.path);
        let width = 0; for await (const chunk of this.text.unicodeChunks(result)) width += rstColumnWidth(chunk);
        result = await this.join(await this.attrs(await this.at(job.node, 1), job.path), result, await this.literal("\n"), await this.repeat("=-~^\"'+:#"[Math.min(await this.number(job.node + 32), 9) - 1]!, width)); continue;
      }
      if (job.op === "quote") {if (!result.units) await this.fail("Empty block quote", job.path); if ((await this.edges(result)).first === " ") result = await this.join(await this.literal("..\n\n"), result); result = await this.text.indent(result, "   ", "   "); continue;}
      if (job.op === "container") {
        const classes = await this.at(job.node + 32, 1), names = emptyText();
        for await (const node of this.tree.children(classes)) {await this.text.append(names, await this.literal(" ")); await this.text.append(names, await this.scalar(node));}
        result = await this.join(await this.attrs(job.node + 32, job.path, false, true), await this.literal(".. container::"), names, await this.literal("\n\n"), await this.text.indent(result, "   ", "   ")); continue;
      }
      if (job.op === "line") {await this.push({op: "post", node: 0, path: job.path, mode: "surround", first: "| ", last: ""}); await this.push(this.list(job.node, job.path, "inline")); continue;}
      if (job.op === "item") {
        if (!job.stage) {await this.push({...job, stage: 1}); await this.push(this.list(job.node, job.path, "block", {sep: "\n\n"}));}
        else {
          if (!result.units) await this.fail("Empty list item", job.parentPath!);
          const marker = job.start === undefined ? "* " : `${job.start + job.index!}. `, first = await this.count(job.node) ? await this.tag(job.node + 32) : "";
          result = ["Para", "Plain"].includes(first) ? await this.join(await this.literal(marker), await this.continued(result, marker.length)) : await this.join(await this.literal(marker.trimEnd() + "\n\n"), await this.text.indent(result, " ".repeat(marker.length), " ".repeat(marker.length)));
        }
        continue;
      }
      if (job.op === "definition") {
        if (!job.stage) {await this.push({...job, stage: 1}); const term = await part(0, "inline"); await this.push(this.list(term.node, term.path, "inline"));}
        else if (job.stage === 1) {await this.push({...job, stage: 2, saved: result}); const defs = await part(1, "definitionBodies"); await this.push(this.list(defs.node, defs.path, "definitionBody", {sep: "\n\n"}));}
        else {
          if (!job.saved!.units || !result.units) await this.fail("Empty definition", job.parentPath!);
          if (await this.count(await this.at(job.node, 1)) > 1) await this.loss("Multiple definitions merged into one body", job.parentPath!);
          if ((await this.edges(result)).first === " ") result = await this.join(await this.literal("..\n\n"), result);
          result = await this.join(job.saved!, await this.literal("\n"), await this.text.indent(result, "   ", "   "));
        }
        continue;
      }
      if (job.op === "definitionBody") {await this.push(this.list(job.node, job.path, "block", {sep: "\n\n"})); continue;}
      result = await this.table(job, result);
    }
    const output = this.strikeout ? await this.literal(".. role:: strikeout") : emptyText();
    for (const value of [body, this.definitions]) if (value.units) {if (output.units) await this.text.append(output, await this.literal("\n\n")); await this.text.append(output, value);}
    if (body.units || this.definitions.units) await this.text.append(output, await this.literal("\n"));
    if (Number.isFinite(this.context.limits.references) || Number.isFinite(this.context.limits.retainedBytes)) {this.context.bound("outputBytes", output.units); if (Number.isFinite(this.context.limits.retainedBytes)) this.context.charge("retainedBytes", output.units * 2);}
    return output;
  }

  private async table(job: Job, result: TextRange): Promise<TextRange> {
    if (job.op === "table") {
      const caption = await this.at(job.node, 1), cols = await this.at(job.node, 2), head = await this.at(job.node, 3), bodies = await this.at(job.node, 4), foot = await this.at(job.node, 5);
      if (await this.attrsPresent(job.node + 32) || await this.count(caption + 32) || await this.count(await this.at(caption, 1))) await this.loss("Dropped table attributes/caption", job.path);
      for await (const col of this.tree.children(cols)) if (await this.tag(col + 32) !== "AlignDefault" || await this.tag(await this.at(col, 1)) !== "ColWidthDefault") await this.loss("Dropped table alignment/width", job.path);
      const headers = await this.count(await this.at(head, 1));
      if (headers > 1) await this.fail("List-table supports one header row", job.path);
      if (await this.attrsPresent(head + 32)) await this.loss("Dropped table section attributes", job.path);
      for await (const body of this.tree.children(bodies)) if (await this.attrsPresent(body + 32)) await this.loss("Dropped table section attributes", job.path);
      if (await this.attrsPresent(foot + 32)) await this.loss("Dropped table section attributes", job.path);
      for await (const body of this.tree.children(bodies)) if (await this.number(await this.at(body, 1)) || await this.count(await this.at(body, 2))) await this.loss("Dropped body header semantics", job.path);
      let first = 0, last = 0;
      const rows = async (node: number) => {
        for await (const row of this.tree.children(node)) {
          const pos = this.storage.allocate(16), bytes = new Uint8Array(16); new DataView(bytes.buffer).setFloat64(8, row, true); await this.storage.write(pos, bytes);
          if (last) {const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, pos, true); await this.storage.write(last, link);} else first = pos;
          last = pos; await this.context.cooperate();
        }
      };
      await rows(await this.at(head, 1));
      for await (const body of this.tree.children(bodies)) {await rows(await this.at(body, 2)); await rows(await this.at(body, 3));}
      await rows(await this.at(foot, 1));
      await this.push({...job, op: "tableRows", cursor: first, index: 0, width: await this.count(cols), text: await this.literal(`.. list-table::\n   :header-rows: ${headers}\n\n`)});
      return result;
    }
    if (job.op === "tableRows") {
      if (job.stage) {if (job.index) await this.text.append(job.text!, await this.literal("\n")); await this.text.append(job.text!, result); job.index!++;}
      if (!job.cursor) {
        if (!job.index || !job.width) await this.fail("Empty table", job.path);
        return job.text!;
      }
      const bytes = await this.storage.read(job.cursor, 16), view = new DataView(bytes.buffer, bytes.byteOffset, 16), row = view.getFloat64(8, true), cells = await this.at(row, 1);
      if (await this.attrsPresent(row + 32)) await this.loss("Dropped row attributes", job.path);
      if (await this.count(cells) !== job.width) await this.fail("Incomplete or spanning table row", job.path);
      await this.push({...job, stage: 1, cursor: view.getFloat64(0, true)});
      await this.push(this.list(cells, await this.path(job.path, `.c.rows[${job.index}]`), "tableCell", {sep: "\n", parentPath: job.path}));
      return result;
    }
    if (job.op === "tableCell") {
      if (job.stage) return this.marked(job.index ? "     - " : "   * - ", result);
      if (await this.number(await this.at(job.node, 2)) !== 1 || await this.number(await this.at(job.node, 3)) !== 1) await this.fail("Table spans unsupported", job.parentPath!);
      if (await this.attrsPresent(job.node + 32) || await this.tag(await this.at(job.node, 1)) !== "AlignDefault") await this.loss("Dropped cell attributes/alignment", job.parentPath!);
      await this.push({...job, stage: 1}); await this.push(this.list(await this.at(job.node, 4), job.path, "block", {sep: "\n\n"})); return result;
    }
    throw new Error(`Unknown retained RST job: ${job.op}`);
  }
}

export async function writeRetainedRst(tree: BackedJson, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions): Promise<void> {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close()); let failure: {reason: unknown} | undefined;
  try {
    const writer = new RstTape(tree, storage, context, options), result = await writer.render();
    const diagnostics = context.snapshotDiagnostics();
    if (options.failIfWarnings && diagnostics.length) {const first = diagnostics[0]!; throw new PandocError("E_WARNINGS", "convert", `Warnings rejected: ${first.code}: ${first.message}`, first.format, first.location);}
    await reserveRetainedOutput(() => writer.text.unicodeChunks(result), context, options.eol);
    const chunks = async function* () {
      const encoder = new TextEncoder();
      for await (const part of writer.text.unicodeChunks(result)) yield encoder.encode(options.eol === "crlf" ? part.split("\n").join("\r\n") : part);
    };
    if (Number.isFinite(context.limits.outputBytes) && !Number.isFinite(context.limits.references) && !Number.isFinite(context.limits.retainedBytes)) {let length = 0; for await (const bytes of chunks()) {length += bytes.length; context.bound("outputBytes", length);}}
    await emitRetainedOutput(chunks(), context);
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};} finally {release();}
  if (failure) throw failure.reason;
}
