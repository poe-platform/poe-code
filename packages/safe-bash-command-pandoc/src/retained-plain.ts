import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import type {backedJsonOrder} from "./backed-json-order.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {readJsonNumber} from "./json-number.js";
import {PandocError} from "./errors.js";

type Job = {
  op: string; node: number; path: number; stage?: number; mode?: string;
  cursor?: number; end?: number; index?: number; text?: TextRange; count?: number;
  previous?: string; tag?: string; sep?: string; skip?: boolean; byCount?: boolean;
  start?: number; first?: string; rest?: string; empty?: string; title?: number;
  parts?: Job[]; setCount?: number;
};

/** All pending writer calls, paths and intermediate text live in caller storage.
 * Jobs contain fixed-size references and at most three structural child jobs. */
class PlainTape {
  readonly text: BackedText;
  private top = 0;
  constructor(private readonly tree: BackedJson, private readonly order: Awaited<ReturnType<typeof backedJsonOrder>>, private readonly storage: PagedStorage,
    private readonly context: ExecutionContext, private readonly options: ConversionOptions) {
    this.text = new BackedText(storage, units => context.cooperate(units));
  }
  private async record(value: unknown): Promise<number> {
    const payload = new TextEncoder().encode(JSON.stringify(value)), bytes = new Uint8Array(8 + payload.length);
    new DataView(bytes.buffer).setFloat64(0, payload.length, true); bytes.set(payload, 8);
    return this.storage.append(bytes);
  }
  private async read<T>(position: number): Promise<T> {
    const header = await this.storage.read(position, 8);
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    return JSON.parse(new TextDecoder().decode(await this.storage.read(position + 8, length))) as T;
  }
  private async push(job: Job): Promise<void> {this.top = await this.record({parent: this.top, job});}
  private async path(parent: number, suffix: string): Promise<number> {return this.record({parent, suffix});}
  private async location(path: number): Promise<string> {
    let result = "";
    while (path) {const part = await this.read<{parent: number; suffix: string}>(path); result = part.suffix + result; path = part.parent; await this.context.cooperate();}
    return result;
  }
  private async fail(path: number, message: string): Promise<never> {
    throw new PandocError("E_CAPABILITY", "convert", message, "plain", await this.location(path));
  }
  private async at(node: number, index: number): Promise<number> {
    let child = node + 32;
    for (let i = 0; i < index; i++) child = (await this.tree.describe(child)).end;
    return child;
  }
  private async number(node: number): Promise<number> {return readJsonNumber(this.tree.scalarChunks(node), units => this.context.cooperate(units));}
  private async tag(node: number): Promise<string> {return (await this.tree.smallText((await this.tree.property(node, "t"))!, 32))!;}
  private list(node: number, path: number, mode: string, sep = "", skip = false, byCount = false): Job {return {op: "list", node, path, mode, sep, skip, byCount};}
  private post(node: number, path: number, mode: string): Job {return {op: "post", node, path, mode};}
  private async checkMath(root: number, prefix: string): Promise<void> {
    let position = root, closing = false;
    while (position) {
      await this.context.cooperate();
      const header = await this.tree.describe(position);
      if (!closing) {
        if (header.kind === "object") {
          const tag = await this.tree.property(position, "t");
          if (tag !== undefined && await this.tree.smallText(tag, 4) === "Math") {
            let path = "";
            for (let child = position; child !== root;) {
              const parent = (await this.tree.describe(child)).parent, container = await this.tree.describe(parent);
              let index = 0;
              for await (const sibling of this.tree.children(parent)) {
                const item = await this.tree.describe(sibling);
                if (container.kind === "object" && item.kind === "key" && item.end === child) {
                  let key = ""; for await (const part of this.tree.scalarChunks(sibling)) key += part;
                  path = `.${key}${path}`; break;
                }
                if (container.kind === "array" && sibling === child) {path = `.${index}${path}`; break;}
                index++;
              }
              child = parent; await this.context.cooperate();
            }
            throw new PandocError("E_CAPABILITY", "convert", "Writer must explicitly preserve typed math source", undefined, prefix + path);
          }
        }
        if ((header.kind === "object" || header.kind === "array") && header.children) {
          position = header.kind === "object" ? await this.order.first(position) : position + 32;
          continue;
        }
      }
      if (position === root) break;
      const parent = await this.tree.describe(header.parent);
      const next = parent.kind === "object" && header.kind !== "key" ? await this.order.next(position, header.parent) : header.end < parent.end ? header.end : 0;
      if (next) {position = next; closing = false;}
      else {position = header.parent; closing = true;}
    }
  }
  async render(): Promise<TextRange> {
    const blocks = (await this.tree.property(this.tree.rootPosition, "blocks"))!;
    await this.checkMath(blocks, "$.blocks");
    await this.checkMath((await this.tree.property(this.tree.rootPosition, "meta"))!, "$.metadata");
    await this.push(this.list(blocks, await this.path(0, "$.blocks"), "block", "", true));
    let result = emptyText(), count = 0;
    while (this.top) {
      await this.context.cooperate();
      const frame = await this.read<{parent: number; job: Job}>(this.top);
      this.top = frame.parent;
      const job = frame.job;
      if (job.op === "empty") {result = emptyText(); count = 0; continue;}
      if (job.op === "scalar") {result = await this.text.from(this.tree.scalarChunks(job.node)); count = 1; continue;}
      if (job.op === "post") {
        if (job.mode === "wrap" && !(this.options.wrap === "none" || this.options.wrap === "preserve" || this.options.wrap === undefined && this.options.columns === undefined))
          result = await this.text.wrap(result, this.options.columns ?? 72);
        if (job.mode === "code" && result.units) result = await this.text.indent(await this.text.trimFinalNewline(result), "    ", "    ");
        if (job.mode === "indent") result = result.units ? await this.text.indent(result, job.first!, job.rest!) : await this.text.from([job.empty ?? ""]);
        if (job.mode === "surround") {
          const output = await this.text.from([job.first!]); await this.text.append(output, result); await this.text.append(output, await this.text.from([job.rest!])); result = output;
        }
        if (job.mode === "image") {
          if (!result.units) result = await this.text.from([" "]);
          const title = await this.text.from(this.tree.scalarChunks(job.title!));
          if (title.units) {await this.text.append(result, await this.text.from([' "'])); await this.text.append(result, title); await this.text.append(result, await this.text.from(['"']));}
        }
        if (job.setCount !== undefined) count = job.setCount;
        continue;
      }
      if (job.op === "list" || job.op === "parts") {
        if (!job.stage) {
          job.text = emptyText(); job.count = 0; job.index = 0;
          if (job.op === "list") {job.cursor = job.node + 32; job.end = (await this.tree.describe(job.node)).end;}
        } else {
          const include = job.byCount ? count > 0 : job.skip ? result.units > 0 : true;
          if (include) {
            if (job.count) {
              const separator = job.mode === "block" ? job.previous === "Plain" ? "\n" : "\n\n" : job.sep!;
              await this.text.append(job.text!, await this.text.from([separator]));
            }
            await this.text.append(job.text!, result);
            job.count! += job.byCount ? count : 1;
            if (job.tag !== undefined) job.previous = job.tag;
          }
          job.index!++;
        }
        let child: Job | undefined;
        if (job.op === "parts") child = job.parts![job.index!];
        else if (job.cursor! < job.end!) {
          const node = job.cursor!, path = await this.path(job.path, `[${job.index}]`);
          job.cursor = (await this.tree.describe(node)).end;
          if (job.mode === "block") job.tag = await this.tag(node);
          child = {op: job.mode!, node, path, index: job.index!, ...(job.start === undefined ? {} : {start: job.start})};
        }
        if (child) {job.stage = 1; await this.push(job); await this.push(child);}
        else {result = job.text!; count = job.count!;}
        continue;
      }
      if (job.op === "blocks" || job.op === "inlines" || job.op === "rows") {
        await this.push(this.list(job.node, job.path, job.op === "blocks" ? "block" : job.op === "inlines" ? "inline" : "row", job.op === "rows" ? "\n" : "", job.op === "blocks"));
        continue;
      }
      const part = async (op: string, index: number): Promise<Job> => ({op, node: await this.at(job.node, index), path: await this.path(job.path, `[${index}]`)});
      if (job.op === "caption") {
        const short = await part("inlines", 0);
        if ((await this.tree.describe(short.node)).kind !== "array") short.op = "empty";
        await this.push({...job, op: "parts", parts: [short, await part("blocks", 1)], sep: "\n\n", skip: true});
        continue;
      }
      if (job.op === "item") {
        const marker = job.start === undefined ? "-" : `${job.start + job.index!}.`;
        const prefix = job.start === undefined ? "- " : marker + " ".repeat(Math.max(1, 4 - marker.length));
        await this.push({...this.post(job.node, job.path, "indent"), first: prefix, rest: " ".repeat(prefix.length), empty: marker});
        await this.push({...job, op: "blocks"}); continue;
      }
      if (job.op === "definition") {
        const term = await part("term", 0), definitions = await part("definitions", 1);
        await this.push({...job, op: "parts", parts: [term, definitions], sep: "\n", byCount: true}); continue;
      }
      if (job.op === "term" || job.op === "definitionBody") {
        await this.push({...this.post(job.node, job.path, job.op === "term" ? "count" : "indent"), first: "  ", rest: "  ", setCount: 1});
        await this.push({...job, op: job.op === "term" ? "inlines" : "blocks"}); continue;
      }
      if (job.op === "definitions") {await this.push(this.list(job.node, job.path, "definitionBody", "\n")); continue;}
      if (job.op === "row") {
        await this.push({...this.post(job.node, job.path, "count"), setCount: 1});
        const cells = await part("cells", 1); await this.push(this.list(cells.node, cells.path, "cell", "\t")); continue;
      }
      if (job.op === "cell") {
        if (await this.number(await this.at(job.node, 2)) !== 1 || await this.number(await this.at(job.node, 3)) !== 1) {
          if (!this.options.lossy) await this.fail(job.path, "Flattened cell span");
          this.context.report({code: "W_TABLE_LOSS", operation: "convert", format: "plain", location: await this.location(job.path), message: "Flattened cell span"});
        }
        await this.push(await part("blocks", 4)); continue;
      }
      if (job.op === "body") {
        await this.push({...job, op: "parts", parts: [await part("rows", 2), await part("rows", 3)], sep: "\n", byCount: true}); continue;
      }
      if (job.op === "tableRows") {
        const head = await part("head", 3), bodies = await part("bodies", 4), foot = await part("foot", 5);
        const rows = async (section: Job): Promise<Job> => ({op: "rows", node: await this.at(section.node, 1), path: await this.path(section.path, "[1]")});
        await this.push({...job, op: "parts", parts: [await rows(head), {...this.list(bodies.node, bodies.path, "body", "\n", false, true)}, await rows(foot)], sep: "\n", byCount: true}); continue;
      }
      if (job.op === "block" || job.op === "inline") {
        const tag = await this.tag(job.node), content = await this.tree.property(job.node, "c");
        const cp = await this.path(job.path, ".c");
        const contentPart = async (op: string, index: number): Promise<Job> => ({op, node: await this.at(content!, index), path: await this.path(cp, `[${index}]`)});
        if (["Str", "Space", "SoftBreak", "LineBreak", "HorizontalRule"].includes(tag)) {
          result = tag === "Str" ? await this.text.from(this.tree.scalarChunks(content!)) : await this.text.from([tag === "Space" ? " " : tag === "SoftBreak" ? this.options.wrap === "preserve" ? "\n" : " " : tag === "HorizontalRule" ? "-".repeat(72) : "\n"]);
          count = 1; continue;
        }
        if (tag === "Math" || tag === "Cite") await this.fail(job.path, tag === "Math" ? "Plain cannot preserve math meaning" : "Plain cannot resolve citation meaning");
        if (tag === "RawInline" || tag === "RawBlock") {
          if (!this.options.rawContent || this.options.rawContent === "reject") await this.fail(job.path, "Plain cannot interpret raw content; use an explicit rawContent source policy");
          this.context.report({code: "W_RAW_CONTENT", operation: "convert", format: "plain", location: await this.location(job.path), message: "Raw source retained verbatim; its meaning is unsupported"});
          result = await this.text.from(this.tree.scalarChunks(await this.at(content!, 1)));
          if (!result.units) result = await this.text.from([" "]);
          count = 1; continue;
        }
        if (tag === "Code" || tag === "CodeBlock") {
          if (tag === "CodeBlock") await this.push(this.post(job.node, job.path, "code"));
          await this.push(await contentPart("scalar", 1)); continue;
        }
        if (tag === "Quoted") {
          const quote = await this.tag(await this.at(content!, 0)) === "DoubleQuote" ? '"' : "'";
          await this.push({...this.post(job.node, job.path, "surround"), first: quote, rest: quote});
          await this.push(await contentPart("inlines", 1)); continue;
        }
        if (tag === "Image") {
          await this.push({...this.post(job.node, job.path, "image"), title: await this.at(await this.at(content!, 2), 1)});
          await this.push(await contentPart("inlines", 1)); continue;
        }
        if (tag === "Note") {
          await this.push({...this.post(job.node, job.path, "surround"), first: "[note: ", rest: "]"});
          await this.push({op: "blocks", node: content!, path: cp}); continue;
        }
        if (tag === "Link" || tag === "Span" || tag === "Header" || tag === "Div") {
          await this.push(await contentPart(tag === "Div" ? "blocks" : "inlines", tag === "Header" ? 2 : 1)); continue;
        }
        if (tag === "Plain" || tag === "Para") {
          await this.push(this.post(job.node, job.path, "wrap")); await this.push({op: "inlines", node: content!, path: cp}); continue;
        }
        if (tag === "BlockQuote") {
          await this.push({...this.post(job.node, job.path, "indent"), first: "  ", rest: "  "});
          await this.push({op: "blocks", node: content!, path: cp}); continue;
        }
        if (tag === "LineBlock" || tag === "BulletList" || tag === "OrderedList" || tag === "DefinitionList") {
          const ordered = tag === "OrderedList", node = ordered ? await this.at(content!, 1) : content!, path = ordered ? await this.path(cp, "[1]") : cp;
          const list = this.list(node, path, tag === "LineBlock" ? "inlines" : tag === "DefinitionList" ? "definition" : "item", tag === "DefinitionList" ? "\n\n" : "\n");
          if (ordered) list.start = await this.number(await this.at(await this.at(content!, 0), 0));
          await this.push(list); continue;
        }
        if (tag === "Figure" || tag === "Table") {
          const caption = await contentPart("caption", 1);
          const body = tag === "Figure" ? await contentPart("blocks", 2) : {op: "tableRows", node: content!, path: cp};
          // Table always includes its rows after a nonempty caption, even if empty.
          await this.push({op: tag === "Table" ? "table" : "parts", node: content!, path: cp, parts: [body, caption], sep: tag === "Figure" ? "\n\n" : "\n", skip: true}); continue;
        }
        await this.push({op: "inlines", node: content!, path: cp}); continue;
      }
      if (job.op === "table") {
        if (!job.stage) {await this.push({...job, stage: 1}); await this.push(job.parts![0]!);}
        else if (job.stage === 1) {await this.push({...job, stage: 2, text: result}); await this.push(job.parts![1]!);}
        else {if (result.units) await this.text.append(result, await this.text.from(["\n"])); await this.text.append(result, job.text!); count = 1;}
        continue;
      }
      throw new Error(`Unknown retained plain job: ${job.op}`);
    }
    await this.text.append(result, await this.text.from(["\n"]));
    return result;
  }
}

export async function writeRetainedPlain(tree: BackedJson, order: Awaited<ReturnType<typeof backedJsonOrder>>, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions): Promise<void> {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close());
  let failure: {reason: unknown} | undefined;
  try {
    const writer = new PlainTape(tree, order, storage, context, options), result = await writer.render();
    const diagnostics = context.snapshotDiagnostics();
    if (options.failIfWarnings && diagnostics.length) {
      const first = diagnostics[0]!;
      throw new PandocError("E_WARNINGS", "convert", `Warnings rejected: ${first.code}: ${first.message}`, first.format, first.location);
    }
    const chunks = async function* () {
      const encoder = new TextEncoder(); let pending = "";
      for await (const chunk of writer.text.chunks(result)) {
        let text = pending + chunk;
        const last = text.charCodeAt(text.length - 1), end = last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length;
        pending = text.slice(end); text = text.slice(0, end);
        if (options.eol === "crlf") text = text.split("\n").join("\r\n");
        if (text) yield encoder.encode(text);
      }
      if (pending) yield encoder.encode(pending);
    };
    if (Number.isFinite(context.limits.outputBytes)) {
      let length = 0; for await (const bytes of chunks()) {length += bytes.length; context.bound("outputBytes", length);}
    }
    for await (const bytes of chunks()) await context.emit(bytes);
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};}
  finally {release();}
  if (failure) throw failure.reason;
}
