import type { FileSystem } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { createLlmSpool } from "./retained-spool.js";
import { sourceBytes, waitForSource } from "./request-source.js";
import type { LlmInputSource } from "./types.js";

export interface LlmFragmentInputSource extends LlmInputSource {
  /** Override the composition default for this source, such as HTTP text. */
  readonly normalizeNewlines?: boolean;
}

export interface LlmFragmentSourceOptions {
  readonly fs: FileSystem;
  readonly directory: string;
  readonly signal: AbortSignal;
  /** Sources are acquired sequentially and disposed after composition. */
  readonly fragments: AsyncIterable<LlmFragmentInputSource>;
  /** Already-admitted prompt or system text appended after the fragments. */
  readonly tail?: LlmInputSource;
  readonly system?: boolean;
  /** Match Python text-file universal newlines on fragments (not the tail). */
  readonly normalizeNewlines?: boolean;
  /** Charge raw fragment bytes before retaining them. Tail bytes are excluded. */
  readonly admitBytes?: (size: number, source: LlmFragmentInputSource) => void;
  readonly admitSeparator?: (size: number) => void;
}

function whitespace(code: number): boolean {
  // Python str.strip(), including its C0 separators and excluding BOM.
  return (
    (code >= 9 && code <= 13) ||
    (code >= 28 && code <= 32) ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** Compose reference LLM fragments without history or whole-input buffering.
 * Working memory is bounded; retained content uses the caller's filesystem. */
export async function createLlmFragmentSource(
  options: LlmFragmentSourceOptions
): Promise<LlmInputSource> {
  const { fs, directory, signal } = options;
  let output: Awaited<ReturnType<typeof createLlmSpool>>;
  try {
    output = await createLlmSpool(fs, directory, signal, "input");
  } catch (error) {
    await options.tail?.dispose();
    throw error;
  }
  let count = 0,
    tailDisposed = false;
  const append = async (source: LlmFragmentInputSource, tail = false): Promise<void> => {
    let part: Awaited<ReturnType<typeof createLlmSpool>> | undefined;
    try {
      part = await createLlmSpool(fs, directory, signal, "input");
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      let size = 0,
        start: number | undefined,
        end = 0,
        previousCR = false;
      const normalize = (text: string): string => {
        if (!(source.normalizeNewlines ?? options.normalizeNewlines) || tail) return text;
        let result = "";
        for (const character of text) {
          if (character !== "\n" || !previousCR) result += character === "\r" ? "\n" : character;
          previousCR = character === "\r";
        }
        return result;
      };
      const scan = (text: string): void => {
        for (const character of text) {
          const code = character.codePointAt(0)!;
          const length = code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
          if (!whitespace(code)) {
            start ??= size;
            end = size + length;
          }
          size += length;
        }
      };
      for await (const chunk of sourceBytes(source.bytes, signal)) {
        if (!tail) options.admitBytes?.(chunk.byteLength, source);
        if (!chunk.byteLength) await yieldTurn(signal);
        for (let offset = 0; offset < chunk.byteLength; offset += 16384) {
          await yieldTurn(signal);
          const window = chunk.subarray(offset, offset + 16384);
          const text = normalize(decoder.decode(window, { stream: true }));
          scan(text);
          await part.write(new TextEncoder().encode(text));
        }
      }
      const last = normalize(decoder.decode());
      scan(last);
      if (last) await part.write(new TextEncoder().encode(last));
      if (options.system ? start === undefined : tail && size === 0) return;
      if (count++) {
        const separator = options.system ? Uint8Array.of(10, 10) : Uint8Array.of(10);
        options.admitSeparator?.(separator.byteLength);
        await output.write(separator);
      }
      for await (const chunk of part.replay(
        options.system ? async () => ({ start: start!, end }) : undefined
      ))
        await output.write(chunk);
    } finally {
      try {
        await part?.close();
      } finally {
        if (tail) tailDisposed = true;
        await source.dispose();
      }
    }
  };
  let iterator: AsyncIterator<LlmInputSource> | undefined,
    ended = false;
  try {
    iterator = options.fragments[Symbol.asyncIterator]();
    while (true) {
      await yieldTurn(signal);
      const pending = Promise.resolve().then(() => {
        signal.throwIfAborted();
        return iterator!.next();
      });
      void pending.then(
        (result) => {
          if (signal.aborted && !result.done) void result.value.dispose().catch(() => undefined);
        },
        () => undefined
      );
      const result = await waitForSource(() => pending, signal);
      if (result.done) {
        ended = true;
        break;
      }
      await append(result.value);
    }
    if (options.tail) await append(options.tail, true);
    return { bytes: output.replay(), dispose: output.close };
  } catch (error) {
    await output.close();
    throw error;
  } finally {
    try {
      if (!tailDisposed) await options.tail?.dispose();
    } finally {
      if (iterator && !ended) {
        const retired = Promise.resolve().then(() => iterator!.return?.());
        if (signal.aborted) void retired.catch(() => undefined);
        else await retired;
      }
    }
  }
}
