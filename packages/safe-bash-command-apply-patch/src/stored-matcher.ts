import type { ByteSource } from "safe-bash-contracts";
import { IndexedDocument } from "safe-bash-diff-engine/document";
import type { PatchFile } from "./parser.js";
import { equalText, type PatchText } from "./stored-text.js";
import { PatchError, type Work } from "./shared.js";

interface Record { start: number; end: number; ending: string; text?: PatchText }

async function record(document: IndexedDocument, index: number): Promise<Record> {
  const bounds = await document.line(index);
  const tail = await document.data.read(8 + Math.max(bounds.start, bounds.end - 2), Math.min(2, bounds.end - bounds.start));
  const ending = tail.at(-1) === 10 ? tail.at(-2) === 13 ? "\r\n" : "\n" : "";
  return { start: bounds.start, end: bounds.end - ending.length, ending };
}

async function matches(document: IndexedDocument, index: number, expected: PatchText, pass: number, work: Work): Promise<boolean> {
  const bounds = await record(document, index);
  return equalText({ document, start: bounds.start, end: bounds.end }, expected, pass, work);
}

async function find(document: IndexedDocument, pattern: readonly PatchText[], start: number, eof: boolean, work: Work): Promise<number> {
  const last = document.length - pattern.length;
  const first = eof ? last : start;
  if (first < start) return -1;
  for (let pass = 0; pass < 4; pass++) for (let candidate = first; candidate <= last; candidate++) {
    await work.charge(1);
    let equal = true;
    for (let offset = 0; offset < pattern.length; offset++) {
      if (!await matches(document, candidate + offset, pattern[offset]!, pass, work)) { equal = false; break; }
    }
    if (equal) return candidate;
  }
  return -1;
}

async function* records(file: PatchFile<PatchText>, original: IndexedDocument | undefined, work: Work, ending: string): AsyncGenerator<Record> {
  if (file.kind === "add") {
    for (const value of file.added) { await work.charge(1); yield { start: 0, end: 0, ending: "\n", text: value }; }
    return;
  }
  const old = original!;
  let cursor = 0, emitted = 0;
  for (const hunk of file.hunks) {
    let anchorPosition: number | undefined;
    for (const anchor of hunk.anchors) {
      const position = await find(old, [anchor], cursor, false, work);
      if (position < 0) throw new PatchError(`context anchor not found: ${file.label}`);
      cursor = position + 1; anchorPosition = position;
    }
    const pattern: PatchText[] = [];
    for (const line of hunk.lines) { await work.charge(1); if (line.kind !== "+") pattern.push(line.text); }
    const searchStart = anchorPosition !== undefined && pattern.length && await matches(old, anchorPosition, pattern[0]!, 3, work) ? anchorPosition : cursor;
    const start = pattern.length ? await find(old, pattern, searchStart, hunk.eof, work) : hunk.eof ? old.length : cursor;
    if (start < 0) throw new PatchError(`expected context not found: ${file.label}`);
    if (start < emitted) throw new PatchError("overlapping update hunks");
    while (emitted < start) yield await record(old, emitted++);
    let matched = start;
    for (const line of hunk.lines) {
      await work.charge(1);
      if (line.kind === " ") yield await record(old, matched++);
      else if (line.kind === "-") matched++;
      else yield { start: 0, end: 0, ending, text: line.text };
    }
    cursor = emitted = start + pattern.length;
  }
  while (emitted < old.length) yield await record(old, emitted++);
}

/** Retain only one output record while deciding the final newline convention. */
export async function storedContents(file: PatchFile<PatchText>, original: IndexedDocument | undefined, work: Work): Promise<IndexedDocument | undefined> {
  if (file.kind === "delete") return undefined;
  if (file.kind === "update" && !original) throw new PatchError(`missing target: ${file.label}`);
  if (file.kind === "update" && !file.hunks.length) return original;
  if (file.kind === "update") {
    if (original!.binary) throw new PatchError("NUL bytes are unsupported");
    if (!original!.validUtf8) throw new PatchError("invalid UTF-8");
    work.count("maxLines", original!.length);
  }
  const terminated = file.kind === "add" || !original!.size || (await original!.data.read(8 + original!.size - 1, 1))[0] === 10;
  let ending = "\n";
  if (original) for (let index = 0; index < original.length; index++) {
    const line = await record(original, index);
    if (line.ending) { ending = line.ending; break; }
  }
  const encoder = new TextEncoder();
  async function* emit(line: Record, last: boolean): ByteSource {
    if (line.text === undefined) yield* original!.range(line.start, line.end);
    else if (typeof line.text !== "string") yield* line.text.document.range(line.text.start, line.text.end);
    else {
      await work.utf8(line.text, work.limits.maxFileBytes);
      for (let offset = 0; offset < line.text.length;) {
        let end = Math.min(line.text.length, offset + 4096);
        const unit = line.text.charCodeAt(end - 1);
        if (end < line.text.length && unit >= 0xd800 && unit <= 0xdbff) end--;
        yield encoder.encode(line.text.slice(offset, end));
        offset = end;
      }
    }
    const suffix = last && !terminated ? "" : line.ending || ending;
    if (suffix) yield encoder.encode(suffix);
  }
  async function* output(): ByteSource {
    let pending: Record | undefined;
    for await (const line of records(file, original, work, ending)) {
      if (pending) yield* emit(pending, false);
      pending = line;
    }
    if (pending) yield* emit(pending, true);
  }
  const result = new IndexedDocument(work);
  try {
    let length = 0;
    await result.load((async function* () {
      for await (const chunk of output()) {
        length += chunk.length;
        if (length > work.limits.maxFileBytes) throw new PatchError("maxFileBytes limit exceeded");
        work.count("maxStagedBytes", chunk.length);
        yield chunk;
      }
    })());
    return result;
  } catch (error) { await result.close(); throw error; }
}
