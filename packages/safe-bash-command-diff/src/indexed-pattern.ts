import { IntegerTable, PagedStorage, PagedStorageCache } from "@poe-code/safe-fs/storage";
import { closeDocumentResources, type IndexedDocument } from "safe-bash-diff-engine/document";
import type { Pattern } from "safe-bash-regex-engine/text/regex";
import type { Budget } from "safe-bash-diff-engine/shared";
import { documentText } from "./indexed-normalization.js";

/** Backreference captures and the search frontier share caller-backed pages. */
export async function matchesPattern(pattern: Pattern, document: IndexedDocument, start: number, end: number, utf8: boolean, budget: Budget): Promise<boolean> {
  if (await pattern.supportsStreamTest(budget)) return pattern.testStream(documentText(document, start, end, utf8), budget);
  const cache = new PagedStorageCache(16);
  const text = new PagedStorage(budget.context, 16, cache);
  const records = new PagedStorage(budget.context, 16, cache);
  const index = new PagedStorage(budget.context, 16, cache);
  const hashes = new IntegerTable(index, 256);
  let length = 0, cursor = 8, tail = 8;
  const record = async (offset: number): Promise<Uint8Array> => {
    const header = await records.read(offset, 16);
    const size = new DataView(header.buffer).getFloat64(8, true);
    const result = new Uint8Array(size);
    for (let at = 0; at < size; at += 16384) result.set(await records.read(offset + at, Math.min(16384, size - at)), at);
    return result;
  };
  try {
    for await (const chunk of documentText(document, start, end, utf8)) {
      for (let at = 0; at < chunk.length; at += 8192) {
        const count = Math.min(8192, chunk.length - at), bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
        for (let unit = 0; unit < count; unit++) view.setUint16(unit * 2, chunk.charCodeAt(at + unit), true);
        await text.append(bytes); length += count;
        budget.step(count); const pause = budget.checkpoint(); if (pause) await pause;
      }
    }
    return await pattern.testStored({ length,
      async read(start, count) {
        const bytes = await text.read(8 + start * 2, count * 2), view = new DataView(bytes.buffer);
        let result = "";
        for (let at = 0; at < count; at++) result += String.fromCharCode(view.getUint16(at * 2, true));
        return result;
      },
      async enqueue(state) {
        const bytes = new Uint8Array(16 + state.length * 8), view = new DataView(bytes.buffer);
        view.setFloat64(8, bytes.length, true);
        for (let at = 0; at < state.length; at++) view.setFloat64(16 + at * 8, state[at]!, true);
        let hash = 2166136261;
        for (let at = 8; at < bytes.length; at++) hash = Math.imul(hash ^ bytes[at]!, 16777619) >>> 0;
        const head = Number(await hashes.get(BigInt(hash)) ?? 0n);
        for (let offset = head; offset;) {
          const previous = await record(offset);
          budget.step(previous.length); const pause = budget.checkpoint(); if (pause) await pause;
          if (previous.length === bytes.length && previous.subarray(8).every((byte, at) => byte === bytes[at + 8])) return;
          offset = new DataView(previous.buffer).getFloat64(0, true);
        }
        view.setFloat64(0, head, true);
        const offset = await records.append(bytes);
        tail = offset + bytes.length;
        await hashes.set(BigInt(hash), BigInt(offset));
        budget.step(bytes.length);
      },
      async dequeue() {
        if (cursor === tail) return undefined;
        const bytes = await record(cursor), view = new DataView(bytes.buffer);
        cursor += bytes.length;
        return Array.from({ length: (bytes.length - 16) / 8 }, (_, at) => view.getFloat64(16 + at * 8, true));
      },
    }, budget);
  } finally { await closeDocumentResources([text, records, index]); }
}
