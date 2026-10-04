import { PagedStorage } from "@poe-code/safe-fs/storage";
import { readBytes, type ByteSource } from "safe-bash-contracts";
import { IndexedDocument } from "safe-bash-diff-engine/document";
import { decodeBytes, encodeBytes } from "safe-bash-io-engine/byte-encoding";
import type { DiffFlags } from "./diff-options.js";

/** Hold only a pending CR across block boundaries. Lone CRs remain byte text. */
export async function* stripTrailingCr(source: ByteSource, signal: AbortSignal): ByteSource {
  const output = new Uint8Array(16384);
  let used = 0, pending = false;
  for await (const bytes of readBytes(source, signal)) {
    for (const byte of bytes) {
      if (pending && byte !== 10) {
        output[used++] = 13;
        if (used === output.length) { yield output.slice(); used = 0; }
      }
      pending = byte === 13;
      if (!pending) {
        output[used++] = byte;
        if (used === output.length) { yield output.slice(); used = 0; }
      }
    }
  }
  if (pending) output[used++] = 13;
  if (used) yield output.slice(0, used);
}

/** Decode bounded ranges with the pair's byte-text fallback, never a whole line. */
export async function* documentText(document: IndexedDocument, start: number, end: number, utf8: boolean): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for await (const bytes of document.range(start, end)) {
    yield utf8 ? decoder.decode(bytes, { stream: true }) : decodeBytes(bytes, "latin1");
  }
  if (utf8) { const tail = decoder.decode(); if (tail) yield tail; }
}

export async function* expandedSource(document: IndexedDocument, start: number, end: number, utf8: boolean): ByteSource {
  let column = 0, pending = "";
  for await (const text of documentText(document, start, end, utf8)) {
    for (const character of text) {
      if (character === "\t") { const count = 8 - column % 8; pending += " ".repeat(count); column += count; }
      else {
        pending += character;
        if (character === "\r") column = 0;
        else if (character === "\b") column = Math.max(0, column - 1);
        else column++;
      }
      if (pending.length >= 4096) { yield encodeBytes(pending, utf8 ? "utf8" : "latin1"); pending = ""; }
    }
  }
  if (pending) yield encodeBytes(pending, utf8 ? "utf8" : "latin1");
}

/** Stage each normalized line so trailing whitespace can be discarded without retaining it. */
export async function* comparisonSource(document: IndexedDocument, options: DiffFlags, utf8: boolean): ByteSource {
  const storage = new PagedStorage(document.budget.context, 16);
  document.budget.context.registerCleanup?.(() => storage.close());
  const encoder = new TextEncoder();
  let position = 0;
  try {
    for (let index = 0; index < document.length; index++) {
      const bounds = await document.line(index);
      const terminated = (await document.data.read(8 + bounds.end - 1, 1))[0] === 10;
      const start = position;
      let lastNonWhitespace = start, pending = "", pendingBytes = 0, column = 0, previousWhitespace = false;
      const flush = async () => {
        if (!pending) return;
        const bytes = encoder.encode(pending);
        await storage.append(bytes);
        position += bytes.length;
        pending = ""; pendingBytes = 0;
      };
      for await (const text of documentText(document, bounds.start, bounds.end - Number(terminated), utf8)) {
        for (const character of text) {
          let expanded = character;
          if (options.ignoreTabs) {
            if (character === "\t") { const count = 8 - column % 8; expanded = " ".repeat(count); column += count; }
            else if (character === "\r") column = 0;
            else if (character === "\b") column = Math.max(0, column - 1);
            else column++;
          }
          for (let value of expanded) {
            const whitespace = value === " " || value === "\t" || value === "\v" || value === "\f" || value === "\r";
            if (whitespace && options.whitespace === "all") continue;
            if (whitespace && options.whitespace === "change") {
              if (previousWhitespace) continue;
              value = " ";
            }
            previousWhitespace = whitespace;
            if (options.ignoreCase && value >= "A" && value <= "Z") value = value.toLowerCase();
            pending += value;
            const code = value.codePointAt(0)!;
            pendingBytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
            if (!whitespace) lastNonWhitespace = position + pendingBytes;
            if (pending.length >= 4096) await flush();
          }
        }
      }
      await flush();
      const end = options.ignoreTrailing || options.whitespace !== "exact" ? lastNonWhitespace : position;
      for (let offset = start; offset < end; offset += 16384) {
        yield await storage.read(8 + offset, Math.min(16384, end - offset));
      }
      // Whitespace options ignore absent final LF; case folding alone does not.
      if (terminated || options.whitespace !== "exact" || options.ignoreTrailing || options.ignoreTabs) yield new Uint8Array([10]);
    }
  } finally { await storage.close(); }
}

/** Ed compares a missing final LF as if it were present, after reporting it. */
export async function* terminatedSource(document: IndexedDocument): ByteSource {
  yield* document.range(0, document.size);
  if (document.size && (await document.data.read(8 + document.size - 1, 1))[0] !== 10) yield new Uint8Array([10]);
}
