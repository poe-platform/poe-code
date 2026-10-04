import {reserveRetainedOutput} from "./retained-output-budgets.js";
import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import type {FormatSelection} from "./formats.js";
import {readJsonNumber} from "./json-number.js";
import {PandocError} from "./errors.js";

type Job = {op: string; node: number; path: number; mode?: string | undefined; stage?: number | undefined; cursor?: number | undefined; end?: number | undefined; index?: number | undefined;
  text?: TextRange | undefined; parts?: Job[] | undefined; sep?: string | undefined; previous?: string | undefined; previousMarker?: string | undefined; marker?: string | undefined; choice?: string | undefined;
  next?: string | undefined; digits?: boolean | undefined; start?: boolean | undefined; finish?: boolean | undefined; task?: boolean | undefined; cell?: boolean | undefined; first?: string | undefined; rest?: string | undefined;
  begin?: number | undefined; stop?: number | undefined; width?: number | undefined; lineWidth?: number | undefined; gap?: string | undefined; column?: number | undefined; columns?: number | undefined;
  row?: number | undefined; occupancy?: number | undefined; last?: number | undefined; number?: number | undefined; delimiter?: string | undefined};

/** Stored continuations and text ranges keep nesting, output and references out
 * of the resident heap. Reference collision chains retain exact target identity. */
class MarkdownTape {
  readonly text: BackedText;
  private top = 0;
  private readonly buckets: IntegerTable;
  private firstTarget = 0;
  private lastTarget = 0;
  private targetCount = 0;
  constructor(private readonly tree: BackedJson, private readonly storage: PagedStorage,
    private readonly context: ExecutionContext, private readonly options: ConversionOptions, private readonly selection: FormatSelection) {
    this.text = new BackedText(storage, units => context.cooperate(units));
    this.buckets = new IntegerTable(storage, 64);
  }
  private async record(value: unknown): Promise<number> {
    const payload = new TextEncoder().encode(JSON.stringify(value)), bytes = new Uint8Array(8 + payload.length);
    new DataView(bytes.buffer).setFloat64(0, payload.length, true); bytes.set(payload, 8); return this.storage.append(bytes);
  }
  private async read<T>(position: number): Promise<T> {
    const header = await this.storage.read(position, 8), size = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    return JSON.parse(new TextDecoder().decode(await this.storage.read(position + 8, size))) as T;
  }
  private async pointer(position: number): Promise<number> {const bytes = await this.storage.read(position, 8); return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);}
  private async put(position: number, value: number): Promise<void> {const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); await this.storage.write(position, bytes);}
  private async push(job: Job): Promise<void> {this.top = await this.record({parent: this.top, job});}
  private async path(parent: number, suffix: string): Promise<number> {return this.record({parent, suffix});}
  private async location(path: number): Promise<string> {
    let result = "";
    while (path) {const part = await this.read<{parent: number; suffix: string}>(path); result = part.suffix + result; path = part.parent; await this.context.cooperate();}
    return result;
  }
  private async loss(path: number, feature: string, table = false, inline = false): Promise<void> {
    const message = table ? feature : `Markdown cannot represent ${feature}`;
    const format = table ? "gfm" : this.selection.descriptor.name;
    if (!this.options.lossy) throw new PandocError(table && !inline ? "E_CAPABILITY" : "E_UNSUPPORTED_FEATURE", "convert", message, format, await this.location(path));
    this.context.report({code: table ? "W_TABLE_LOSS" : "W_RAW_CONTENT", operation: "convert", format,
      location: await this.location(path), message: table ? feature : `Projected ${feature}`});
  }
  private async at(node: number, index: number): Promise<number> {let child = node + 32; for (let i = 0; i < index; i++) child = (await this.tree.describe(child)).end; return child;}
  private async count(node: number): Promise<number> {return (await this.tree.describe(node)).children;}
  private async number(node: number): Promise<number> {return readJsonNumber(this.tree.scalarChunks(node), units => this.context.cooperate(units));}
  private async tag(node: number): Promise<string> {return (await this.tree.smallText((await this.tree.property(node, "t"))!, 32))!;}
  private async scalar(node: number): Promise<TextRange> {return this.text.from(this.tree.scalarChunks(node));}
  private async literal(value: string): Promise<TextRange> {return this.text.from([value]);}
  private async join(...values: TextRange[]): Promise<TextRange> {
    if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", values.reduce((length, value) => length + value.units, 0));
    const result = emptyText(); for (const value of values) await this.text.append(result, value); return result;
  }
  private async attrs(node: number, path: number, table = false): Promise<void> {
    if ((await this.tree.describe(node + 32)).end > node + 64 || await this.count(await this.at(node, 1)) || await this.count(await this.at(node, 2)))
      await this.loss(path, table ? "Flattened table attributes" : "attributes", table);
  }
  private async repeat(char: string, count: number): Promise<TextRange> {
    return this.text.from((async function* () {while (count) {const size = Math.min(4096, count); yield char.repeat(size); count -= size;}})());
  }
  private async inspect(value: TextRange): Promise<{first: string; last: string; run: number; nonspace: boolean; lastBreak: number}> {
    let first = "", last = "", run = 0, max = 0, nonspace = false, index = 0, lastBreak = -1;
    for await (const chunk of this.text.chunks(value)) for (const char of chunk) {
      first ||= char; last = char; if (char !== " ") nonspace = true;
      run = char === "`" ? run + 1 : 0; max = Math.max(max, run);
      if (char === "\n") lastBreak = index;
      index += char.length;
    }
    return {first, last, run: max, nonspace, lastBreak};
  }
  private async escape(value: TextRange, target = false, prose = false, start = true, finish = true, digitsBefore = false, cell = false): Promise<TextRange> {
    if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", value.units * 6);
    let leading = 0, trailing = 0, length = 0, seen = false;
    for await (const chunk of this.text.chunks(value)) for (const c of chunk) {
      const char = cell && "\r\n\t".includes(c) ? " " : c;
      if (!seen && char === " ") leading++; else seen = true;
      length += char.length; if (char !== " ") trailing = length;
    }
    if (!start) leading = 0;
    if (!finish) trailing = length;
    const source = this.text.chunks(value), autolink = this.selection.extensions.autolink_bare_uris;
    return this.text.from((async function* () {
      let output = "", index = 0, previous = "", digits = true;
      for await (const chunk of source) for (let i = 0; i < chunk.length; i++) {
        const original = chunk[i]!, char = cell && "\r\n\t".includes(original) ? " " : original;
        if (prose && char === " " && index >= leading && index < trailing) output += char;
        else if (prose && autolink && (char === "@" || char === "." && previous.toLowerCase() === "www")) output += `\\${char}`;
        else if (prose && "-+.)".includes(char)) output += (start && index === 0 && char !== ")" || (char === "." || char === ")") && (digitsBefore || start && index > 0) && digits) ? `\\${char}` : char;
        else if (char !== "\r") output += char === "\n" ? "&#10;" : char === " " ? "&#32;" : !target && char === "\t" ? "&#9;" : (target ? '\\<>"&' : "\\`*_{}[]<>|!#~&:").includes(char) ? `\\${char}` : char;
        previous = (previous + char).slice(-3); digits &&= char >= "0" && char <= "9"; index++;
        if (output.length >= 4096) {yield output; output = "";}
      }
      if (output) yield output;
    })());
  }
  private async code(value: TextRange, block: boolean, cell = false): Promise<TextRange> {
    const source = this.text.chunks(value);
    return this.text.from((async function* () {
      let cr = false, output = "";
      for await (const chunk of source) for (const char of chunk) {
        if (cr) {output += block ? "\n" : " "; cr = false; if (char === "\n") continue;}
        if (char === "\r") cr = true;
        else output += char === "\n" ? block ? "\n" : " " : cell && char === "|" ? "\\|" : char;
        if (output.length >= 4096) {yield output; output = "";}
      }
      if (cr) output += block ? "\n" : " ";
      if (output) yield output;
    })());
  }
  private async indent(value: TextRange, first: string, rest: string): Promise<TextRange> {
    if (Number.isFinite(this.context.limits.references)) {
      let lines = 1; for await (const chunk of this.text.chunks(value)) for (const char of chunk) if (char === "\n") lines++;
      this.context.bound("outputBytes", value.units + first.length + (lines - 1) * rest.length);
    }
    const source = this.text.chunks(value);
    return this.text.from((async function* () {
      let initial = true, start = true, output = "";
      for await (const chunk of source) for (const char of chunk) {
        if (start) {output += initial ? first : char === "\n" ? rest.trimEnd() : rest; start = false; initial = false;}
        output += char; if (char === "\n") start = true;
        if (output.length >= 4096) {yield output; output = "";}
      }
      if (start) output += initial ? first : rest.trimEnd();
      if (output) yield output;
    })());
  }
  private async target(node: number, add = false): Promise<number> {
    if (add && Number.isFinite(this.context.limits.references)) {
      const url = await this.scalar(node + 32), title = await this.scalar(await this.at(node, 1));
      this.context.bound("outputBytes", (url.units + title.units) * 6 + 8);
    }
    let hash = 2166136261;
    for await (const chunk of this.tree.chunks(node)) for (const byte of chunk) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    const bucket = BigInt(hash), first = Number(await this.buckets.get(bucket) ?? 0n);
    for (let record = first; record; record = await this.pointer(record)) {
      const stored = await this.pointer(record + 16);
      if (await this.tree.equalText(node + 32, stored + 32) && await this.tree.equalText(await this.at(node, 1), await this.at(stored, 1))) {
        if (add) await this.put(record + 24, await this.pointer(record + 24) + 1);
        return record;
      }
    }
    if (!add) return 0;
    if (Number.isFinite(this.context.limits.references)) this.context.charge("references", 1);
    const position = this.storage.allocate(40);
    for (const [index, value] of [first, 0, node, 1, ++this.targetCount].entries()) await this.put(position + index * 8, value);
    await this.buckets.set(bucket, BigInt(position));
    if (this.lastTarget) await this.put(this.lastTarget + 8, position); else this.firstTarget = position;
    this.lastTarget = position; return position;
  }
  private list(node: number, path: number, mode: string, extra: Partial<Job> = {}): Job {return {op: "list", node, path, mode, ...extra};}
  private async task(node: number): Promise<boolean | undefined> {
    const attr = node + 32, children = await this.at(node, 1);
    if (await this.count(children) || (await this.tree.describe(attr + 32)).end > attr + 64) return undefined;
    const classes = await this.at(attr, 1), pairs = await this.at(attr, 2);
    if (await this.count(classes) !== 1 || await this.tree.smallText(classes + 32, 16) !== "task-list-marker" || await this.count(pairs) !== 1) return undefined;
    const pair = pairs + 32;
    if (await this.tree.smallText(pair + 32, 7) !== "checked") return undefined;
    const state = await this.tree.smallText(await this.at(pair, 1), 5);
    return state === "true" ? true : state === "false" ? false : undefined;
  }
  async render(): Promise<TextRange> {
    const blocks = (await this.tree.property(this.tree.rootPosition, "blocks"))!, end = (await this.tree.describe(blocks)).end;
    for (let node = blocks; node < end;) {
      const header = await this.tree.describe(node);
      if (header.kind === "object") {
        const tag = await this.tree.property(node, "t"), name = tag === undefined ? undefined : await this.tree.smallText(tag, 5);
        if (name === "Link" || name === "Image") await this.target(await this.at((await this.tree.property(node, "c"))!, 2), true);
      }
      node = header.kind === "object" || header.kind === "array" ? node + 32 : header.end;
      await this.context.cooperate();
    }
    await this.push(this.list(blocks, await this.path(0, "$.blocks"), "block"));
    let result = emptyText();
    while (this.top) {
      await this.context.cooperate();
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent; const job = frame.job;
      if (job.op === "empty") {result = emptyText(); continue;}
      if (job.op === "scalar") {result = await this.scalar(job.node); continue;}
      if (job.op === "post") {
        if (job.mode === "surround") result = await this.join(await this.literal(job.first!), result, await this.literal(job.rest!));
        if (job.mode === "indent") result = result.units || job.first === "> " ? await this.indent(result, job.first!, job.rest!) : await this.literal(job.first!.trimEnd());
        if (job.mode === "escape") result = await this.escape(result);
        if (job.mode === "trim") result = await this.text.trimFinalNewline(result);
        continue;
      }
      if (job.op === "parts" || job.op === "list") {
        if (!job.stage) {job.text = emptyText(); job.index = 0; job.cursor = job.begin ?? job.node + 32; job.end = job.op === "parts" ? 0 : job.stop ?? (await this.tree.describe(job.node)).end;}
        else {
          if (job.index) await this.text.append(job.text!, await this.literal(job.mode === "block" ? job.previous === "Plain" ? "\n" : "\n\n" : job.sep ?? ""));
          await this.text.append(job.text!, result); job.index!++;
          job.previous = job.next;
        }
        let child: Job | undefined;
        if (job.op === "parts") child = job.parts![job.index!];
        else if (job.cursor! < job.end!) {
          const node = job.cursor!, after = (await this.tree.describe(node)).end;
          child = {op: job.mode!, node, path: await this.path(job.path, `[${job.index}]`), index: job.index, task: job.task && job.index === 0, cell: job.cell, marker: job.marker};
          job.cursor = after;
          if (job.mode === "block" || job.mode === "inline") {
            const tag = await this.tag(node), next = after < job.end! ? await this.tag(after) : "";
            child.previous = job.previous; job.next = tag;
            if (job.mode === "inline") {
              child.start = job.index === 0 || job.previous === "SoftBreak" || job.previous === "LineBreak";
              child.finish = after === job.end || next === "SoftBreak" || next === "LineBreak";
              child.last = after === job.end ? 1 : 0;
              child.digits = job.digits;
              if (["Emph", "Strong", "Strikeout"].includes(tag) && (tag !== "Strikeout" || this.selection.extensions.strikeout)) {
                child.choice = tag === "Strikeout" ? "~" : job.previous === tag ? job.previousMarker === "*" ? "_" : "*" : job.marker === "*" && job.previous !== "Str" && next !== "Str" ? "_" : "*";
                job.previousMarker = child.choice;
              }
              let digits = false;
              if (tag === "Str" && (job.index === 0 || job.digits)) {
                const value = (await this.tree.property(node, "c"))!; digits = (await this.tree.describe(value)).end > value + 32;
                for await (const chunk of this.tree.scalarChunks(value)) for (const char of chunk) if (char < "0" || char > "9") digits = false;
              }
              job.digits = digits;
            } else if (tag === "BulletList") {
              child.first = job.previous === "BulletList" && job.first === "-" ? "+" : "-"; job.first = child.first;
            }
          }
          if (job.mode === "item") {child.first = job.first; child.number = job.number; child.delimiter = job.delimiter;}
        }
        if (child) {job.stage = 1; await this.push(job); await this.push(child);} else {
          result = job.text!;
          if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", result.units);
        }
        continue;
      }
      if (job.op === "paragraph") {
        if (!(this.options.wrap === "auto" || this.options.wrap === undefined && this.options.columns !== undefined)) {await this.push(this.list(job.node, job.path, "inline", {task: job.task})); continue;}
        if (!job.stage) {
          if (Number.isFinite(this.context.limits.references)) this.context.charge("references", (await this.count(job.node)) * 3 + 1);
          job.text = emptyText(); job.cursor = job.node + 32; job.end = (await this.tree.describe(job.node)).end; job.lineWidth = 0; job.gap = "";
        }
        else {
          const gap = job.gap && job.lineWidth! > 0 && job.lineWidth! + 1 + result.units > (this.options.columns ?? 72) ? "\n" : job.gap!;
          await this.text.append(job.text!, await this.literal(gap)); await this.text.append(job.text!, result);
          const last = (await this.inspect(result)).lastBreak;
          job.lineWidth = last >= 0 ? result.units - last - 1 : (gap === "\n" ? 0 : job.lineWidth! + gap.length) + result.units;
          job.gap = " ";
        }
        while (job.cursor! < job.end! && ["Space", "SoftBreak"].includes(await this.tag(job.cursor!))) job.cursor = (await this.tree.describe(job.cursor!)).end;
        const begin = job.cursor!;
        while (job.cursor! < job.end! && !["Space", "SoftBreak"].includes(await this.tag(job.cursor!))) job.cursor = (await this.tree.describe(job.cursor!)).end;
        if (begin < job.end!) {job.stage = 1; await this.push(job); await this.push(this.list(job.node, job.path, "inline", {begin, stop: job.cursor, task: job.task && begin === job.node + 32}));}
        else {
          result = job.text!;
          if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", result.units);
        }
        continue;
      }
      if (job.op === "item") {
        const mark = job.number === undefined ? job.first! : `${job.number + job.index!}${job.delimiter}`;
        if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", mark.length + 1);
        await this.push({op: "post", node: 0, path: job.path, mode: "indent", first: mark + " ", rest: " ".repeat(mark.length + 1)});
        await this.push(this.list(job.node, job.path, "block", {task: true})); continue;
      }
      if (job.op === "link") {
        const target = await this.at(job.node, 2), reference = await this.target(target);
        if (reference && await this.pointer(reference + 24) > 1) result = await this.join(await this.literal(job.first!), result, await this.literal(`][${await this.pointer(reference + 32)}]`));
        else {
          const url = await this.escape(await this.scalar(target + 32), true), title = await this.scalar(await this.at(target, 1));
          result = await this.join(await this.literal(job.first!), result, await this.literal("](<"), url, await this.literal(">"), title.units ? await this.join(await this.literal(' "'), await this.escape(title, true), await this.literal('"')) : emptyText(), await this.literal(")"));
        }
        continue;
      }
      if (job.op === "inline" || job.op === "block") {
        const tag = await this.tag(job.node), content = await this.tree.property(job.node, "c"), cp = await this.path(job.path, ".c");
        const child = async (index: number, op: string): Promise<Job> => ({op, node: await this.at(content!, index), path: await this.path(cp, `[${index}]`)});
        if (tag === "Str") {
          const value = await this.scalar(content!);
          if (job.cell) {let loss = false; for await (const chunk of this.text.chunks(value)) if ([...chunk].some(char => "\r\n\t".includes(char))) loss = true; if (loss) await this.loss(job.path, "Flattened cell text line boundaries", true, true);}
          result = await this.escape(value, false, true, job.start, job.finish, job.digits, job.cell); continue;
        }
        if (tag === "Space" || tag === "SoftBreak" || tag === "LineBreak" || tag === "HorizontalRule") {
          result = await this.literal(tag === "Space" ? job.index === 0 || job.last ? "&#32;" : " " : tag === "SoftBreak" ? "\n" : tag === "LineBreak" ? "\\\n" : "---"); continue;
        }
        if (tag === "Code" || tag === "CodeBlock") {
          const attr = content! + 32, original = await this.scalar(await this.at(content!, 1)); let info = emptyText();
          if (tag === "Code") {
            await this.attrs(attr, job.path);
            let loss = false; for await (const chunk of this.text.chunks(original)) if (chunk.includes("\r") || chunk.includes("\n")) loss = true;
            if (loss) await this.loss(job.path, "code-span line boundaries");
          } else {
            const classes = await this.at(attr, 1);
            if ((await this.tree.describe(attr + 32)).end > attr + 64 || await this.count(classes) > 1 || await this.count(await this.at(attr, 2))) await this.loss(job.path, "code block attributes");
            if (await this.count(classes)) info = await this.scalar(classes + 32);
            let loss = false; for await (const chunk of this.text.chunks(info)) for (const char of chunk) if ("\r\n` ".includes(char)) loss = true;
            if (loss) await this.loss(job.path, "code language");
          }
          if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", original.units * 2);
          const value = await this.code(original, tag === "CodeBlock", job.cell), details = await this.inspect(value), size = Math.max(tag === "CodeBlock" ? 3 : 1, details.run + 1);
          if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", value.units + size * 2 + (tag === "CodeBlock" ? info.units : 0) + 2);
          if (tag === "CodeBlock") result = await this.join(await this.repeat("`", size), info, await this.literal("\n"), value, await this.literal(details.last === "\n" ? "" : "\n"), await this.repeat("`", size));
          else {const padding = details.first === "`" || details.last === "`" || details.first === " " && details.last === " " && details.nonspace ? " " : ""; result = await this.join(await this.repeat("`", size), await this.literal(padding), value, await this.literal(padding), await this.repeat("`", size));}
          continue;
        }
        if (tag === "Link" || tag === "Image") {
          await this.attrs(content! + 32, job.path); await this.push({op: "link", node: content!, path: cp, first: tag === "Image" ? "![" : "["});
          const inner = await child(1, "inline"); await this.push(this.list(inner.node, inner.path, "inline")); continue;
        }
        if (tag === "Emph" || tag === "Strong" || tag === "Strikeout") {
          if (tag === "Strikeout" && !this.selection.extensions.strikeout) {await this.loss(job.path, "strikeout"); await this.push(this.list(content!, cp, "inline"));}
          else {const delimiter = job.choice!.repeat(tag === "Emph" ? 1 : 2); await this.push({op: "post", node: 0, path: job.path, mode: "surround", first: delimiter, rest: delimiter}); await this.push(this.list(content!, cp, "inline", {marker: job.choice, cell: job.cell}));}
          continue;
        }
        if (tag === "Span") {
          const state = await this.task(content!);
          if (state !== undefined) result = await this.literal(job.task && this.selection.extensions.task_lists ? state ? "[x] " : "[ ] " : state ? "☒ " : "☐ ");
          else {await this.attrs(content! + 32, job.path); const inner = await child(1, "inline"); await this.push(this.list(inner.node, inner.path, "inline"));} continue;
        }
        if (tag === "Quoted") {
          const quote = await this.tag(content! + 32) === "DoubleQuote" ? '"' : "'";
          await this.push({op: "post", node: 0, path: job.path, mode: "surround", first: quote, rest: quote}); const inner = await child(1, "inline"); await this.push(this.list(inner.node, inner.path, "inline")); continue;
        }
        if (tag === "Cite") {await this.loss(job.path, "citations"); const inner = await child(1, "inline"); await this.push(this.list(inner.node, inner.path, "inline")); continue;}
        if (tag === "RawInline" || tag === "Math" || tag === "RawBlock") {
          await this.loss(job.path, tag === "Math" ? "math" : tag === "RawInline" ? "raw inline content" : "raw blocks");
          result = await this.escape(await this.scalar(await this.at(content!, 1)), false, true); continue;
        }
        if (tag === "Note") {await this.loss(job.path, "notes"); result = emptyText(); continue;}
        if (tag === "Plain" || tag === "Para") {await this.push({op: "paragraph", node: content!, path: cp, task: job.task}); continue;}
        if (tag === "Header") {
          await this.attrs(await this.at(content!, 1), job.path);
          await this.push({op: "header", node: content!, path: cp}); const inner = await child(2, "inline"); await this.push(this.list(inner.node, inner.path, "inline")); continue;
        }
        if (tag === "Div" || tag === "BlockQuote") {
          if (tag === "Div") await this.attrs(content! + 32, job.path);
          else await this.push({op: "post", node: 0, path: job.path, mode: "indent", first: "> ", rest: "> "});
          const inner = tag === "Div" ? await child(1, "block") : {node: content!, path: cp}; await this.push(this.list(inner.node, inner.path, "block")); continue;
        }
        if (tag === "BulletList" || tag === "OrderedList") {
          const ordered = tag === "OrderedList", items = ordered ? await this.at(content!, 1) : content!;
          let number: number | undefined, delimiter: string | undefined;
          if (ordered) {
            const spec = content! + 32, style = await this.tag(await this.at(spec, 1)), delim = await this.tag(await this.at(spec, 2));
            if (!["Decimal", "DefaultStyle"].includes(style) || !["Period", "DefaultDelim", "OneParen"].includes(delim)) await this.loss(job.path, "list numbering style");
            number = await this.number(spec + 32); delimiter = delim === "OneParen" ? ")" : ".";
          }
          let loose = false; for await (const item of this.tree.children(items)) for await (const block of this.tree.children(item)) if (await this.tag(block) === "Para") loose = true;
          await this.push(this.list(items, await this.path(job.path, ".items"), "item", {first: job.first, number, delimiter, sep: loose ? "\n\n" : "\n"})); continue;
        }
        if (tag === "Table") {await this.push({op: "table", node: content!, path: job.path}); continue;}
        await this.loss(job.path, tag);
        if (job.op === "inline") await this.push(this.list(content!, cp, "inline")); else result = emptyText();
        continue;
      }
      if (job.op === "header") {result = await this.join(await this.repeat("#", await this.number(job.node + 32)), await this.literal(" "), result); continue;}
      // Table and flattening continuations are handled below.
      result = await this.tableJob(job, result);
    }
    const definitions = emptyText(); let definitionCount = 0;
    for (let record = this.firstTarget; record; record = await this.pointer(record + 8)) if (await this.pointer(record + 24) > 1) {
      const target = await this.pointer(record + 16), title = await this.scalar(await this.at(target, 1));
      if (definitionCount++) await this.text.append(definitions, await this.literal("\n"));
      await this.text.append(definitions, await this.join(await this.literal(`[${await this.pointer(record + 32)}]: <`), await this.escape(await this.scalar(target + 32), true), await this.literal(">"), title.units ? await this.join(await this.literal(' "'), await this.escape(title, true), await this.literal('"')) : emptyText()));
    }
    if (definitionCount) {
      if (Number.isFinite(this.context.limits.references)) this.context.bound("outputBytes", definitions.units);
      result = await this.join(result, await this.literal("\n\n"), definitions);
    }
    if (result.units && (await this.inspect(result)).last !== "\n") result = await this.join(result, await this.literal("\n"));
    return result;
  }
  private async tableEscape(value: TextRange): Promise<TextRange> {
    const source = this.text.chunks(value);
    return this.text.from((async function* () {let output = "";
      for await (const chunk of source) for (const char of chunk) {
        output += "\\`*_{}[]<>|!#".includes(char) ? `\\${char}` : "\n\r\t".includes(char) ? " " : char;
        if (output.length >= 4096) {yield output; output = "";}
      }
      if (output) yield output;
    })());
  }
  private async tableJob(job: Job, result: TextRange): Promise<TextRange> {
    const part = async (index: number, op: string): Promise<Job> => ({op, node: await this.at(job.node, index), path: await this.path(job.path, `[${index}]`)});
    if (job.op === "tableEscape") return this.tableEscape(result);
    if (job.op === "table") {
      if (!this.selection.extensions.pipe_tables) throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", "Pipe tables are unavailable", this.selection.descriptor.name, await this.location(job.path));
      const tablePath = await this.path(0, "$.blocks[0]");
      const path = await this.path(tablePath, ".c"), columns = await this.at(job.node, 2), count = await this.count(columns);
      if (!count) throw new PandocError("E_CAPABILITY", "convert", "GFM requires at least one column", "gfm", "$.blocks[0]");
      const element = async (index: number, op: string): Promise<Job> => ({op, node: await this.at(job.node, index), path: await this.path(path, `[${index}]`)});
      await this.attrs(job.node + 32, await this.path(path, "[0]"), true);
      const caption = await element(1, "caption"), short = caption.node + 32, long = await this.at(caption.node, 1);
      const hasCaption = await this.count(short) || await this.count(long);
      if (hasCaption) await this.loss(caption.path, "Flattened table caption", true);
      let index = 0;
      for await (const column of this.tree.children(columns)) {
        if (await this.tag(await this.at(column, 1)) !== "ColWidthDefault") await this.loss(await this.path(path, `[2][${index}][1]`), "Flattened column width", true);
        index++;
      }
      const head = await element(3, "tableHead"), bodies = await element(4, "tableBodies"), foot = await element(5, "tableFoot");
      await this.attrs(head.node + 32, await this.path(head.path, "[0]"), true);
      if (await this.count(await this.at(head.node, 1)) !== 1) await this.loss(await this.path(head.path, "[1]"), "Flattened table header to a single row", true);
      if (await this.count(bodies.node) !== 1) await this.loss(bodies.path, "Flattened multiple table bodies", true);
      await this.attrs(foot.node + 32, await this.path(foot.path, "[0]"), true);
      if (await this.count(await this.at(foot.node, 1))) await this.loss(await this.path(foot.path, "[1]"), "Flattened table footer", true);
      index = 0;
      for await (const body of this.tree.children(bodies.node)) {
        const bp = await this.path(bodies.path, `[${index++}]`);
        await this.attrs(body + 32, await this.path(bp, "[0]"), true);
        if (await this.number(await this.at(body, 1))) await this.loss(await this.path(bp, "[1]"), "Flattened row header columns", true);
        if (await this.count(await this.at(body, 2))) await this.loss(await this.path(bp, "[2]"), "Flattened body header", true);
      }
      const rowAttrs = async (rows: number, path: number) => {
        let index = 0; for await (const row of this.tree.children(rows)) await this.attrs(row + 32, await this.path(path, `[${index++}][0]`), true);
      };
      await rowAttrs(await this.at(head.node, 1), await this.path(head.path, "[1]")); index = 0;
      for await (const body of this.tree.children(bodies.node)) {
        const bp = await this.path(bodies.path, `[${index++}]`);
        await rowAttrs(await this.at(body, 2), await this.path(bp, "[2]")); await rowAttrs(await this.at(body, 3), await this.path(bp, "[3]"));
      }
      await rowAttrs(await this.at(foot.node, 1), await this.path(foot.path, "[1]"));
      const captionJob: Job = hasCaption ? {...caption, op: "tableCaption", node: await this.count(long) ? long : short, mode: await this.count(long) ? "fblock" : "finline"} : {op: "empty", node: 0, path};
      await this.push({op: "post", node: 0, path, mode: "trim"});
      await this.push({op: "parts", node: 0, path, parts: [captionJob, {...head, columns, width: count}, {...bodies, width: count}, {...foot, width: count}]});
      return result;
    }
    if (job.op === "tableCaption") {
      await this.push({op: "post", node: 0, path: job.path, mode: "surround", first: "", rest: "\n\n"});
      await this.push({op: "tableEscape", node: 0, path: job.path}); await this.push(this.list(job.node, job.path, job.mode!, {sep: job.mode === "fblock" ? " " : ""})); return result;
    }
    if (job.op === "tableHead") {
      if (!job.stage) {
        const rows = await this.at(job.node, 1); await this.push({...job, stage: 1});
        if (await this.count(rows)) await this.push({op: "tableRows", node: rows, path: await this.path(job.path, "[1]"), width: job.width});
        else {
          this.context.charge("tableCells", job.width!);
          result = await this.literal("| ");
          for (let column = 0; column < job.width!; column++) await this.text.append(result, await this.literal(column + 1 === job.width ? " |" : " | "));
          await this.text.append(result, await this.literal("\n"));
        }
        return result;
      }
      let first = true; const output = emptyText();
      for await (const chunk of this.text.chunks(result)) {
        const split = first ? chunk.indexOf("\n") : -1;
        if (split < 0) await this.text.append(output, await this.literal(chunk));
        else {
          await this.text.append(output, await this.literal(chunk.slice(0, split + 1) + "| ")); first = false; let index = 0;
          for await (const column of this.tree.children(job.columns!)) {
            const tag = await this.tag(column + 32), delimiter = tag === "AlignLeft" ? ":---" : tag === "AlignRight" ? "---:" : tag === "AlignCenter" ? ":---:" : "---";
            await this.text.append(output, await this.literal((index++ ? " | " : "") + delimiter));
          }
          await this.text.append(output, await this.literal(" |\n" + chunk.slice(split + 1)));
        }
      }
      return output;
    }
    if (job.op === "tableBodies") {
      if (!job.stage) {job.text = emptyText(); job.cursor = job.node + 32; job.end = (await this.tree.describe(job.node)).end; job.index = 0;}
      else {await this.text.append(job.text!, result); job.index!++;}
      if (job.cursor! < job.end!) {
        const node = job.cursor!, path = await this.path(job.path, `[${job.index}]`); job.cursor = (await this.tree.describe(node)).end;
        await this.push({...job, stage: 1});
        await this.push({op: "parts", node: 0, path, parts: [
          {op: "tableRows", node: await this.at(node, 2), path: await this.path(path, "[2]"), width: job.width},
          {op: "tableRows", node: await this.at(node, 3), path: await this.path(path, "[3]"), width: job.width}
        ]});
      } else result = job.text!;
      return result;
    }
    if (job.op === "tableFoot") {await this.push({op: "tableRows", node: await this.at(job.node, 1), path: await this.path(job.path, "[1]"), width: job.width}); return result;}
    if (job.op === "tableRows") {
      if (!job.stage) {job.text = emptyText(); job.cursor = job.node + 32; job.end = (await this.tree.describe(job.node)).end; job.index = 0; job.occupancy = this.storage.allocate(job.width! * 8);}
      else {await this.text.append(job.text!, result); job.index!++;}
      if (job.cursor! < job.end!) {
        const node = job.cursor!, path = await this.path(job.path, `[${job.index}]`); job.cursor = (await this.tree.describe(node)).end;
        await this.push({...job, stage: 1}); await this.push({op: "tableRow", node: await this.at(node, 1), path: await this.path(path, "[1]"), row: job.index, width: job.width, occupancy: job.occupancy});
      } else result = job.text!;
      return result;
    }
    if (job.op === "tableRow") {
      if (!job.stage) {job.text = await this.literal("| "); job.cursor = job.node + 32; job.end = (await this.tree.describe(job.node)).end; job.index = 0; job.column = 0; job.number = 0;}
      const separator = async () => {await this.text.append(job.text!, await this.literal(job.column! + 1 === job.width ? " |" : " | ")); job.column!++;};
      if (job.stage) {await this.text.append(job.text!, result); await separator(); job.index!++;}
      if (job.cursor! < job.end!) {
        const node = job.cursor!, path = await this.path(job.path, `[${job.index}]`); job.cursor = (await this.tree.describe(node)).end;
        while (await this.pointer(job.occupancy! + job.number! * 8) > job.row!) {job.number!++; await this.context.cooperate();}
        while (job.column! < job.number!) await separator();
        const rows = await this.number(await this.at(node, 2)), span = await this.number(await this.at(node, 3));
        for (let column = 0; column < span; column++) {await this.put(job.occupancy! + (job.number! + column) * 8, job.row! + rows); await this.context.cooperate();}
        job.number! += span;
        await this.attrs(node + 32, await this.path(path, "[0]"), true);
        if (rows !== 1 || span !== 1) await this.loss(path, "Flattened cell span", true);
        if (await this.tag(await this.at(node, 1)) !== "AlignDefault") await this.loss(await this.path(path, "[1]"), "Flattened cell alignment", true);
        const blocks = await this.at(node, 4), bp = await this.path(path, "[4]"), count = await this.count(blocks);
        await this.push({...job, stage: 1});
        if (count > 1 || count === 1 && !["Plain", "Para"].includes(await this.tag(blocks + 32))) {
          await this.loss(bp, "Flattened complex cell blocks", true); await this.push({op: "tableEscape", node: 0, path: bp}); await this.push(this.list(blocks, bp, "fblock", {sep: " "}));
        } else if (count) await this.push(this.list((await this.tree.property(blocks + 32, "c"))!, await this.path(bp, "[0].c"), "inline", {cell: true}));
        else await this.push({op: "empty", node: 0, path: bp});
      } else {while (job.column! < job.width!) await separator(); await this.text.append(job.text!, await this.literal("\n")); result = job.text!;}
      return result;
    }
    if (job.op === "finline" || job.op === "fblock") {
      const tag = await this.tag(job.node), content = await this.tree.property(job.node, "c"), cp = await this.path(job.path, ".c");
      const list = async (index: number | undefined, mode: string, sep = ""): Promise<void> => {
        await this.push(this.list(index === undefined ? content! : await this.at(content!, index), cp, mode, {sep}));
      };
      if (tag === "Str") return this.scalar(content!);
      if (["Space", "SoftBreak", "LineBreak"].includes(tag)) return this.literal(" ");
      if (["Code", "Math", "RawInline", "CodeBlock", "RawBlock"].includes(tag)) return this.scalar(await this.at(content!, 1));
      if (["Link", "Image", "Span", "Quoted", "Cite"].includes(tag)) await list(1, "finline");
      else if (["Note", "BlockQuote"].includes(tag)) await list(undefined, "fblock", " ");
      else if (["Plain", "Para"].includes(tag)) await list(undefined, "finline");
      else if (tag === "Header") await list(2, "finline");
      else if (tag === "Div") await list(1, "fblock", " ");
      else if (tag === "LineBlock") await list(undefined, "fline", " ");
      else if (tag === "OrderedList" || tag === "BulletList") await list(tag === "OrderedList" ? 1 : undefined, "fitem", " ");
      else if (tag === "DefinitionList") await list(undefined, "fdefinition");
      else if (tag === "HorizontalRule") return emptyText();
      else if (tag === "Figure") {
        const caption = await this.at(content!, 1);
        await this.push({op: "parts", node: 0, path: cp, sep: " ", parts: [this.list(await this.at(caption, 1), cp, "fblock", {sep: " "}), this.list(await this.at(content!, 2), cp, "fblock", {sep: " "})]});
      } else if (tag === "Table") {
        const head = await this.at(content!, 3), bodies = await this.at(content!, 4), foot = await this.at(content!, 5);
        await this.push({op: "parts", node: 0, path: cp, parts: [this.list(await this.at(head, 1), cp, "frow"), this.list(bodies, cp, "fbody"), this.list(await this.at(foot, 1), cp, "frow")]});
      } else if (job.op === "finline") await list(undefined, "finline");
      else return emptyText();
      return result;
    }
    if (job.op === "fline" || job.op === "fitem") {await this.push(this.list(job.node, job.path, job.op === "fline" ? "finline" : "fblock", {sep: job.op === "fline" ? "" : " "})); return result;}
    if (job.op === "frow") {await this.push(this.list(await this.at(job.node, 1), job.path, "fcell")); return result;}
    if (job.op === "fcell") {await this.push({op: "post", node: 0, path: job.path, mode: "surround", first: "", rest: " "}); await this.push(this.list(await this.at(job.node, 4), job.path, "fblock", {sep: " "})); return result;}
    if (job.op === "fbody") {await this.push({op: "parts", node: 0, path: job.path, parts: [this.list(await this.at(job.node, 2), job.path, "frow"), this.list(await this.at(job.node, 3), job.path, "frow")]}); return result;}
    if (job.op === "fdefinition") {
      const term = await part(0, "fline"), definitions = await part(1, "fdefinitions");
      await this.push({op: "parts", node: 0, path: job.path, parts: [term, definitions]}); return result;
    }
    if (job.op === "fdefinitions") {await this.push(this.list(job.node, job.path, "fdefinitionBody")); return result;}
    if (job.op === "fdefinitionBody") {await this.push({op: "post", node: 0, path: job.path, mode: "surround", first: " ", rest: ""}); await this.push(this.list(job.node, job.path, "fblock", {sep: " "})); return result;}
    throw new Error(`Unknown retained Markdown job: ${job.op}`);
  }
}

export async function writeRetainedMarkdown(tree: BackedJson, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions, selection: FormatSelection): Promise<void> {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close()); let failure: {reason: unknown} | undefined;
  try {
    const writer = new MarkdownTape(tree, storage, context, options, selection), result = await writer.render();
    const diagnostics = context.snapshotDiagnostics();
    if (options.failIfWarnings && diagnostics.length) {const first = diagnostics[0]!; throw new PandocError("E_WARNINGS", "convert", `Warnings rejected: ${first.code}: ${first.message}`, first.format, first.location);}
    await reserveRetainedOutput(() => writer.text.unicodeChunks(result), context, options.eol);
    const chunks = async function* () {
      const encoder = new TextEncoder();
      for await (const part of writer.text.unicodeChunks(result)) yield encoder.encode(options.eol === "crlf" ? part.split("\n").join("\r\n") : part);
    };
    if (Number.isFinite(context.limits.outputBytes) && !Number.isFinite(context.limits.references)) {let length = 0; for await (const bytes of chunks()) {length += bytes.length; context.bound("outputBytes", length);}}
    for await (const bytes of chunks()) await context.emit(bytes);
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};} finally {release();}
  if (failure) throw failure.reason;
}
