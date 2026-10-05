import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {AdapterContext} from "safe-bash-markdown-engine/types";
import {asciiPunctuation, normalizeLabel} from "./commonmark-syntax.js";
import {RetainedCommonMarkLine} from "./retained-commonmark-line.js";
import {RetainedCommonMarkSyntax} from "./retained-commonmark-syntax.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";

const kinds = ["root", "paragraph", "heading", "thematicBreak", "code", "html", "quote", "list", "item", "table", "row", "footnote"] as const;
const fields = ["parent", "first", "last", "next", "previous", "startLine", "startColumn", "endLine", "endColumn", "firstLine", "lastLine", "lineCount", "infoStart", "infoEnd", "number", "marker", "tight", "blank"] as const;
type Field = typeof fields[number];
type Node = Record<Field, number> & {kind: typeof kinds[number]; info: SourceRange};
type Line = {position: number; range: SourceRange; line: number; column: number; next: number; alignment: number};
type Definition = {label: SourceRange; destination: SourceRange; title: SourceRange; startLine: number; startColumn: number; endLine: number; endColumn: number};
type Leaf = {kind: "paragraph" | "table" | "fence" | "indent" | "html"; node: number; char?: string; length?: number; indent?: number; blanks?: number; end?: readonly string[] | null};

/** Pending blocks, source pieces, definitions, and container continuations are
 * fixed-size records in caller storage. Only the current line/leaf is resident. */
export class RetainedCommonMarkBlocks {
  root = 0;
  definitionCount = 0;
  private firstDefinition = 0;
  private lastDefinition = 0;
  private buckets = 0;
  constructor(readonly source: RetainedSourceText, private readonly tape: PagedStorage, private readonly context: AdapterContext, readonly sourceName = "input", private readonly extensions: Readonly<Record<string, boolean>> = {}) {}
  private async put(position: number, values: readonly number[]): Promise<void> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true)); await this.tape.write(position, bytes);
  }
  private async get(position: number, count: number): Promise<number[]> {
    const bytes = await this.tape.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  }
  private async record(values: readonly number[]): Promise<number> {const position = this.tape.allocate(values.length * 8); await this.put(position, values); return position;}
  async node(position: number): Promise<Node> {
    const values = await this.get(position, fields.length + 1), result = {kind: kinds[values[0]!]!} as Node;
    fields.forEach((name, index) => {result[name] = values[index + 1]!;}); result.info = {start: result.infoStart, end: result.infoEnd}; return result;
  }
  private async set(position: number, field: Field, value: number): Promise<void> {await this.put(position + (fields.indexOf(field) + 1) * 8, [value]);}
  private async create(kind: Node["kind"], initial: Partial<Record<Field, number>> = {}): Promise<number> {
    return this.record([kinds.indexOf(kind), ...fields.map(field => initial[field] ?? 0)]);
  }
  private async append(parent: number, position: number): Promise<void> {
    const node = await this.node(parent);
    await this.set(position, "parent", parent); await this.set(position, "previous", node.last);
    if (node.last) await this.set(node.last, "next", position); else await this.set(parent, "first", position);
    await this.set(parent, "last", position);
  }
  private async remove(position: number): Promise<void> {
    const node = await this.node(position);
    if (node.previous) await this.set(node.previous, "next", node.next); else await this.set(node.parent, "first", node.next);
    if (node.next) await this.set(node.next, "previous", node.previous); else await this.set(node.parent, "last", node.previous);
  }
  async *children(parent: number): AsyncGenerator<number> {
    let child = (await this.node(parent)).first;
    while (child) {await this.context.cooperate(); yield child; child = (await this.node(child)).next;}
  }
  private async line(position: number): Promise<Line> {
    const values = await this.get(position, 6);
    return {position, range: {start: values[0]!, end: values[1]!}, line: values[2]!, column: values[3]!, next: values[4]!, alignment: values[5]!};
  }
  async *lines(position: number): AsyncGenerator<Line> {
    let next = (await this.node(position)).firstLine;
    while (next) {await this.context.cooperate(); const line = await this.line(next); yield line; next = line.next;}
  }
  private async addLine(node: number, range: SourceRange, line = 0, column = 0, alignment = 0): Promise<void> {
    const record = await this.record([range.start, range.end, line, column, 0, alignment]), previous = await this.node(node);
    if (previous.lastLine) await this.put(previous.lastLine + 32, [record]); else await this.set(node, "firstLine", record);
    await this.set(node, "lastLine", record); await this.set(node, "lineCount", previous.lineCount + 1);
  }
  async joined(position: number, separator = "\n"): Promise<SourceRange> {
    const source = this.source, lines = this.lines(position);
    return source.append((async function* () {let first = true; for await (const line of lines) {if (!first) yield separator; first = false; yield* source.chunks(line.range);}})());
  }
  private async trim(range: SourceRange): Promise<SourceRange> {
    let {start, end} = range;
    while (start < end && [" ", "\t"].includes(await this.source.unit(start))) start++;
    while (end > start && [" ", "\t"].includes(await this.source.unit(end - 1))) end--;
    return {start, end};
  }
  private async definition(position: number): Promise<Definition> {
    const value = await this.get(position, 12);
    return {label: {start: value[0]!, end: value[1]!}, destination: {start: value[2]!, end: value[3]!}, title: {start: value[4]!, end: value[5]!}, startLine: value[6]!, startColumn: value[7]!, endLine: value[8]!, endColumn: value[9]!};
  }
  async *definitions(): AsyncGenerator<Definition> {
    for (let position = this.firstDefinition; position;) {yield await this.definition(position); position = (await this.get(position + 80, 1))[0]!;}
  }
  private hash(label: string): number {let hash = 2166136261; for (let i = 0; i < label.length; i++) hash = Math.imul(hash ^ label.charCodeAt(i), 16777619); return (hash >>> 0) % 256;}
  async lookup(label: string): Promise<Definition | undefined> {
    let position = (await this.get(this.buckets + this.hash(label) * 8, 1))[0]!;
    while (position) {
      await this.context.cooperate(); const value = await this.definition(position);
      if (value.label.end - value.label.start === label.length) {
        let equal = true; for (let i = 0; i < label.length; i++) if (await this.source.unit(value.label.start + i) !== label[i]) {equal = false; break;}
        if (equal) return value;
      }
      position = (await this.get(position + 88, 1))[0]!;
    }
  }
  private async scanDefinition(range: SourceRange): Promise<{label: string; destination: SourceRange; title: SourceRange; count: number} | undefined> {
    const source = this.source, syntax = new RetainedCommonMarkSyntax(source, range, this.context), scanned = await syntax.label(range.start);
    if (!scanned || await syntax.at(scanned.end) !== ":") return;
    const label = normalizeLabel(scanned.label, this.context); if (!label) return;
    let count = 1; for (let i = range.start; i < scanned.end; i++) if (await source.unit(i) === "\n") count++;
    const endOfLine = async (start: number) => {const end = await source.find({start, end: range.end}, "\n"); return end < 0 ? range.end : end;};
    let start = scanned.end + 1, end = await endOfLine(start);
    while (start < end && [" ", "\t"].includes(await source.unit(start))) start++;
    if (start === end && end < range.end) {start = end + 1; end = await endOfLine(start); count++; while (start < end && [" ", "\t"].includes(await source.unit(start))) start++;}
    const destinationSyntax = new RetainedCommonMarkSyntax(source, {start, end}, this.context), destination = await destinationSyntax.destination(start);
    if (!destination || (start >= end || await source.unit(start) !== "<") && destination.value.start === destination.value.end) return;
    const destinationCount = count, tail = await this.trim({start: destination.end, end}), gap = destination.end < end && [" ", "\t"].includes(await source.unit(destination.end));
    start = tail.start;
    if (start === tail.end && end < range.end) {
      const next = await this.trim({start: end + 1, end: await endOfLine(end + 1)}), char = await source.unit(next.start);
      if (char === "'" || char === '"' || char === "(") {start = next.start; end = next.end; count++;}
    } else if (start < tail.end && !gap) return;
    const empty = {start: destination.end, end: destination.end};
    if (start === end) return {label, destination: destination.value, title: empty, count};
    const opening = await source.unit(start); if (opening !== "'" && opening !== '"' && opening !== "(") return;
    const closing = opening === "(" ? ")" : opening, titleStart = start + 1;
    const failure = () => count > destinationCount ? {label, destination: destination.value, title: empty, count: destinationCount} : undefined;
    for (let i = titleStart; i < range.end; i++) {
      await this.context.cooperate(); const char = await source.unit(i);
      if (char === "\n") {count++; continue;}
      if (char === "\\" && asciiPunctuation(await syntax.at(i + 1))) {i++; continue;}
      if (char === closing) {const rest = await this.trim({start: i + 1, end: await endOfLine(i + 1)}); return rest.start < rest.end ? failure() : {label, destination: destination.value, title: {start: titleStart, end: i}, count};}
      if (opening === "(" && char === "(") return failure();
    }
    return failure();
  }
  private async extractDefinitions(position: number): Promise<void> {
    const node = await this.node(position); if (!node.firstLine || await this.source.unit((await this.line(node.firstLine)).range.start) !== "[") return;
    const range = await this.joined(position); let offset = range.start, first = node.firstLine, consumed = 0;
    while (first) {
      const candidate = await this.scanDefinition({start: offset, end: range.end}); if (!candidate) break;
      this.context.charge("references", 1); this.context.charge("retainedBytes", (candidate.label.length + candidate.destination.end - candidate.destination.start + candidate.title.end - candidate.title.start) * 2 + 128);
      const firstLine = await this.line(first); let last = firstLine;
      for (let i = 0; i < candidate.count; i++) {last = await this.line(first); offset += last.range.end - last.range.start + 1; first = last.next; consumed++;}
      if (!await this.lookup(candidate.label)) {
        const label = await this.source.append([candidate.label]), bucket = this.buckets + this.hash(candidate.label) * 8, previous = (await this.get(bucket, 1))[0]!;
        const record = await this.record([label.start, label.end, candidate.destination.start, candidate.destination.end, candidate.title.start, candidate.title.end, firstLine.line, firstLine.column, last.line, last.column + last.range.end - last.range.start - 1, 0, previous]);
        if (this.lastDefinition) await this.put(this.lastDefinition + 80, [record]); else this.firstDefinition = record;
        this.lastDefinition = record; this.definitionCount++; await this.put(bucket, [record]);
      }
    }
    if (!consumed) return;
    await this.set(position, "firstLine", first); await this.set(position, "lineCount", node.lineCount - consumed);
    if (first) {const line = await this.line(first); await this.set(position, "startLine", line.line); await this.set(position, "startColumn", line.column);}
    else {await this.set(position, "lastLine", 0); await this.remove(position);}
  }
  private async pipeRow(range: SourceRange): Promise<number | undefined> {
    const source = this.source, row = await this.create("row"); let start = range.start, pipes = 0;
    const cell = async (end: number) => {
      const begin = start;
      const value = await source.append((async function* () {
        let buffer = "";
        for (let i = begin; i < end; i++) {let char = await source.unit(i); if (char === "\\" && i + 1 < end && await source.unit(i + 1) === "|") {char = "|"; i++;} buffer += char; if (buffer.length >= 4096) {yield buffer; buffer = "";}}
        if (buffer) yield buffer;
      })());
      await this.addLine(row, await source.trim(value));
    };
    for (let i = range.start; i < range.end; i++) {
      this.context.checkpoint(); const char = await source.unit(i);
      if (char === "\\" && i + 1 < range.end && await source.unit(i + 1) === "|") i++;
      else if (char === "|") {await cell(i); start = i + 1; pipes++;}
    }
    if (!pipes) return;
    await cell(range.end);
    const trimmed = await source.trim(range); let record = await this.node(row);
    if (await source.unit(trimmed.start) === "|") {const first = await this.line(record.firstLine); await this.set(row, "firstLine", first.next); await this.set(row, "lineCount", record.lineCount - 1);}
    record = await this.node(row);
    if (await source.unit(trimmed.end - 1) === "|" && record.lastLine) {
      const last = await this.line(record.lastLine);
      if (last.range.start === last.range.end) {
        let previous = 0; for await (const line of this.lines(row)) {if (line.position === last.position) break; previous = line.position;}
        if (previous) await this.put(previous + 32, [0]); else await this.set(row, "firstLine", 0);
        await this.set(row, "lastLine", previous); await this.set(row, "lineCount", record.lineCount - 1);
      }
    }
    this.context.charge("retainedBytes", (range.end - range.start) * 2 + (await this.node(row)).lineCount * 32); return row;
  }
  async parse(range: SourceRange): Promise<void> {
    const context = this.context, source = this.source, extensions = this.extensions;
    context.checkpoint(0); context.charge("text", range.end - range.start); context.charge("retainedBytes", (range.end - range.start) * 2);
    this.root = await this.create("root"); this.buckets = this.tape.allocate(256 * 8); await this.tape.write(this.buckets, new Uint8Array(256 * 8));
    // Stack records: previous, next, node, kind, indent, list, blank, empty.
    let firstStack = 0, lastStack = 0, depth = 0, leaf: Leaf | undefined, cursor = range.start, number = 0;
    const containers = async function* (parser: RetainedCommonMarkBlocks) {for (let position = firstStack; position;) {const fields = await parser.get(position, 8); yield {position, fields}; position = fields[1]!;}};
    const parent = async () => {
      if (!lastStack) return this.root;
      const top = await this.get(lastStack, 8); return ["quote", "item", "footnote"].includes(kinds[top[3]!]!) ? top[2]! : this.root;
    };
    const finish = async () => {if (leaf?.kind === "paragraph") await this.extractDefinitions(leaf.node); leaf = undefined;};
    const push = async (node: number, kind: Node["kind"], indent = 0, list = 0, empty = false) => {
      context.bound("depth", depth + 1); context.charge("retainedBytes", 64);
      const position = await this.record([lastStack, 0, node, kinds.indexOf(kind), indent, list, 0, Number(empty)]);
      if (lastStack) await this.put(lastStack + 8, [position]); else firstStack = position; lastStack = position; depth++;
    };
    const truncate = async (position: number, length: number) => {lastStack = position; depth = length; if (position) await this.put(position + 8, [0]); else firstStack = 0;};
    const add = async (kind: Node["kind"], line: RetainedCommonMarkLine, offset: number, initial: Partial<Record<Field, number>> = {}) => {
      context.bound("depth", depth + 1); context.charge("nodes", 1); context.charge("retainedBytes", 128);
      if (lastStack) {
        const top = await this.get(lastStack, 8);
        if (kinds[top[3]!] === "item") {if (top[6] && (await this.node(top[2]!)).first) await this.set(top[5]!, "tight", 0); await this.put(lastStack + 48, [0]);}
      }
      const node = await this.create(kind, {startLine: line.number, startColumn: await line.column(offset), endLine: line.number, endColumn: line.endColumn, ...initial}); await this.append(await parent(), node); return node;
    };
    const prepareInline = async (line: RetainedCommonMarkLine, offset: number, value?: SourceRange) => {
      context.bound("references", this.definitionCount + (leaf?.kind === "paragraph" ? (await this.node(leaf.node)).lineCount : 0) + 1);
      const range = value ?? await line.rawFrom(offset); context.charge("retainedBytes", (range.end - range.start) * 2 + 48);
      return {range, column: await line.column(offset)};
    };
    const inline = async (node: number, line: RetainedCommonMarkLine, offset: number) => {
      const value = await prepareInline(line, offset); await this.addLine(node, value.range, line.number, value.column);
    };
    const end = async (node: number, line: RetainedCommonMarkLine) => {await this.set(node, "endLine", line.number); await this.set(node, "endColumn", line.endColumn);};
    const prepareLiteral = async (line: RetainedCommonMarkLine, offset: number) => {
      const raw = await line.rawFrom(offset), ending = line.ending || "\n";
      context.charge("retainedBytes", (raw.end - raw.start + ending.length) * 2);
      return {raw, ending};
    };
    const literal = async (node: number, line: RetainedCommonMarkLine, offset: number, prepared?: {raw: SourceRange; ending: string}) => {
      const {raw, ending} = prepared ?? await prepareLiteral(line, offset);
      await this.addLine(node, raw); await this.addLine(node, await source.append([ending]));
    };
    while (cursor < range.end) {
      if (context.sinceYield !== undefined && context.sinceYield < 255) context.checkpoint(); else await context.cooperate();
      const begin = cursor;
      while (cursor < range.end && await source.unit(cursor) !== "\n" && await source.unit(cursor) !== "\r") {context.checkpoint(); if (cursor > begin && (cursor - begin) % 256 === 0) await context.cooperate(0); cursor++;}
      const raw = {start: begin, end: cursor}; let ending = "";
      if (cursor < range.end) {ending = await source.unit(cursor++); if (ending === "\r" && await source.unit(cursor) === "\n" && cursor < range.end) {ending += "\n"; cursor++;}}
      const line = await RetainedCommonMarkLine.create(source, raw, ++number, ending, context);
      let offset = 0, matched = 0, matchedStack = 0, failed: number[] | undefined;
      for await (const container of containers(this)) {
        context.checkpoint(); const fields = container.fields, kind = kinds[fields[3]!]!;
        if (kind !== "list") {
          const indent = await line.spaces(offset);
          if (kind === "quote") {if (indent > 3 || await line.at(offset + indent) !== ">") {failed = fields; break;} offset += indent + 1; if (await line.at(offset) === " ") offset++;}
          else if (fields[7] && fields[6]) {failed = fields; break;}
          else if (indent >= fields[4]!) offset += fields[4]!;
          else if (offset + indent === line.length) offset += indent;
          else {failed = fields; break;}
          if (kind === "item" && offset + await line.spaces(offset) < line.length) await this.put(container.position + 56, [0]);
        }
        matched++; matchedStack = container.position;
      }
      const blank = offset + await line.spaces(offset) === line.length;
      if (matched < depth) {
        const siblingIndent = await line.spaces(offset), sibling = siblingIndent <= 3 ? await line.marker(offset + siblingIndent) : undefined;
        const siblingItem = failed && kinds[failed[3]!] === "item" && sibling;
        const at = line.text.start + offset + siblingIndent;
        const siblingFootnote = failed && kinds[failed[3]!] === "footnote" && await source.starts({start: at, end: line.text.end}, "[^") && await source.find({start: at + 2, end: line.text.end}, "]:") >= 0;
        if (leaf?.kind === "paragraph" && !blank && !siblingItem && !siblingFootnote && !await line.interrupts(offset, extensions.raw_html !== false)) {
          await inline(leaf.node, line, offset + await line.spaces(offset)); await end(leaf.node, line);
          for await (const container of containers(this)) await end(container.fields[2]!, line); continue;
        }
        await finish(); await truncate(matchedStack, matched);
      }
      for await (const container of containers(this)) await end(container.fields[2]!, line);
      if (leaf?.kind === "fence") {
        const indent = await line.spaces(offset), at = offset + indent; let stop = at;
        while (await line.at(stop) === leaf.char) stop++;
        if (indent <= 3 && stop - at >= leaf.length! && await line.spaces(stop) === line.length - stop) {await end(leaf.node, line); await finish();}
        else {await literal(leaf.node, line, offset + Math.min(indent, leaf.indent!)); await end(leaf.node, line);} continue;
      }
      if (leaf?.kind === "html") {
        if (leaf.end === null && blank) await finish();
        else {await literal(leaf.node, line, offset); await end(leaf.node, line); if (leaf.end && await line.closes(leaf.end)) await finish(); continue;}
      }
      if (leaf?.kind === "indent") {
        const indent = await line.spaces(offset);
        if (blank) {await literal(leaf.blanks!, line, offset + Math.min(indent, 4)); continue;}
        if (indent >= 4) {
          const raw = await line.rawFrom(offset + 4), ending = line.ending || "\n";
          let length = raw.end - raw.start + ending.length;
          for await (const pending of this.lines(leaf.blanks!)) length += pending.range.end - pending.range.start;
          context.charge("retainedBytes", length * 2);
          for await (const pending of this.lines(leaf.blanks!)) await this.addLine(leaf.node, pending.range);
          await literal(leaf.node, line, offset + 4, {raw, ending}); leaf.blanks = await this.create("row"); await end(leaf.node, line); continue;
        }
        await finish();
      }
      if (blank) {
        await finish(); let deepest = 0;
        if (lastStack && kinds[(await this.get(lastStack, 4))[3]!] === "item") {
          for await (const container of containers(this)) if (kinds[container.fields[3]!] === "item") {deepest = container.position; await this.set(container.fields[2]!, "blank", 1);}
        }
        if (deepest) await this.put(deepest + 48, [1]); continue;
      }
      if (leaf?.kind === "table") {
        const row = !await line.interrupts(offset, extensions.raw_html !== false) ? await this.pipeRow(await line.rawFrom(offset)) : undefined;
        if (row) {
          const columns = (await this.node((await this.node(leaf.node)).first)).lineCount, count = (await this.node(row)).lineCount;
          context.charge("tableCells", extensions.preserve_table_columns ? count : columns);
          if (!extensions.preserve_table_columns && count > columns) {
            let kept = 0, last = 0; for await (const cell of this.lines(row)) {if (kept++ === columns) break; last = cell.position;}
            if (last) await this.put(last + 32, [0]); else await this.set(row, "firstLine", 0);
            await this.set(row, "lastLine", last); await this.set(row, "lineCount", columns);
          }
          await this.append(leaf.node, row); await end(leaf.node, line); continue;
        }
        await finish();
      }
      if (extensions.pipe_tables && leaf?.kind === "paragraph" && (await this.node(leaf.node)).lineCount === 1) {
        const previous = await this.node(leaf.node), header = await this.pipeRow((await this.line(previous.firstLine)).range), delimiter = await this.pipeRow(await line.rawFrom(offset));
        if (header && delimiter && (await this.node(header)).lineCount === (await this.node(delimiter)).lineCount) {
          let valid = true, headerCell = (await this.node(header)).firstLine;
          for await (const cell of this.lines(delimiter)) {
            context.checkpoint(cell.range.end - cell.range.start); let at = cell.range.start;
            const left = await source.unit(at) === ":"; if (left) at++; const begin = at;
            while (at < cell.range.end && await source.unit(at) === "-") at++;
            const right = at < cell.range.end && await source.unit(at) === ":"; if (right) at++;
            if (at !== cell.range.end || at === begin || await source.unit(begin) !== "-") {valid = false; break;}
            await this.put(headerCell + 40, [left ? right ? 3 : 1 : right ? 2 : 0]); headerCell = (await this.line(headerCell)).next;
          }
          if (valid) {
            context.charge("tableCells", (await this.node(header)).lineCount); await this.put(leaf.node, [kinds.indexOf("table")]);
            await this.set(leaf.node, "firstLine", 0); await this.set(leaf.node, "lastLine", 0); await this.set(leaf.node, "lineCount", 0);
            await this.append(leaf.node, header); await end(leaf.node, line); leaf = {kind: "table", node: leaf.node}; continue;
          }
        }
      }
      const initialIndent = await line.spaces(offset), underline = initialIndent <= 3 ? await line.setext(offset + initialIndent) : 0;
      if (leaf?.kind === "paragraph" && underline) {
        const position = leaf.node; await this.extractDefinitions(position);
        if ((await this.node(position)).lineCount) {await this.put(position, [kinds.indexOf("heading")]); await this.set(position, "number", underline); await end(position, line); leaf = undefined; continue;}
        leaf = undefined;
      }
      if (leaf?.kind === "paragraph" && !await line.interrupts(offset, extensions.raw_html !== false)) {await inline(leaf.node, line, offset + initialIndent); await end(leaf.node, line); continue;}
      const wasParagraph = leaf?.kind === "paragraph"; await finish();
      for (;;) {
        context.checkpoint(); const indent = await line.spaces(offset), at = offset + indent;
        const top = lastStack ? await this.get(lastStack, 8) : undefined;
        if (extensions.footnotes && indent <= 3 && await source.starts({start: line.text.start + at, end: line.text.end}, "[^")) {
          const stop = await source.find({start: line.text.start + at + 2, end: line.text.end}, "]:");
          if (stop > line.text.start + at + 2) {
            let valid = true; for (let i = line.text.start + at + 2; i < stop; i++) if ([" ", "\t"].includes(await source.unit(i))) {valid = false; break;}
            if (valid) {const node = await add("footnote", line, at, {infoStart: line.text.start + at + 2, infoEnd: stop}); await push(node, "footnote", 4); offset = stop - line.text.start + 2; offset += await line.spaces(offset); continue;}
          }
        }
        const item = indent <= 3 && !await line.rule(at) ? await line.marker(at) : undefined;
        if (top && kinds[top[3]!] === "list") {
          const list = await this.node(top[2]!);
          if (!item || Number.isNaN(item.start) !== Number.isNaN(list.number) || item.marker !== list.marker) {
            await truncate(top[0]!, depth - 1);
            const parent = lastStack ? await this.get(lastStack, 8) : undefined, previous = list.last ? await this.node(list.last) : undefined;
            if (parent && kinds[parent[3]!] === "item" && previous?.blank) await this.put(lastStack + 48, [1]);
          }
        }
        if (indent <= 3 && await line.at(at) === ">") {const node = await add("quote", line, at); await push(node, "quote"); offset = at + 1; if (await line.at(offset) === " ") offset++; continue;}
        if (item && (!wasParagraph || !item.empty && (Number.isNaN(item.start) || item.start === 1))) {
          let list = lastStack ? await this.get(lastStack, 8) : undefined;
          if (!list || kinds[list[3]!] !== "list") {const node = await add("list", line, at, {number: item.start, marker: item.marker, tight: 1}); await push(node, "list"); list = await this.get(lastStack, 8);}
          const listNode = await this.node(list[2]!); if (listNode.last && (await this.node(listNode.last)).blank) await this.set(list[2]!, "tight", 0);
          context.charge("nodes", 1); context.charge("retainedBytes", 128);
          const node = await this.create("item", {startLine: line.number, startColumn: await line.column(at), endLine: line.number, endColumn: line.endColumn});
          await this.append(list[2]!, node); await push(node, "item", indent + item.indent, list[2]!, item.empty);
          offset = item.content; if (item.empty) break; continue;
        }
        if (at === line.length) break;
        const level = indent <= 3 ? await line.heading(at) : 0;
        if (level) {
          let content = await this.trim(await line.rawFrom(at + level)), stop = content.end;
          while (stop > content.start && await source.unit(stop - 1) === "#") stop--;
          if (stop < content.end && (stop === content.start || [" ", "\t"].includes(await source.unit(stop - 1)))) content = await this.trim({start: content.start, end: stop});
          const value = await prepareInline(line, at + level + await line.spaces(at + level), content);
          const node = await add("heading", line, at, {number: level}); await this.addLine(node, value.range, line.number, value.column); break;
        }
        if (indent <= 3 && await line.rule(at)) {await add("thematicBreak", line, at); break;}
        const opening = indent <= 3 ? await line.fence(at) : undefined;
        if (opening) {const info = await this.trim(await line.rawFrom(at + opening.length)), node = await add("code", line, at, {infoStart: info.start, infoEnd: info.end}); leaf = {kind: "fence", node, ...opening, indent}; break;}
        const html = extensions.raw_html !== false && indent <= 3 ? await line.html(at, false) : undefined;
        if (html) {const value = await prepareLiteral(line, offset), node = await add("html", line, at); await literal(node, line, offset, value); if (html.end === null || !await line.closes(html.end)) leaf = {kind: "html", node, end: html.end}; break;}
        if (indent >= 4) {const value = await prepareLiteral(line, offset + 4), node = await add("code", line, offset + 4); await literal(node, line, offset + 4, value); leaf = {kind: "indent", node, blanks: await this.create("row")}; break;}
        const value = await prepareInline(line, at), node = await add("paragraph", line, at); await this.addLine(node, value.range, line.number, value.column); leaf = {kind: "paragraph", node}; break;
      }
      for await (const container of containers(this)) {if (kinds[container.fields[3]!] === "item") await this.set(container.fields[2]!, "blank", 0); await end(container.fields[2]!, line);}
    }
    await finish(); context.checkpoint(0);
  }
}
