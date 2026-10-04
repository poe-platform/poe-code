import { RetainedRtfText, type RetainedRtfSnapshot } from "./retained-rtf.js";
import { readFileStream, resolvePath } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { SofficeCliResult, SofficeLimits } from "./index.js";

type Snapshot = { readonly position: number; readonly size: number };

/** Snapshot every operand before stdout admission, then decode one bounded span at a time. */
export async function catRetainedText(inputs: readonly string[], context: {
  readonly fs: FileSystem; readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal; readonly inputBudget?: { check(bytes: number): void };
}, stdout: ByteSink, limits: SofficeLimits, chargeOutput: (bytes: number) => void): Promise<SofficeCliResult> {
  const { fs, cwd, signal } = context;
  const storage = new PagedStorage(context), sources = new Map<string, Snapshot | undefined>();
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
    for (const input of inputs) if (!sources.get(resolvePath(cwd, input))) {
      failed = false;
      return { exitCode: 1, stdout: "", stderr: `Error: source file could not be loaded: ${input}\n` };
    }
    const rtf = new RetainedRtfText(storage, signal), richText = new Map<string, RetainedRtfSnapshot>();
    for (const input of inputs) if (input.toLowerCase().endsWith(".rtf")) {
      const path = resolvePath(cwd, input);
      if (!richText.has(path)) {
        const source = sources.get(path)!;
        richText.set(path, await rtf.retain(source.position, source.size));
      }
    }
    async function* output(): AsyncGenerator<Uint8Array> {
      const encoder = new TextEncoder();
      for (const input of inputs) {
        const retained = input.toLowerCase().endsWith(".rtf") ? richText.get(resolvePath(cwd, input)) : undefined;
        if (retained) { yield* rtf.stream(retained); yield Uint8Array.of(10); continue; }
        const source = sources.get(resolvePath(cwd, input))!, decoder = new TextDecoder();
        for (let offset = 0; offset < source.size; offset += 16384) {
          await checkpoint();
          const bytes = await storage.read(source.position + offset, Math.min(16384, source.size - offset));
          const text = decoder.decode(bytes, { stream: true });
          if (text) yield encoder.encode(text);
        }
        yield encoder.encode(decoder.decode() + "\n");
      }
    }
    // Legacy cat admits its complete output budget before any stdout bytes escape.
    for await (const chunk of output()) chargeOutput(chunk.length);
    for await (const chunk of output()) await writeBytes(stdout, chunk, signal);
    failed = false;
    return { exitCode: 0, stdout: "", stderr: "" };
  } finally { await storage.close().catch(error => { if (!failed) throw error; }); }
}
