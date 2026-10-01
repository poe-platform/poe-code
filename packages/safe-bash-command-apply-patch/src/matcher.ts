import type { PatchFile } from "./parser.js";
import { PatchError, Work } from "./shared.js";

interface RecordLine { text: string; ending: string; }
interface Replacement { start: number; end: number; lines: RecordLine[]; }

async function records(text: string, work: Work): Promise<RecordLine[]> {
  const result: RecordLine[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (work.due) await work.checkpoint();
    work.step();
    if (text[index] === "\n") {
      const crlf = index > start && text[index - 1] === "\r";
      work.count("maxLines", 1);
      result.push({ text: await work.slice(text, start, crlf ? index - 1 : index), ending: crlf ? "\r\n" : "\n" });
      start = index + 1;
    }
  }
  if (start < text.length) { work.count("maxLines", 1); result.push({ text: await work.slice(text, start), ending: "" }); }
  await work.checkpoint();
  return result;
}

async function normalized(text: string, pass: number, work: Work): Promise<string> {
  await work.charge(text.length);
  const trimmed = pass === 1 ? text.trimEnd() : text.trim();
  if (pass < 3) return trimmed;
  let result = "";
  for (const character of trimmed) {
    work.step();
    if ("‐‑‒–—―−".includes(character)) result += "-";
    else if ("‘’‚‛".includes(character)) result += "'";
    else if ("“”„‟".includes(character)) result += '"';
    else if ("\u00a0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000".includes(character)) result += " ";
    else result += character;
    if (work.due) await work.checkpoint();
  }
  return result;
}

async function find(lines: readonly RecordLine[], pattern: readonly string[], start: number, eof: boolean, work: Work): Promise<number> {
  const last = lines.length - pattern.length;
  const first = eof ? last : start;
  if (first < start) return -1;
  for (let pass = 0; pass < 4; pass++) {
    for (let candidate = first; candidate <= last; candidate++) {
      await work.charge(1);
      let matched = true;
      for (let offset = 0; offset < pattern.length; offset++) {
        let actual = lines[candidate + offset]!.text;
        let expected = pattern[offset]!;
        if (pass) {
          actual = await normalized(actual, pass, work);
          expected = await normalized(expected, pass, work);
        }
        if (!await work.equal(actual, expected)) { matched = false; break; }
      }
      if (matched) return candidate;
      await work.checkpoint();
    }
  }
  return -1;
}

async function encode(lines: readonly RecordLine[], work: Work): Promise<Uint8Array> {
  let bytes = 0;
  let units = 0;
  for (const line of lines) {
    bytes += await work.utf8(line.text, work.limits.maxFileBytes - bytes);
    if (line.ending.length > work.limits.maxFileBytes - bytes) throw new PatchError("maxFileBytes limit exceeded");
    bytes += line.ending.length;
    units += line.text.length + line.ending.length;
  }
  work.count("maxStagedBytes", bytes);
  work.admit(units * 2 + bytes);
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const line of lines) {
    offset = await work.encodeInto(line.text, result, offset);
    offset = await work.encodeInto(line.ending, result, offset);
  }
  return result;
}

export async function contents(file: PatchFile, original: Uint8Array | undefined, work: Work): Promise<Uint8Array | undefined> {
  if (file.kind === "delete") return undefined;
  if (file.kind === "add") {
    const added: RecordLine[] = [];
    for (const text of file.added) { work.step(); added.push({ text, ending: "\n" }); await work.checkpoint(); }
    return encode(added, work);
  }
  if (!original) throw new PatchError(`missing target: ${file.label}`);
  if (file.hunks.length === 0) return original;
  const text = await work.text(original, 1);
  const old = await records(text, work);
  let ending = "\n";
  for (const line of old) {
    work.step(); await work.checkpoint();
    if (line.ending) { ending = line.ending; break; }
  }
  const terminated = !original.length || original.at(-1) === 10;
  const replacements: Replacement[] = [];
  let cursor = 0;
  for (const hunk of file.hunks) {
    let anchorPosition: number | undefined;
    for (const anchor of hunk.anchors) {
      const position = await find(old, [anchor], cursor, false, work);
      if (position < 0) throw new PatchError(`context anchor not found: ${file.label}`);
      cursor = position + 1;
      anchorPosition = position;
    }
    const pattern: string[] = [];
    for (const line of hunk.lines) { work.step(); if (line.kind !== "+") pattern.push(line.text); await work.checkpoint(); }
    const searchStart = anchorPosition !== undefined && pattern.length && await work.equal(await normalized(old[anchorPosition]!.text, 3, work), await normalized(pattern[0]!, 3, work))
      ? anchorPosition : cursor;
    const start = pattern.length ? await find(old, pattern, searchStart, hunk.eof, work) : hunk.eof ? old.length : cursor;
    if (start < 0) throw new PatchError(`expected context not found: ${file.label}`);
    const replacement: RecordLine[] = [];
    let matched = start;
    for (const line of hunk.lines) {
      work.step();
      if (line.kind === " ") { replacement.push({ ...old[matched++]! }); }
      else if (line.kind === "-") matched++;
      else { replacement.push({ text: line.text, ending }); }
      await work.checkpoint();
    }
    replacements.push({ start, end: start + pattern.length, lines: replacement });
    cursor = start + pattern.length;
    await work.checkpoint();
  }
  const result: RecordLine[] = [];
  let position = 0;
  for (const replacement of replacements) {
    if (replacement.start < position) throw new PatchError("overlapping update hunks");
    while (position < replacement.start) {
      work.step();
      result.push({ ...old[position++]! });
      await work.checkpoint();
    }
    for (const line of replacement.lines) { work.step(); result.push(line); await work.checkpoint(); }
    position = replacement.end;
  }
  while (position < old.length) {
    work.step();
    result.push({ ...old[position++]! });
    await work.checkpoint();
  }
  for (let index = 0; index < result.length; index++) {
    work.step();
    const line = result[index]!;
    if (index < result.length - 1 && !line.ending) line.ending = ending;
    else if (index === result.length - 1) line.ending = terminated ? line.ending || ending : "";
    await work.checkpoint();
  }
  return encode(result, work);
}
