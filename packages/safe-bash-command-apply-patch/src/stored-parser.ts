import type { IndexedDocument } from "safe-bash-diff-engine/document";
import { parseRecords, type ParsedFile } from "./parser.js";
import { textChunks, trimStored, type StoredText } from "./stored-text.js";
import type { PatchMetadata } from "./metadata.js";
import { PatchError, type Work } from "./shared.js";

/** Parse grammar from short prefixes; payloads remain ranges in caller storage. */
export async function parseDocument(document: IndexedDocument, work: Work, metadata: PatchMetadata): Promise<ParsedFile<StoredText>[]> {
  await work.utf8(work.cwd, work.limits.maxPathBytes, 2);
  if (!work.cwd.startsWith("/") || work.cwd.includes("\0")) throw new PatchError("cwd must be an absolute virtual path", 2);
  if (document.binary) throw new PatchError("NUL bytes are unsupported", 2);
  if (!document.validUtf8) throw new PatchError("invalid UTF-8", 2);
  const trimmed = await trimStored({ document, start: 0, end: document.size }, true, work);
  let first = 0, last = document.length;
  while (first < last && (await document.line(first)).end <= trimmed.start) first++;
  while (last > first && (await document.line(last - 1)).start >= trimmed.end) last--;
  work.count("maxLines", last - first);
  return parseRecords({ length: last - first, async get(index) {
    const bounds = await document.line(first + index);
    const start = Math.max(bounds.start, trimmed.start);
    let end = Math.min(bounds.end, trimmed.end);
    const tail = await document.data.read(8 + Math.max(start, end - 2), Math.min(2, end - start));
    if (tail.at(-1) === 10) end -= tail.at(-2) === 13 ? 2 : 1;
    const prefix = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await document.data.read(8 + start, Math.min(32, end - start)));
    const slice = (offset: number): StoredText => ({ document, start: Math.min(end, start + offset), end });
    return { prefix, size: end - start, slice, async read(offset) {
      const value = slice(offset);
      if (value.end - value.start > work.limits.maxPathBytes) throw new PatchError("UTF-8 byte limit exceeded");
      let result = "";
      for await (const chunk of textChunks(value)) result += chunk;
      return result;
    } };
  } }, work, metadata);
}
