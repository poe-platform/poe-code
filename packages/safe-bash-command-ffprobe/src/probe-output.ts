import { PagedStorage } from "@poe-code/safe-fs/storage";
import { writeBytes } from "safe-bash-contracts/io";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { CommandContext } from "safe-bash-contracts/command";

async function* encodeParts(parts: Iterable<string> | AsyncIterable<string>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let high = "", steps = 0;
  for await (const part of parts) {
    signal.throwIfAborted();
    for (let offset = 0; offset < part.length; offset += 4096) {
      signal.throwIfAborted();
      let text = high + part.slice(offset, offset + 4096); high = "";
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) { high = text.at(-1)!; text = text.slice(0, -1); }
      if (text) yield encoder.encode(text);
      if (++steps % 256 === 0) await yieldTurn(signal);
    }
  }
  if (high) yield encoder.encode(high);
}

/** Preserve admission-before-publication with a bounded cache in caller backing. */
export async function writeProbeOutput(context: CommandContext, parts: Iterable<string> | AsyncIterable<string>, check: (total: number) => void, beforePublish?: () => Promise<void>): Promise<void> {
  const storage = new PagedStorage(context, 4), start = storage.allocate(0);
  let size = 0, failed = true;
  try {
    for await (const bytes of encodeParts(parts, context.signal)) {
      size += bytes.length; check(size);
      await storage.append(bytes);
    }
    context.signal.throwIfAborted();
    await beforePublish?.();
    context.signal.throwIfAborted();
    if (size === 0) await writeBytes(context.stdout, new Uint8Array(0), context.signal);
    for (let offset = 0; offset < size; offset += 16384)
      await writeBytes(context.stdout, await storage.read(start + offset, Math.min(16384, size - offset)), context.signal);
    failed = false;
  } finally {
    if (failed) { try { await storage.close(); } catch { /* Preserve the primary failure. */ } }
    else await storage.close();
  }
}
