import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { RetainedOfficeBlocks } from "./retained-office-blocks.js";
import type { SofficeSnapshot } from "./retained-input.js";

/** Parse cells incrementally; payloads and row indexes belong to caller storage. */
export async function retainCsv(storage: PagedStorage, source: SofficeSnapshot, blocks: RetainedOfficeBlocks, signal: AbortSignal): Promise<void> {
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  let field = "", position = storage.allocate(0), size = 0, cells = 0;
  let quoted = false, pendingQuote = false, skipLF = false, last = "", work = 0;
  const flush = async () => {
    if (!field) return;
    const bytes = encoder.encode(field); await storage.append(bytes); size += bytes.length; field = "";
  };
  const cell = async () => {
    await flush(); await blocks.cell({ position, size }); cells++;
    position = storage.allocate(0); size = 0;
  };
  const row = async () => {
    await cell(); await blocks.endRow(); cells = 0; position = storage.allocate(0);
  };
  blocks.beginTable();
  async function consume(text: string): Promise<void> {
    for (const char of text) {
      last = char;
      if (skipLF) { skipLF = false; if (char === "\n") continue; }
      if (pendingQuote) {
        pendingQuote = false;
        if (char === '"') { field += char; if (field.length >= 4096) await flush(); continue; }
        quoted = false;
      }
      if (char === '"') {
        if (quoted) pendingQuote = true;
        else if (!size && !field.length) quoted = true;
        else field += char;
      } else if (!quoted && char === ",") await cell();
      else if (!quoted && (char === "\r" || char === "\n")) { await row(); skipLF = char === "\r"; }
      else field += char;
      if (field.length >= 4096) await flush();
    }
  }
  for (let offset = 0; offset < source.size; offset += 16384) {
    signal.throwIfAborted(); if (++work % 64 === 0) await yieldTurn(signal);
    await consume(decoder.decode(await storage.read(source.position + offset, Math.min(16384, source.size - offset)), { stream: true }));
  }
  await consume(decoder.decode());
  if (quoted && !pendingQuote) throw new Error("Invalid CSV: unterminated quoted field");
  if (last && (size || field.length || cells || (last !== "\r" && last !== "\n"))) await row();
  await blocks.endTable(true);
}
