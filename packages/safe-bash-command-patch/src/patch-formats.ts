import { validateSection } from "./hunk-section.js";
import { decodeHeaderPath } from "./patch-path.js";
import { parseUnified,parseUnifiedSection,type FilePatch,type Hunk,type ParsedPatchLine,type PatchInput,type IndexedUnifiedCursor } from "./unified.js";
import { Budget,ToolError,integer } from "safe-bash-diff-engine/shared";
import { equalPatchText, materializeText, terminated, textSize, type PatchText } from "./patch-text.js";

export type PatchFormat = "unified" | "normal" | "context";

class Reader {
  readonly input: PatchInput;
  index = 0;
  constructor(input: string | PatchInput, readonly budget: Budget, admit = true) {
    if (typeof input === "string") {
      const lines = budget.split(input).map(line => line.slice(0, -1));
      this.input = { length: lines.length, async read(index) { return lines[index]; } };
    } else { if (admit) budget.countLines(input.length); this.input = input; }
  }
  peek(prefix?: number): Promise<string | undefined> { return this.input.read(this.index, prefix); }
  async matches(text: string): Promise<boolean> {
    return this.input.matches ? this.input.matches(this.index, text) : (await this.peek()) === text;
  }
  async take(prefix?: number): Promise<string> {
    this.budget.step();
    { const c = this.budget.checkpoint(); if (c) await c; }
    const line = await this.input.read(this.index++, prefix);
    if (line === undefined) throw new ToolError("truncated patch");
    return line;
  }
  number(value: string): number {
    const result = integer(value, "patch range");
    if (result > this.budget.limits.maxLines) throw new ToolError("hunk coordinate exceeds line limit");
    return result;
  }
  async content(prefix: string): Promise<PatchText> {
    const position = this.index;
    const line = await this.take(this.input.body ? 2 : undefined);
    if (line !== prefix && !(prefix === " " && line === "")
      && !line.startsWith(`${prefix} `) && !line.startsWith(`${prefix}\t`)) throw new ToolError("malformed patch body prefix");
    const incomplete = await this.matches("\\ No newline at end of file");
    const text = this.input.body ? await this.input.body(position, 2, incomplete) : `${line.slice(2)}${incomplete ? "" : "\n"}`;
    if (incomplete) {
      await this.take();
      if (textSize(text) === 0) throw new ToolError("empty incomplete line is not a valid text line");
    }
    return text;
  }
}

function* encoded(line: ParsedPatchLine): Generator<PatchText> {
  yield line.kind;
  yield line.text;
  if (!terminated(line.text)) yield "\n\\ No newline at end of file\n";
}

async function* normal(reader: Reader, target: string | undefined): AsyncGenerator<PatchText> {
  const quoted = JSON.stringify(target ?? "/dev/null");
  yield `--- ${quoted}\n+++ ${quoted}\n`;
  while ((await reader.peek()) !== undefined) {
    if ((await reader.peek()) === "") { await reader.take(); continue; }
    if (!/^\d/u.test((await reader.peek())!)) break;
    const command = /^(\d+)(?:,(\d+))?([acd])(\d+)(?:,(\d+))?$/u.exec(await reader.take());
    if (!command) throw new ToolError("malformed normal patch command");
    const oldStart = reader.number(command[1]!);
    const oldLast = reader.number(command[2] ?? command[1]!);
    const newStart = reader.number(command[4]!);
    const newLast = reader.number(command[5] ?? command[4]!);
    const operation = command[3]!;
    if (oldLast < oldStart || newLast < newStart || (operation === "a" && command[2] !== undefined)
      || (operation === "d" && command[5] !== undefined)) throw new ToolError("invalid normal patch range");
    const oldCount = operation === "a" ? 0 : oldLast - oldStart + 1;
    const newCount = operation === "d" ? 0 : newLast - newStart + 1;
    yield `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
    for (let index = 0; index < oldCount; index++) yield* encoded({ kind: "-", text: await reader.content("<") });
    if (operation === "c" && await reader.take() !== "---") throw new ToolError("missing normal change separator");
    for (let index = 0; index < newCount; index++) yield* encoded({ kind: "+", text: await reader.content(">") });
  }
}

interface ContextLine { readonly kind: " " | "!" | "-" | "+"; readonly text: PatchText }
interface Range { readonly start: number; readonly last: number; readonly multiple: boolean }

async function contextRange(reader: Reader, old: boolean): Promise<Range> {
  const line = await reader.take();
  const match = (old ? /^\*\*\* (\d+)(?:,(\d+))? \*\*\*\*$/u : /^--- (\d+)(?:,(\d+))? ----$/u).exec(line);
  if (!match) throw new ToolError("malformed context range");
  const start = reader.number(match[1]!);
  const last = reader.number(match[2] ?? match[1]!);
  if (last < start || (match[2] !== undefined && start === 0)) throw new ToolError("invalid context range");
  return { start, last, multiple: match[2] !== undefined };
}

interface ContextSide {
  readonly start: number; readonly records: number; readonly length: number;
  readonly common: number; readonly changed: boolean; readonly commonOnly?: boolean;
}

async function contextSide(reader: Reader, old: boolean, range: Range): Promise<ContextSide> {
  const start = reader.index;
  let length = 0, common = 0, changed = false, incomplete = false;
  const count = range.start === 0 ? 0 : range.last - range.start + 1;
  while ((await reader.peek(2)) !== undefined && length < count) {
    const kind = (await reader.peek(2)) === "" ? " " : (await reader.peek(2))![0];
    if (kind !== " " && kind !== "!" && kind !== (old ? "-" : "+")) break;
    if (old && (await reader.peek(2))?.startsWith("--") && /^--- \d+(?:,\d+)? ----$/u.test((await reader.peek())!)) break;
    const text = await reader.content(kind);
    incomplete = !terminated(text);
    length++;
    if (kind === " ") common++;
    changed ||= kind === "!";
    if (length > reader.budget.limits.maxLines) throw new ToolError("context body line limit exceeded");
  }
  if (!old && length === count && incomplete) {
    // GNU accepts surplus markers after the complete new side, preserving its EOF.
    while (await reader.matches("\\ No newline at end of file")) await reader.take();
  }
  return { start, records: length, length, common, changed };
}

async function* contextLines(reader: Reader, side: ContextSide): AsyncGenerator<ContextLine> {
  const replay = new Reader(reader.input, reader.budget, false);
  replay.index = side.start;
  for (let index = 0; index < side.records; index++) {
    const prefix = (await replay.peek(1))!;
    const kind = (prefix === "" ? " " : prefix[0]) as ContextLine["kind"];
    const text = await replay.content(kind);
    if (!side.commonOnly || kind === " ") yield { kind, text };
  }
}

function contextCount(range: Range, lines: ContextSide): number {
  if (!lines.length) {
    if (range.multiple) throw new ToolError("empty context side has a nonempty range");
    return 0;
  }
  if (range.start === 0 || lines.length !== range.last - range.start + 1) throw new ToolError("context body count does not match range");
  return lines.length;
}

async function* context(reader: Reader): AsyncGenerator<PatchText> {
  while ((await reader.peek()) !== undefined) {
    const header = await reader.take();
    if (header === "") continue;
    if (/^diff -[^ ]+ /u.test(header)) { yield `${header}\n`; continue; }
    if (!header.startsWith("*** ")) throw new ToolError("expected context file header");
    const next = await reader.take();
    if (!next.startsWith("--- ")) throw new ToolError("expected new context file header");
    yield `--- ${header.slice(4)}\n+++ ${next.slice(4)}\n`;
    let hunks = 0;
    while ((await reader.peek(16))?.startsWith("***************")) {
      const position = reader.index;
      const delimiter = await reader.take(reader.input.body ? 16 : undefined);
      const section = reader.input.body ? await reader.input.body(position, 15, true) : delimiter.slice(15);
      await validateSection(section, reader.budget, "malformed context hunk separator");
      if (++hunks > reader.budget.limits.maxHunks) throw new ToolError("hunk limit exceeded");
      const oldRange = await contextRange(reader, true);
      let oldLines = await contextSide(reader, true, oldRange);
      const newRange = await contextRange(reader, false);
      let newLines = await contextSide(reader, false, newRange);
      if (!oldLines.length) {
        if (newLines.changed) throw new ToolError("missing old changed context body");
        oldLines = { ...newLines, length: newLines.common, commonOnly: true };
      }
      if (!newLines.length) {
        if (oldLines.changed) throw new ToolError("missing new changed context body");
        newLines = { ...oldLines, length: oldLines.common, commonOnly: true };
      }
      const oldCount = contextCount(oldRange, oldLines);
      const newCount = contextCount(newRange, newLines);
      yield `@@ -${oldRange.start},${oldCount} +${newRange.start},${newCount} @@`;
      yield section; yield "\n";
      const oldIterator = contextLines(reader, oldLines), newIterator = contextLines(reader, newLines);
      try {
        let oldLine = await oldIterator.next(), newLine = await newIterator.next();
        while (!oldLine.done || !newLine.done) {
          let oldChanged = false, newChanged = false;
          while (!oldLine.done && oldLine.value.kind !== " ") {
            oldChanged ||= oldLine.value.kind === "!";
            yield* encoded({ kind: "-", text: oldLine.value.text });
            reader.budget.step();
            { const c = reader.budget.checkpoint(); if (c) await c; }
            oldLine = await oldIterator.next();
          }
          while (!newLine.done && newLine.value.kind !== " ") {
            newChanged ||= newLine.value.kind === "!";
            yield* encoded({ kind: "+", text: newLine.value.text });
            reader.budget.step();
            { const c = reader.budget.checkpoint(); if (c) await c; }
            newLine = await newIterator.next();
          }
          if (oldChanged !== newChanged) throw new ToolError("unpaired changed context group");
          if (!oldLine.done || !newLine.done) {
            if (oldLine.done || newLine.done || !await equalPatchText(oldLine.value.text, newLine.value.text, reader.budget)) throw new ToolError("context halves disagree");
            yield* encoded({ kind: " ", text: oldLine.value.text });
            oldLine = await oldIterator.next(); newLine = await newIterator.next();
          }
        }
      } finally { await oldIterator.return(undefined); await newIterator.return(undefined); }
    }
    if (!hunks) throw new ToolError("context file patch has no hunks");
    break;
  }
}

export interface ParseProgress { error?: unknown }

export async function parsePatch(text: string | PatchInput, budget: Budget, format: PatchFormat | undefined, target: string | undefined, progress?: ParseProgress,
  convert?: (source: AsyncIterable<string>) => Promise<FilePatch[]>): Promise<FilePatch[]> {
  return parsePatchWith(text, budget, format, target, {
    unified: cursor => parseUnifiedSection(cursor, budget),
    converted: async source => {
      const strings = { async *[Symbol.asyncIterator]() {
        for await (const chunk of source) yield await materializeText(chunk);
      } };
      if (convert) return convert(strings);
      const chunks: string[] = [];
      for await (const chunk of strings) chunks.push(chunk);
      return parseUnified(chunks.join(""), budget);
    },
  }, progress);
}

export interface PatchParsers<Lines, Hunks = Hunk<Lines>[]> {
  unified(cursor: IndexedUnifiedCursor): Promise<FilePatch<Lines, Hunks>[]>;
  converted(source: AsyncIterable<PatchText>): Promise<FilePatch<Lines, Hunks>[]>;
}

export async function parsePatchWith<Lines, Hunks = Hunk<Lines>[]>(text: string | PatchInput, budget: Budget, format: PatchFormat | undefined,
  target: string | undefined, parsers: PatchParsers<Lines, Hunks>, progress?: ParseProgress): Promise<FilePatch<Lines, Hunks>[]> {
  if (typeof text === "string" && text && !text.endsWith("\n")) throw new ToolError("patch is truncated: missing final LF");
  const reader = new Reader(text, budget);
  const patches: FilePatch<Lines, Hunks>[] = [];
  let convertedBytes = 0;
  while ((await reader.peek()) !== undefined) {
    try {
      if ((await reader.peek()) === "") { await reader.take(); continue; }
      if (!progress && patches.length && (await reader.peek())!.startsWith("-") && !(await reader.peek())!.startsWith("---")) {
        throw new ToolError("unexpected deletion outside a patch hunk");
      }
      if (patches.length && !/^(?:Index: |diff |index |---|\*\*\*|@@|[+\\<>]|\d)/u.test((await reader.peek())!)) {
        await reader.take();
        continue;
      }
      let indexPath: string | undefined;
      if ((await reader.peek())?.startsWith("Index: ")) {
        indexPath = decodeHeaderPath((await reader.take()).slice(7));
        if (/^=+$/u.test((await reader.peek()) ?? "")) await reader.take();
      }
      const start = reader.index;
      while (/^diff /u.test((await reader.peek()) ?? "")) await reader.take();
      const first = (await reader.peek()) ?? "";
      const detected: PatchFormat = first.startsWith("*** ") ? "context" : /^\d/u.test(first) ? "normal" : "unified";
      if (format && detected !== format) throw new ToolError(`patch format is ${detected}, not requested ${format}`);
      if (detected === "unified") {
        reader.index = start;
        patches.push(...(await parsers.unified(reader)).map(patch => ({ ...patch, ...(indexPath === undefined ? {} : { indexPath }) })));
      } else {
        if (detected === "context") reader.index = start;
        const source = detected === "normal" ? normal(reader, target ?? indexPath) : context(reader);
        const converted = { async *[Symbol.asyncIterator]() {
          for await (const chunk of source) { convertedBytes += textSize(chunk); yield chunk; }
          // Complete format validation before reporting the converted-byte quota.
          if (convertedBytes > budget.limits.maxInputBytes * 2 + 16_384) throw new ToolError("converted patch byte limit exceeded");
        } };
        const parsed = await parsers.converted(converted);
        patches.push(...parsed.map(patch => ({ ...patch, format: detected,
          ...(indexPath === undefined ? {} : { indexPath }),
          ...(detected === "normal" && target === undefined && indexPath === undefined ? { unlocated: true } : {}) })));
      }
    } catch (error) {
      if (!progress || !(error instanceof ToolError) || /limit|budget|filename|path|escape/u.test(error.message)) throw error;
      progress.error = error;
      break;
    }
  }
  return patches;
}
