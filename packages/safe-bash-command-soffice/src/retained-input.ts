import { readFileStream, resolvePath } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { SofficeLimits } from "./index.js";

export interface SofficeSnapshot { readonly position: number; readonly size: number }
export interface RetainedSofficeContext {
  readonly fs: FileSystem; readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal; readonly inputBudget?: { check(bytes: number): void };
}

/** Retain input identity once across aliases, conversion chains and output publication. */
export async function withSofficeInputs<T>(inputs: readonly string[], context: RetainedSofficeContext, limits: SofficeLimits,
  run: (storage: PagedStorage, sources: Map<string, SofficeSnapshot | undefined>) => Promise<T>): Promise<T> {
  const { fs, cwd, signal } = context;
  const storage = new PagedStorage(context), sources = new Map<string, SofficeSnapshot | undefined>();
  let inputBytes = 0, failed = true, work = 0;
  const checkpoint = async () => { signal.throwIfAborted(); if (++work % 64 === 0) await yieldTurn(signal); };
  try {
    for (const input of inputs) {
      const path = resolvePath(cwd, input);
      if (sources.has(path)) continue;
      const position = storage.allocate(0), stream = readFileStream(fs, path, { signal, chunkSize: 16384 });
      let size = 0, missing = false, readFailed = true;
      try {
        for (;;) {
          let next: IteratorResult<Uint8Array>;
          try { next = await stream.next(); }
          catch { signal.throwIfAborted(); missing = true; break; }
          if (next.done) break;
          await checkpoint();
          const chunk = next.value;
          context.inputBudget?.check(inputBytes + size + chunk.length);
          if (inputBytes + size + chunk.length > limits.maxInputBytes) throw new RangeError("Input byte limit exceeded");
          const start = storage.allocate(chunk.length);
          for (let offset = 0; offset < chunk.length; offset += 16384) {
            signal.throwIfAborted();
            await storage.write(start + offset, chunk.subarray(offset, offset + 16384));
          }
          size += chunk.length;
        }
        readFailed = false;
      } finally { await stream.return(undefined).catch(error => { if (!readFailed) throw error; }); }
      sources.set(path, missing ? undefined : { position, size });
      if (!missing) inputBytes += size;
    }
    const result = await run(storage, sources);
    failed = false;
    return result;
  } finally { await storage.close().catch(error => { if (!failed) throw error; }); }
}
