import { PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import type { MediaProbeSource } from "@poe-code/mp4-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { readBytes } from "safe-bash-contracts/io";
import { readFileStream } from "safe-bash-contracts/filesystem";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function openProbeStream(context: CommandContext, path?: string): Promise<AsyncIterable<Uint8Array> | undefined> {
  context.signal.throwIfAborted();
  if (path === undefined) return readBytes(context.stdin, context.signal);
  const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
  context.signal.throwIfAborted();
  if (!context.fs.readStream || capabilities.streamingRead === false || context.fs.capabilities.streamingRead === false) return undefined;
  return readFileStream(context.fs, path, { signal: context.signal, chunkSize: 16384 });
}

/** Retain only the signature and the current borrowed chunk; replay every byte once. */
export async function sniffMediaStream(source: AsyncIterable<Uint8Array>, signal: AbortSignal, account: (total: number) => void) {
  const iterator = source[Symbol.asyncIterator](), prefix = new Uint8Array(12);
  let size = 0, total = 0, ended = false;
  let remainder: Uint8Array = new Uint8Array(0);
  try {
    while (size < prefix.length) {
      signal.throwIfAborted();
      const next = await iterator.next();
      signal.throwIfAborted();
      if (next.done) { ended = true; break; }
      total += next.value.length; account(total);
      const take = Math.min(prefix.length - size, next.value.length);
      prefix.set(next.value.subarray(0, take), size); size += take;
      remainder = next.value.subarray(take);
    }
  } catch (error) {
    try { await iterator.return?.(); } catch { /* Preserve admission failure. */ }
    throw error;
  }
  async function* replay() {
    let failed = false;
    try {
      signal.throwIfAborted();
      if (size) yield prefix.subarray(0, size);
      if (remainder.length) yield remainder;
      remainder = new Uint8Array(0);
      while (!ended) {
        signal.throwIfAborted();
        const next = await iterator.next();
        signal.throwIfAborted();
        if (next.done) { ended = true; break; }
        total += next.value.length; account(total);
        yield next.value;
      }
    } catch (error) { failed = true; throw error; }
    finally {
      if (!ended) {
        if (failed) { try { await iterator.return?.(); } catch { /* Preserve the primary failure. */ } }
        else await iterator.return?.();
      }
    }
  }
  return { prefix: prefix.subarray(0, size), stream: replay() };
}

/** Replay through the caller's backing, so strict and fallback probes see one admitted input. */
export async function withStagedProbeSource<T>(context: PagedStorageContext, input: AsyncIterable<Uint8Array>, probe: (source: MediaProbeSource) => Promise<T>, retain?: (close: () => Promise<void>) => void): Promise<T> {
  const storage = new PagedStorage(context, 4);
  retain?.(storage.close.bind(storage));
  let start: number | undefined;
  let size = 0, steps = 0, failed = true;
  try {
    for await (const chunk of input) {
      context.signal.throwIfAborted();
      size += chunk.length;
      start ??= storage.allocate(0);
      await storage.append(chunk);
      if (++steps % 256 === 0) await yieldTurn(context.signal);
    }
    context.signal.throwIfAborted();
    start ??= storage.allocate(0);
    const base = start;
    const result = await probe({ size, read: (offset, length) => storage.read(base + offset, length) });
    context.signal.throwIfAborted();
    failed = false;
    return result;
  } finally {
    if (!retain) {
      if (failed) { try { await storage.close(); } catch { /* Preserve the primary failure. */ } }
      else await storage.close();
    }
  }
}
