import type {backedJsonOrder} from "./backed-json-order.js";
import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {readJsonNumber} from "./json-number.js";
import {PandocError} from "./errors.js";

import {formatting, languages, mathCommands} from "./latex-profile.js";

type Job = {
  op: string; node: number; path: number; mode?: string; cursor?: number; index?: number; end?: number;
  value?: string; columns?: number; width?: number; column?: number; occupancy?: number; row?: number;
  stage?: number; count?: number; parentPath?: number;
};

/** Output, continuations, labels, note queues and table occupancy use caller pages. */
class LatexTape {
  readonly text: BackedText;
  private output = emptyText();
  private replay: TextRange | undefined;
  private top = 0;
  private readonly keys: BackedTextSet;
  private readonly labels: IntegerTable;
  private readonly targets: IntegerTable;
  private readonly counts: IntegerTable;
  private noteFirst = 0;
  private noteLast = 0;
  private noteCount = 0;
  private printedNotes = 0;
  private tableDepth = 0;
  private figureDepth = 0;
  private noteDepth = 0;
  private listDepth = 0;
  private heading = 0;
  constructor(private readonly tree: BackedJson, private readonly storage: PagedStorage,
    private readonly context: ExecutionContext, private readonly options: ConversionOptions, private readonly order: Awaited<ReturnType<typeof backedJsonOrder>>) {
    this.text = new BackedText(storage, units => context.cooperate(units));
    this.keys = new BackedTextSet(storage, this.text);
    this.labels = new IntegerTable(storage, 64); this.targets = new IntegerTable(storage, 64); this.counts = new IntegerTable(storage, 64);
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
  private async path(parent: number, suffix: string): Promise<number> {return this.record({parent, suffix});}
  private async location(path: number): Promise<string | undefined> {
    if (!path) return undefined;
    let result = "";
    while (path) {const value = await this.read<{parent: number; suffix: string}>(path); result = value.suffix + result; path = value.parent; await this.context.cooperate();}
    return result;
  }
  private async fail(message: string, path = 0, code: "E_UNSUPPORTED_FEATURE" | "E_OPTION" = "E_UNSUPPORTED_FEATURE"): Promise<never> {
    throw new PandocError(code, "convert", message, "latex", await this.location(path));
  }
  private async at(node: number, index: number): Promise<number> {
    let child = node + 32;
    for (let i = 0; i < index; i++) {child = (await this.tree.describe(child)).end; await this.context.cooperate();}
    return child;
  }
  private async count(node: number): Promise<number> {return (await this.tree.describe(node)).children;}
  private async scalar(node: number): Promise<TextRange> {return this.text.from(this.tree.scalarChunks(node));}
  private async tag(node: number): Promise<string> {return (await this.tree.smallText((await this.tree.property(node, "t"))!, 32))!;}
  private async number(node: number): Promise<number> {return readJsonNumber(this.tree.scalarChunks(node), units => this.context.cooperate(units));}
  private async pointer(position: number): Promise<number> {
    const bytes = await this.storage.read(position, 8); return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  private async put(position: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); await this.storage.write(position, bytes);
  }
  private async add(value: string | TextRange, label = false): Promise<void> {
    await this.text.append(this.output, await this.text.from(typeof value === "string" ? [value] : this.text.chunks(value)));
    if (this.replay && !label) await this.text.append(this.replay, await this.text.from(typeof value === "string" ? [value] : this.text.chunks(value)));
  }
  private async loss(message: string, path: number): Promise<void> {
    if (!this.options.lossy) await this.fail(message, path);
    this.context.report({code: "W_TABLE_LOSS", operation: "convert", format: "latex", location: await this.location(path), message});
  }
  private async present(node: number): Promise<boolean> {
    return (await this.tree.describe(node + 32)).end > node + 64 || !!await this.count(await this.at(node, 1)) || !!await this.count(await this.at(node, 2));
  }
  private async attrs(node: number, path: number, language = false): Promise<void> {
    if (await this.count(await this.at(node, 1)) && !language || await this.count(await this.at(node, 2))) await this.loss("Unsupported LaTeX attributes", path);
    const label = Number(await this.labels.get(BigInt(node)) ?? 0n);
    if (label) {
      // Keep the complete label in a distinct stream so repeated table heads can omit it.
      const value = await this.text.from(["\\phantomsection\\label{"]);
      await this.text.append(value, await this.text.from(this.text.chunks(await this.read<TextRange>(label))));
      await this.text.append(value, await this.text.from(["}"])); await this.add(value, true);
    }
  }
  private async escape(value: TextRange, code = false): Promise<void> {
    let buffer = "";
    for await (const chunk of this.text.unicodeChunks(value)) for (const char of chunk) {
      if (char.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(char) || char.charCodeAt(0) === 127) await this.fail("Unrepresentable LaTeX control character");
      if (code && "\\{}#$%&_~^".includes(char)) buffer += `\\char"${char.codePointAt(0)!.toString(16).toUpperCase()}{}`;
      else if (code && (char === " " || char === "\t")) buffer += char === " " ? "\\ " : "\\ \\ \\ \\ ";
      else buffer += ({"#": "\\#", "$": "\\$", "%": "\\%", "&": "\\&", "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}", "\\": "\\textbackslash{}", "\r": " ", "\n": " ", "\t": " "} as Record<string, string>)[char] ?? char;
      if (buffer.length >= 4096) {await this.add(buffer); buffer = "";}
    }
    if (buffer) await this.add(buffer);
  }
  private async raw(node: number, path: number): Promise<void> {
    if (this.options.rawContent === "reject") await this.fail("Raw content rejected by explicit policy", path);
    if (this.options.rawContent === "retain") await this.fail("Executable raw LaTeX cannot be retained", path);
    if (this.options.rawContent !== "escape") await this.loss("Escaped unsupported raw content", path);
    await this.escape(await this.scalar(node));
  }
  private async edges(value: TextRange): Promise<{first: string; last: string}> {
    let first = "", last = ""; for await (const chunk of this.text.chunks(value)) {first ||= chunk[0] ?? ""; last = chunk.slice(-1);} return {first, last};
  }
  private async url(value: TextRange, path: number): Promise<void> {
    const edges = await this.edges(value);
    if (value.units && (!edges.first.trim() || !edges.last.trim())) await this.fail("Unsafe URL characters", path);
    let scheme = "", boundary = false, colon = false;
    for await (const chunk of this.text.unicodeChunks(value)) for (const char of chunk) {
      if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || "\\{}".includes(char)) await this.fail("Unsafe URL characters", path);
      if (!boundary && !colon) {
        if ("/?#".includes(char)) boundary = true;
        else if (char === ":") colon = true;
        else if (scheme.length <= 6) scheme += char;
      }
    }
    if (colon && !["http", "https", "mailto", "tel"].includes(scheme.toLowerCase())) await this.fail("Unsupported URI scheme", path);
    let buffer = "";
    for await (const chunk of this.text.unicodeChunks(value)) for (const char of chunk) {
      buffer += ({"%": "\\%", "#": "\\#", "&": "\\&", "_": "\\_"} as Record<string, string>)[char] ?? (" ~^\"<>`".includes(char) ? encodeURIComponent(char).split("%").join("\\%") : char);
      if (buffer.length >= 4096) {await this.add(buffer); buffer = "";}
    }
    if (buffer) await this.add(buffer);
  }
  private async image(node: number, path: number): Promise<void> {
    const value = await this.scalar(node), edges = await this.edges(value);
    if (!value.units || !edges.first.trim() || !edges.last.trim()) await this.fail("Unsafe or nonlocal image path", path);
    let segment = "";
    for await (const chunk of this.text.chunks(value)) for (const char of chunk) {
      if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || "\\{}%#$~^|:\"".includes(char)) await this.fail("Unsafe or nonlocal image path", path);
      if (char === "/") {if (segment === "..") await this.fail("Unsafe or nonlocal image path", path); segment = "";}
      else if (segment.length < 3) segment += char;
    }
    if (segment === "..") await this.fail("Unsafe or nonlocal image path", path);
    await this.add("\\includegraphics{\\detokenize{"); await this.add(value); await this.add("}}");
  }
  private async math(node: number, path: number): Promise<void> {
    const value = await this.scalar(node);
    if (await this.text.includes(value, await this.text.from(["^^"]))) await this.fail("Unsafe TeX superscript preprocessing", path);
    let depth = 0, slash = false, name = ""; const longName = emptyText();
    const command = async () => {
      if (longName.units || !mathCommands.has(name)) {
        let full = ""; for await (const chunk of this.text.chunks(longName)) full += chunk;
        await this.fail(`Unsupported executable math command: ${full + name}`, path);
      }
      name = ""; slash = false;
    };
    for await (const chunk of this.text.chunks(value)) for (const char of chunk) {
      if (slash) {
        if (char >= "a" && char <= "z" || char >= "A" && char <= "Z") {
          name += char;
          if (name.length >= 4096) {await this.text.append(longName, await this.text.from([name])); name = "";}
          continue;
        }
        if (name || longName.units) await command();
        else {slash = false; if (!"{}_%&#$ ,;:!|\\".includes(char)) await this.fail("Unsafe math delimiter or command", path); continue;}
      }
      if (char === "\\") slash = true;
      else if (char === "{") depth++;
      else if (char === "}") {if (--depth < 0) await this.fail("Unbalanced math source", path);}
      else if ("$%#".includes(char) || char.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(char)) await this.fail("Unsafe math source", path);
    }
    if (slash) {if (name || longName.units) await command(); else await this.fail("Unsafe math delimiter or command", path);}
    if (depth) await this.fail("Unbalanced math source", path);
    await this.add(value);
  }
  private async reserve(node: number): Promise<void> {
    await this.push({op: "reserve", node, path: 0});
    while (this.top) {
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent; const job = frame.job;
      await this.context.cooperate();
      if (job.op === "reserveNext") {
        if (job.node < job.end!) {await this.push({...job, node: (await this.tree.describe(job.node)).end}); await this.push({op: "reserve", node: job.node, path: 0});} continue;
      }
      if (job.op === "reserveObject") {
        if (!job.cursor) continue;
        const value = (await this.tree.describe(job.cursor)).end;
        await this.push({...job, cursor: await this.order.next(value, job.node)});
        await this.push({op: "reserve", node: value, path: 0}); continue;
      }
      if (job.op === "reserveRows" || job.op === "reserveBodies") {
        if (!job.cursor) job.cursor = job.node + 32;
        if (job.cursor >= (await this.tree.describe(job.node)).end) continue;
        const current = job.cursor; await this.push({...job, cursor: (await this.tree.describe(current)).end});
        if (job.op === "reserveBodies") {
          await this.sequence({op: "reserveRows", node: await this.at(current, 2), path: 0}, {op: "reserveRows", node: await this.at(current, 3), path: 0});
        } else {
          const cells = await this.at(current, 1);
          await this.push({op: "reserveCells", node: cells, path: 0, cursor: cells + 32});
        }
        continue;
      }
      if (job.op === "reserveCells") {
        if (job.cursor! >= (await this.tree.describe(job.node)).end) continue;
        const cell = job.cursor!; await this.push({...job, cursor: (await this.tree.describe(cell)).end});
        await this.sequence({op: "reserve", node: cell + 32, path: 0}, {op: "reserve", node: await this.at(cell, 4), path: 0}); continue;
      }
      const header = await this.tree.describe(job.node);
      if (header.kind === "object") {
        const tag = await this.tree.property(job.node, "t");
        if (tag !== undefined && await this.tree.smallText(tag, 5) === "Table") {
          const content = (await this.tree.property(job.node, "c"))!, head = await this.at(content, 3), foot = await this.at(content, 5);
          await this.sequence({op: "reserve", node: content + 32, path: 0}, {op: "reserve", node: await this.at(content, 1), path: 0},
            {op: "reserveRows", node: await this.at(head, 1), path: 0}, {op: "reserveBodies", node: await this.at(content, 4), path: 0}, {op: "reserveRows", node: await this.at(foot, 1), path: 0}); continue;
        }
      }
      if (header.kind === "array" && header.children === 3 && (await this.tree.describe(job.node + 32)).kind === "string"
        && (await this.tree.describe(await this.at(job.node, 1))).kind === "array" && (await this.tree.describe(await this.at(job.node, 2))).kind === "array") {
        const source = await this.scalar(job.node + 32);
        if (source.units) {
          const identity = BigInt(await this.keys.add(source)), count = Number(await this.counts.get(identity) ?? 0n) + 1;
          await this.counts.set(identity, BigInt(count));
          const label = await this.text.from(["pc"]); let buffer = "";
          for await (const chunk of this.text.unicodeChunks(source)) for (const char of chunk) {
            buffer += "-" + char.codePointAt(0)!.toString(16);
            if (buffer.length >= 4096) {await this.text.append(label, await this.text.from([buffer])); buffer = "";}
          }
          if (buffer) await this.text.append(label, await this.text.from([buffer]));
          if (count > 1) await this.text.append(label, await this.text.from(["-dup-" + count]));
          const record = BigInt(await this.record(label)); await this.labels.set(BigInt(job.node), record);
          if (count === 1) await this.targets.set(identity, record);
        }
      }
      if (header.kind === "array") await this.push({op: "reserveNext", node: job.node + 32, path: 0, end: header.end});
      else if (header.kind === "object" && header.children) await this.push({op: "reserveObject", node: job.node, path: 0, cursor: await this.order.first(job.node)});
    }
  }
  private async note(node: number, path: number): Promise<void> {
    const pos = this.storage.allocate(24); await this.put(pos, 0); await this.put(pos + 8, node); await this.put(pos + 16, path);
    if (this.noteLast) await this.put(this.noteLast, pos); else this.noteFirst = pos;
    this.noteLast = pos;
    await this.add("\\protect\\footnotemark[" + ++this.noteCount + "]");
  }
  private async task(node: number): Promise<boolean | undefined> {
    const attr = node + 32;
    if (await this.count(await this.at(node, 1)) || (await this.tree.describe(attr + 32)).end > attr + 64) return undefined;
    const classes = await this.at(attr, 1), pairs = await this.at(attr, 2);
    if (await this.count(classes) !== 1 || await this.tree.smallText(classes + 32, 16) !== "task-list-marker" || await this.count(pairs) !== 1 || await this.tree.smallText(pairs + 64, 7) !== "checked") return undefined;
    const state = await this.tree.smallText(await this.at(pairs + 32, 1), 5); return state === "true" ? true : state === "false" ? false : undefined;
  }
  private async metadata(meta: number, key: string): Promise<Job> {
    const node = await this.tree.property(meta, key), path = await this.path(0, "$.metadata." + key);
    if (node === undefined) return this.literal("");
    const tag = await this.tag(node), content = (await this.tree.property(node, "c"))!;
    if (tag === "MetaString") return {op: "escape", node: content, path};
    if (tag === "MetaInlines") return this.list(content, path, "inline");
    return this.fail(key + " metadata must be text or inlines", path, "E_OPTION");
  }
  async render(): Promise<TextRange> {
    const blocks = (await this.tree.property(this.tree.rootPosition, "blocks"))!, meta = (await this.tree.property(this.tree.rootPosition, "meta"))!;
    await this.reserve(blocks); await this.reserve(meta);
    const lang = await this.tree.property(meta, "lang"), dir = await this.tree.property(meta, "dir"), langPath = await this.path(0, "$.metadata.lang");
    if (lang !== undefined && await this.tag(lang) !== "MetaString") await this.fail("lang metadata must be a string", langPath, "E_OPTION");
    const language = lang === undefined ? "en" : await this.tree.smallText((await this.tree.property(lang, "c"))!, 8);
    if (!language || !languages[language]) await this.fail("Unsupported LaTeX language", langPath, "E_OPTION");
    if (dir !== undefined && (await this.tag(dir) !== "MetaString" || await this.tree.smallText((await this.tree.property(dir, "c"))!, 3) !== "ltr")) await this.fail("Unsupported LaTeX direction", await this.path(0, "$.metadata.dir"), "E_OPTION");
    if (this.options.standalone) {
      await this.add("\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\usepackage[" + languages[language!] + "]{babel}\n\\usepackage{amsmath,amssymb}\n\\usepackage{graphicx}\n\\usepackage{array,longtable,multirow}\n\\usepackage{enumitem}\n\\usepackage[normalem]{ulem}\n\\usepackage{hyperref}\n");
      await this.push(this.literal("\\end{document}\n"));
    } else if (lang !== undefined) {
      await this.add("\\begin{otherlanguage}{" + languages[language!] + "}\n"); await this.push(this.literal("\\end{otherlanguage}\n"));
    }
    await this.push({op: "flushNotes", node: 0, path: 0});
    await this.push(this.list(blocks, await this.path(0, "$.blocks"), "block", {value: "root"}));
    if (this.options.standalone) {
      await this.push(this.literal("\\begin{document}\n" + (await this.tree.property(meta, "title") !== undefined ? "\\maketitle\n" : "")));
      for (const key of ["date", "author", "title"]) await this.sequence(this.literal("\\" + key + "{"), {op: "metadata", node: meta, path: 0, value: key}, this.literal("}\n"));
    }
    while (this.top) {
      await this.context.cooperate();
      const frame = await this.read<{parent: number; job: Job}>(this.top); this.top = frame.parent; const job = frame.job;
      const part = async (index: number): Promise<{node: number; path: number}> => ({node: await this.at(job.node, index), path: await this.path(job.path, "[" + index + "]")});
      if (job.op === "literal") {await this.add(job.value!); continue;}
      if (job.op === "metadata") {await this.push(await this.metadata(job.node, job.value!)); continue;}
      if (job.op === "escape") {await this.escape(await this.scalar(job.node)); continue;}
      if (job.op === "list") {
        const cursor = job.cursor ?? job.node + 32, index = job.index ?? 0;
        if (cursor >= (await this.tree.describe(job.node)).end) continue;
        await this.push({...job, cursor: (await this.tree.describe(cursor)).end, index: index + 1});
        if (job.value === "root") await this.push({op: "flushNotes", node: 0, path: 0});
        await this.push({...job, op: job.mode!, node: cursor, path: await this.path(job.path, "[" + index + "]"), index}); continue;
      }
      if (job.op === "flushNotes") {
        if (!this.noteFirst) continue;
        const pos = this.noteFirst, node = await this.pointer(pos + 8), path = await this.pointer(pos + 16);
        this.noteDepth++; await this.add("\\footnotetext[" + ++this.printedNotes + "]{");
        await this.sequence(this.list(node, path, "block"), {op: "endNote", node: pos, path}); continue;
      }
      if (job.op === "endNote") {
        this.noteDepth--; await this.add("}\n"); this.noteFirst = await this.pointer(job.node);
        if (!this.noteFirst) this.noteLast = 0;
        await this.push({op: "flushNotes", node: 0, path: 0}); continue;
      }
      if (job.op === "attrs") {await this.attrs(job.node, job.path, job.value === "language"); continue;}
      if (job.op === "endList") {this.listDepth--; await this.add("\\end{" + job.value + "}\n\n"); continue;}
      if (job.op === "endFigure") {this.figureDepth--; await this.add("\n\\end{figure}\n\n"); continue;}
      if (job.op === "headingEnd") {
        await this.add("}"); await this.attrs(job.node, job.path);
        if ((await this.tree.describe(job.node + 32)).end === job.node + 64) await this.add("\\label{pc-section-" + ++this.heading + "}", true);
        await this.add("\n\n"); continue;
      }
      if (job.op === "item") {await this.add("\\item "); await this.push(this.list(job.node, job.path, "block")); continue;}
      if (job.op === "definition") {
        const term = await part(0), defs = await part(1);
        await this.sequence(this.literal("\\item[{"), this.list(term.node, term.path, "inline"), this.literal("}] "), this.list(defs.node, defs.path, "definitionBody")); continue;
      }
      if (job.op === "definitionBody") {await this.push(this.list(job.node, job.path, "block")); continue;}
      if (job.op === "line") {if (job.index) await this.add("\\\\\n"); await this.add("\\strut{}"); await this.push(this.list(job.node, job.path, "inline")); continue;}
      if (job.op === "caption") {
        const long = await this.at(job.node, 1);
        if (await this.count(long)) await this.push(this.list(long, await this.path(job.path, "[1]"), "captionBlock"));
        else if ((await this.tree.describe(job.node + 32)).kind === "array") await this.push(this.list(job.node + 32, await this.path(job.path, "[0]"), "inline"));
        continue;
      }
      if (job.op === "captionBlock") {
        if (job.index) await this.add(" ");
        const tag = await this.tag(job.node);
        if (tag === "Plain" || tag === "Para") await this.push(this.list((await this.tree.property(job.node, "c"))!, await this.path(job.path, ".c"), "inline"));
        else {
          const pathPart = await this.read<{parent: number}>(job.path), parent = await this.read<{parent: number}>(pathPart.parent);
          await this.loss("Unsupported block caption", parent.parent); await this.add(tag);
        }
        continue;
      }
      if (job.op !== "block" && job.op !== "inline") {await this.table(job); continue;}
      const tag = await this.tag(job.node), content = await this.tree.property(job.node, "c"), cp = await this.path(job.path, ".c");
      const child = async (index: number, mode: string): Promise<Job> => this.list(await this.at(content!, index), await this.path(cp, "[" + index + "]"), mode);
      const attr = async (index: number, language = false): Promise<void> => this.attrs(await this.at(content!, index), await this.path(cp, "[" + index + "]"), language);
      if (tag === "Str") {await this.escape(await this.scalar(content!)); continue;}
      if (tag === "Space" || tag === "SoftBreak") {await this.add(" "); continue;}
      if (tag === "LineBreak") {await this.add("\\protect\\newline{}\n"); continue;}
      if (formatting[tag]) {await this.sequence(this.literal("\\" + formatting[tag] + "{"), this.list(content!, cp, "inline"), this.literal("}")); continue;}
      if (tag === "Quoted") {const single = await this.tag(content! + 32) === "SingleQuote"; await this.sequence(this.literal(single ? "\x60" : "\x60\x60"), await child(1, "inline"), this.literal(single ? "'" : "''")); continue;}
      if (tag === "Cite") {if (await this.count(content! + 32)) await this.loss("Projected unsupported citation to display text", job.path); await this.push(await child(1, "inline")); continue;}
      if (tag === "Code") {await this.attrs(content! + 32, job.path); await this.add("\\texttt{"); await this.escape(await this.scalar(await this.at(content!, 1)), true); await this.add("}"); continue;}
      if (tag === "Math") {const inline = await this.tag(content! + 32) === "InlineMath"; await this.add(inline ? "\\(" : "\\["); await this.math(await this.at(content!, 1), job.path); await this.add(inline ? "\\)" : "\\]"); continue;}
      if (tag === "RawInline" || tag === "RawBlock") {await this.raw(await this.at(content!, 1), job.path); if (tag === "RawBlock") await this.add("\n\n"); continue;}
      if (tag === "Span") {
        const task = await this.task(content!); if (task !== undefined) {await this.add(task ? "☒ " : "☐ "); continue;}
        await this.attrs(content! + 32, job.path); await this.sequence(this.literal("{"), await child(1, "inline"), this.literal("}")); continue;
      }
      if (tag === "Note") {await this.note(content!, cp); continue;}
      if (tag === "Link" || tag === "Image") {
        await this.attrs(content! + 32, job.path); const target = await this.at(content!, 2);
        if ((await this.tree.describe(await this.at(target, 1))).end > await this.at(target, 1) + 32) await this.loss(tag === "Link" ? "Dropped link title" : "Dropped image title", job.path);
        if (tag === "Image") {await this.image(target + 32, job.path); continue;}
        const value = await this.scalar(target + 32);
        if ((await this.edges(value)).first === "#") {
          const source = this.text.chunks(value), key = await this.text.from((async function* () {let first = true; for await (const chunk of source) {yield first ? chunk.slice(1) : chunk; first = false;}})());
          const label = Number(await this.targets.get(BigInt(await this.keys.add(key))) ?? 0n);
          if (!label) {await this.loss("Unresolved internal reference projected to text", job.path); await this.push(await child(1, "inline")); continue;}
          await this.add("\\hyperref["); await this.add(await this.read<TextRange>(label)); await this.add("]{");
        } else {await this.add("\\href{"); await this.url(value, job.path); await this.add("}{");}
        await this.sequence(await child(1, "inline"), this.literal("}")); continue;
      }
      if (tag === "Plain" || tag === "Para") {await this.sequence(this.list(content!, cp, "inline"), this.literal(this.tableDepth ? "\\par " : tag === "Para" ? "\n\n" : "\n")); continue;}
      if (tag === "Header") {
        const level = await this.number(content! + 32); if (level > 5) await this.loss("Heading level projected to subparagraph", job.path);
        await this.add("\\" + ["section", "subsection", "subsubsection", "paragraph", "subparagraph"][Math.min(level, 5) - 1] + "{");
        await this.sequence(await child(2, "inline"), {op: "headingEnd", node: await this.at(content!, 1), path: await this.path(cp, "[1]")}); continue;
      }
      if (tag === "CodeBlock") {
        await attr(0, true); await this.add("\\begin{flushleft}\\ttfamily\n\\mbox{");
        const source = await this.scalar(await this.at(content!, 1)); let line = emptyText();
        for await (const chunk of this.text.chunks(source)) {
          const parts = chunk.split("\n");
          for (let i = 0; i < parts.length; i++) {
            await this.text.append(line, await this.text.from([parts[i]!]));
            if (i < parts.length - 1) {await this.escape(line, true); line = emptyText(); await this.add("}\\\\\n\\mbox{");}
          }
        }
        await this.escape(line, true); await this.add("}\\\\\n\\end{flushleft}\n\n"); continue;
      }
      if (tag === "HorizontalRule") {await this.add("\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par\n"); continue;}
      if (tag === "BlockQuote") {await this.sequence(this.literal("\\begin{quote}\n"), this.list(content!, cp, "block"), this.literal("\\end{quote}\n\n")); continue;}
      if (tag === "Div") {await attr(0); await this.sequence(this.literal("{\n"), await child(1, "block"), this.literal("}\n")); continue;}
      if (tag === "BulletList" || tag === "OrderedList") {
        if (this.listDepth >= 4) await this.fail("LaTeX list nesting exceeds fixed profile", job.path);
        this.listDepth++; const ordered = tag === "OrderedList", env = ordered ? "enumerate" : "itemize"; await this.add("\\begin{" + env + "}");
        if (ordered) {
          const spec = content! + 32, start = await this.number(spec + 32), style = await this.tag(await this.at(spec, 1)), delim = await this.tag(await this.at(spec, 2));
          if (style === "Example") await this.loss("Example list numbering projected to decimal", job.path);
          const counter = ({DefaultStyle: "arabic", Example: "arabic", Decimal: "arabic", LowerRoman: "roman", UpperRoman: "Roman", LowerAlpha: "alph", UpperAlpha: "Alph"} as Record<string, string>)[style];
          await this.add("[start=" + start + ",label=" + (delim === "TwoParens" ? "(" : "") + "\\" + counter + "*" + (delim === "OneParen" || delim === "TwoParens" ? ")" : ".") + "]");
        }
        await this.add("\n");
        await this.sequence(ordered ? await child(1, "item") : this.list(content!, cp, "item"), {op: "endList", node: 0, path: 0, value: env}); continue;
      }
      if (tag === "DefinitionList") {await this.sequence(this.literal("\\begin{description}\n"), this.list(content!, cp, "definition"), this.literal("\\end{description}\n\n")); continue;}
      if (tag === "LineBlock") {await this.sequence(this.literal("\\begin{flushleft}\n"), this.list(content!, cp, "line"), this.literal("\n\\end{flushleft}\n\n")); continue;}
      if (tag === "Figure") {
        if (this.tableDepth || this.figureDepth || this.noteDepth) await this.fail("Floating figure requires an outer document context", job.path);
        this.figureDepth++; await this.add("\\begin{figure}[htbp]\n");
        await this.sequence(await child(2, "block"), this.literal("\\caption{"), {op: "caption", node: await this.at(content!, 1), path: await this.path(cp, "[1]")}, this.literal("}"), {op: "attrs", node: content! + 32, path: await this.path(cp, "[0]")}, {op: "endFigure", node: 0, path: 0}); continue;
      }
      if (tag === "Table") {await this.push({op: "table", node: content!, path: job.path}); continue;}
      throw new Error("Unknown LaTeX constructor " + tag);
    }
    const source = this.text.chunks(this.output);
    return this.text.from((async function* () {
      let newlines = 0;
      for await (const chunk of source) {
        let output = "";
        for (const char of chunk) {
          if (char === "\n") {newlines++; continue;}
          while (newlines) {const count = Math.min(newlines, 4096); if (output) {yield output; output = "";} yield "\n".repeat(count); newlines -= count;}
          output += char;
        }
        if (output) yield output;
      }
      yield "\n";
    })());
  }
  private column(align: string, fraction: number): string {
    const command = ({AlignDefault: "raggedright", AlignLeft: "raggedright", AlignRight: "raggedleft", AlignCenter: "centering"} as Record<string, string>)[align];
    return ">{\\" + command + "\\arraybackslash}p{\\dimexpr" + fraction.toFixed(6) + "\\linewidth-2\\tabcolsep\\relax}";
  }
  private async table(job: Job): Promise<void> {
    if (job.op === "table") {
      const cp = await this.path(job.path, ".c"), head = await this.at(job.node, 3), foot = await this.at(job.node, 5), bodies = await this.at(job.node, 4);
      if (this.figureDepth || this.noteDepth) await this.fail("Longtable requires an outer document context", job.path);
      if (this.tableDepth) {
        await this.loss("Nested table projected to cell text", job.path); await this.attrs(job.node + 32, await this.path(cp, "[0]"));
        await this.sequence(this.list(await this.at(head, 1), job.path, "flatRow", {parentPath: job.parentPath ?? job.path}), this.list(bodies, job.path, "flatBody", {parentPath: job.path}), this.list(await this.at(foot, 1), job.path, "flatRow", {parentPath: job.parentPath ?? job.path})); return;
      }
      this.tableDepth++; await this.attrs(job.node + 32, await this.path(cp, "[0]"));
      const cols = await this.at(job.node, 2), width = await this.count(cols), columns = this.storage.allocate(width * 16);
      if (!width) await this.fail("Empty table column specification", job.path);
      let total = 0, index = 0;
      for await (const col of this.tree.children(cols)) {
        const spec = await this.at(col, 1), value = await this.tag(spec) === "ColWidth" ? await this.number((await this.tree.property(spec, "c"))!) : 1 / width;
        await this.put(columns + index * 16, col); await this.put(columns + index * 16 + 8, value); total += value; index++; await this.context.cooperate();
      }
      await this.add("\\begin{longtable}{");
      for (let i = 0; i < width; i++) {
        const col = await this.pointer(columns + i * 16), value = await this.pointer(columns + i * 16 + 8) / total;
        await this.put(columns + i * 16 + 8, value); await this.add(this.column(await this.tag(col + 32), value));
      }
      await this.add("}\n");
      const caption = await this.at(job.node, 1);
      await this.push({...job, op: "tableHead", columns, width});
      if (await this.count(caption + 32) || await this.count(await this.at(caption, 1))) await this.sequence(this.literal("\\caption{"), {op: "caption", node: caption, path: await this.path(cp, "[1]")}, this.literal("} \\\\\n"));
      return;
    }
    if (job.op === "tableHead") {
      const head = await this.at(job.node, 3), cp = await this.path(job.path, ".c");
      this.replay = emptyText();
      if (await this.present(head + 32)) await this.loss("Dropped unsupported table head attributes", await this.path(cp, "[3][0]"));
      await this.sequence({...job, op: "rows", node: await this.at(head, 1), path: await this.path(cp, "[3][1]")}, {...job, op: "repeatHead"}); return;
    }
    if (job.op === "repeatHead") {
      const replay = this.replay!; this.replay = undefined;
      await this.add("\\endfirsthead\n"); await this.add(replay); await this.add("\\endhead\n\\endfoot\n");
      const foot = await this.at(job.node, 5), cp = await this.path(job.path, ".c");
      if (await this.present(foot + 32)) await this.loss("Dropped unsupported table foot attributes", await this.path(cp, "[5][0]"));
      await this.sequence({...job, op: "rows", node: await this.at(foot, 1), path: await this.path(cp, "[5][1]")},
        this.literal("\\endlastfoot\n"), this.list(await this.at(job.node, 4), await this.path(cp, "[4]"), "tableBody", {columns: job.columns!, width: job.width!}), {op: "endTable", node: 0, path: 0}); return;
    }
    if (job.op === "endTable") {await this.add("\\end{longtable}\n\n"); this.tableDepth--; return;}
    if (job.op === "tableBody") {
      if (await this.present(job.node + 32)) await this.loss("Dropped unsupported table body attributes", await this.path(job.path, "[0]"));
      await this.sequence({...job, op: "rows", node: await this.at(job.node, 2), path: await this.path(job.path, "[2]")},
        {...job, op: "rows", node: await this.at(job.node, 3), path: await this.path(job.path, "[3]")}); return;
    }
    if (job.op === "rows") {
      let i = 0;
      for await (const row of this.tree.children(job.node)) {
        if (await this.present(row + 32)) await this.loss("Dropped unsupported table row attributes", await this.path(job.path, "[" + i + "][0]"));
        i++; await this.context.cooperate();
      }
      await this.push(this.list(job.node, job.path, "row", {columns: job.columns!, width: job.width!, occupancy: this.storage.allocate(job.width! * 8)})); return;
    }
    if (job.op === "row") {
      const cells = await this.at(job.node, 1);
      await this.push({...job, op: "cells", node: cells, path: await this.path(job.path, "[1]"), cursor: cells + 32, row: job.index!, index: 0, column: 0}); return;
    }
    if (job.op === "cells") {
      const cell = job.cursor!;
      if (cell >= (await this.tree.describe(job.node)).end) {
        for (let col = job.column!; col < job.width!; col++) {if (col) await this.add(" & "); await this.context.cooperate();}
        await this.add(" \\\\\n"); return;
      }
      let col = job.column!;
      while (await this.pointer(job.occupancy! + col * 8) > job.row!) {if (col) await this.add(" & "); col++; await this.context.cooperate();}
      if (col) await this.add(" & ");
      const span = await this.number(await this.at(cell, 3)), rows = await this.number(await this.at(cell, 2));
      for (let i = 0; i < span; i++) {await this.put(job.occupancy! + (col + i) * 8, job.row! + rows); await this.context.cooperate();}
      const spec = await this.pointer(job.columns! + col * 16), columnAlign = await this.tag(spec + 32), cellAlign = await this.tag(await this.at(cell, 1)), align = cellAlign === "AlignDefault" ? columnAlign : cellAlign;
      const spanning = span > 1 || align !== columnAlign;
      if (spanning) {
        let width = 0;
        for (let i = 0; i < span; i++) {width += await this.pointer(job.columns! + (col + i) * 16 + 8); await this.context.cooperate();}
        await this.add("\\multicolumn{" + span + "}{" + this.column(align, width) + "}{");
      }
      if (rows > 1) await this.add("\\multirow{" + rows + "}{=}{");
      const path = await this.path(job.path, "[" + job.index + "]");
      await this.attrs(cell + 32, path);
      await this.sequence(this.list(await this.at(cell, 4), await this.path(path, "[4]"), "block"),
        this.literal((rows > 1 ? "}" : "") + (spanning ? "}" : "")),
        {...job, cursor: (await this.tree.describe(cell)).end, column: col + span, index: job.index! + 1}); return;
    }
    if (job.op === "flatBody") {
      await this.sequence(this.list(await this.at(job.node, 2), job.path, "flatRow", {parentPath: job.parentPath ?? job.path}), this.list(await this.at(job.node, 3), job.path, "flatRow", {parentPath: job.parentPath ?? job.path})); return;
    }
    if (job.op === "flatRow") {await this.push(this.list(await this.at(job.node, 1), job.path, "flatCell", {parentPath: job.parentPath!})); return;}
    if (job.op === "flatCell") {
      // The compatibility writer intentionally reports nested cell content at the enclosing table.
      await this.attrs(job.node + 32, job.parentPath!);
      await this.sequence(this.list(await this.at(job.node, 4), job.parentPath!, "block"), this.literal(" ")); return;
    }
    throw new Error("Unknown retained LaTeX job " + job.op);
  }
}

export async function writeRetainedLatex(tree: BackedJson, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions, order: Awaited<ReturnType<typeof backedJsonOrder>>): Promise<void> {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close()); let failure: {reason: unknown} | undefined;
  try {
    const writer = new LatexTape(tree, storage, context, options, order), result = await writer.render();
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
