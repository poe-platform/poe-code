import type { IndexedDocument } from "safe-bash-diff-engine/document";
import { normalized, normalizedCharacter } from "./matcher.js";
import type { Work } from "./shared.js";

export interface StoredText { readonly document: IndexedDocument; readonly start: number; readonly end: number }
export type PatchText = string | StoredText;

export async function* textChunks(value: StoredText): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for await (const bytes of value.document.range(value.start, value.end)) {
    const chunk = decoder.decode(bytes, { stream: true });
    if (chunk) yield chunk;
  }
  const tail = decoder.decode(); if (tail) yield tail;
}

/** Find trim boundaries without retaining a run of whitespace, however long. */
export async function trimStored(value: StoredText, leading: boolean, work: Work): Promise<StoredText> {
  let first = -1, last = value.start, offset = value.start;
  for await (const chunk of textChunks(value)) for (const character of chunk) {
    const code = character.codePointAt(0)!;
    const width = code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (character.trim()) { if (first < 0) first = offset; last = offset + width; }
    offset += width;
    work.step(); if (work.due) await work.checkpoint();
  }
  return { document: value.document, start: leading ? first < 0 ? last : first : value.start, end: last };
}

async function* comparison(value: PatchText, pass: number, work: Work): AsyncGenerator<string> {
  if (typeof value === "string") { yield pass ? await normalized(value, pass, work) : value; return; }
  if (pass) value = await trimStored(value, pass > 1, work);
  for await (const chunk of textChunks(value)) {
    if (pass !== 3) yield chunk;
    else {
      let result = "";
      for (const character of chunk) {
        work.step(); if (work.due) await work.checkpoint();
        result += normalizedCharacter(character);
      }
      yield result;
    }
  }
}

export async function equalText(left: PatchText, right: PatchText, pass: number, work: Work): Promise<boolean> {
  const a = comparison(left, pass, work), b = comparison(right, pass, work);
  let x = "", y = "", i = 0, j = 0, doneA = false, doneB = false;
  try {
    for (;;) {
      while (i === x.length && !doneA) { const item = await a.next(); doneA = !!item.done; x = item.value ?? ""; i = 0; }
      while (j === y.length && !doneB) { const item = await b.next(); doneB = !!item.done; y = item.value ?? ""; j = 0; }
      if (doneA || doneB) return doneA && doneB;
      const count = Math.min(x.length - i, y.length - j);
      await work.charge(count + 1);
      if (x.slice(i, i + count) !== y.slice(j, j + count)) return false;
      i += count; j += count;
    }
  } finally { await a.return(undefined); await b.return(undefined); }
}
