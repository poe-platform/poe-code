import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { iterateQpdfPageRange } from "./page-range.js";
import type { RetainedQpdfOptions } from "./retained.js";
import { copyRetainedPagesChunks, type PdfIndexStorage, type PdfOutputEntry, type PdfRetainedDocument } from "@poe-code/pdf-ast";

export function formatSplitName(template: string, total: number, group: number, start: number, end: number): string {
  const padLen = String(total).length;
  const first = String(start).padStart(padLen, "0"), last = String(end).padStart(padLen, "0");
  const range = group === 1 ? first : `${first}-${last}`;
  if (template.includes("%d")) return template.replace("%d", range);
  const extension = template.toLowerCase().endsWith(".pdf") ? template.slice(-4) : "";
  const stem = extension ? template.slice(0, -4) : template;
  return `${stem}-${range}${extension}`;
}

export async function* splitPageOutputs(document: PdfRetainedDocument, storage: PdfIndexStorage, target: string, group: number,
  edits: RetainedQpdfOptions["rotateSpecs"], signal: AbortSignal, normalizeContent = false, linearize = false, objectStreams: RetainedQpdfOptions["objectStreamsMode"] = "preserve"): AsyncGenerator<PdfOutputEntry> {
  const backing = edits.length ? new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4) : undefined;
  const rotations = backing ? new IntegerTable(backing) : undefined;
  let failed = false;
  try {
    let count = 0;
    for await (const page of document.pages()) { if (rotations) await rotations.set(BigInt(count), BigInt((await page.attributes()).rotation / 90)); count++; }
    for (const edit of edits) for (const number of iterateQpdfPageRange(edit.range, count)) {
      signal.throwIfAborted();
      const index = BigInt(number - 1), current = edit.relative ? (await rotations!.get(index))! % 4n : 0n;
      const delta = BigInt(edit.angle / 90 * (edit.relative ? edit.sign : 1));
      await rotations!.set(index, ((current + delta) % 4n + 4n) % 4n + 4n);
    }
    const source = await document.info(), metadata: Record<string, string> = {};
    for (const key of ["Title", "Author", "Subject", "Keywords"]) if (source[key]) metadata[key] = source[key]!;
    const pageRotation = rotations ? async (ignoredDocument: PdfRetainedDocument, index: number) => {
      const value = await rotations.get(BigInt(index)); return value !== undefined && value >= 4n ? Number(value % 4n) * 90 : undefined;
    } : undefined;
    for (let start = 0; start < count; start += group) {
      signal.throwIfAborted(); const end = Math.min(count, start + group);
      function* indices() { for (let index = start; index < end; index++) yield index; }
      yield { name: formatSplitName(target, count, group, start + 1, end), chunks: copyRetainedPagesChunks(document, indices(), storage, { metadata, signal, normalizeContent, linearize, objectStreams, ...(pageRotation ? { pageRotation } : {}) }) };
    }
  } catch (error) { failed = true; throw error; }
  finally { await backing?.close().catch(error => { if (!failed) return Promise.reject(error); }); }
}
