import { RetainedRtfText } from "./retained-rtf.js";
import type { RetainedTextSnapshot } from "./retained-blocks.js";
import { resolvePath } from "@poe-code/safe-fs/core";
import { writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { SofficeCliResult, SofficeLimits } from "./index.js";

import { withSofficeInputs, type RetainedSofficeContext } from "./retained-input.js";

/** Snapshot every operand before stdout admission, then decode one bounded span at a time. */
export async function catRetainedText(inputs: readonly string[], context: RetainedSofficeContext, stdout: ByteSink, limits: SofficeLimits, chargeOutput: (bytes: number) => void): Promise<SofficeCliResult> {
  const { cwd, signal } = context;
  let work = 0;
  const checkpoint = async () => { signal.throwIfAborted(); if (++work % 64 === 0) await yieldTurn(signal); };
  return withSofficeInputs(inputs, context, limits, async (storage, sources) => {
    for (const input of inputs) if (!sources.get(resolvePath(cwd, input))) {
      return { exitCode: 1, stdout: "", stderr: `Error: source file could not be loaded: ${input}\n` };
    }
    const rtf = new RetainedRtfText(storage, signal), richText = new Map<string, RetainedTextSnapshot>();
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
    return { exitCode: 0, stdout: "", stderr: "" };
  });
}
