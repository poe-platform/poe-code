import { FsError, readBytes, type ByteSource } from "../../contracts/index.js";

export interface ByteInputLimits {
  /** Optional maximum cumulative source bytes per invocation. Zero permits empty input. */
  readonly maxInputBytes: number;
}

/** Encoding/checksum input admission only; does not configure compression or shell limits. */
export interface ByteInputOptions {
  readonly limits?: Partial<ByteInputLimits>;
}

export function resolveInputLimit(options: ByteInputOptions): number {
  const maxInputBytes = options.limits?.maxInputBytes;
  if (maxInputBytes === undefined) return Infinity;
  if (maxInputBytes !== Infinity && (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 0)) {
    throw new RangeError("maxInputBytes must be a nonnegative safe integer or Infinity");
  }
  return maxInputBytes;
}

export class ByteInputBudget {
  #bytes = 0;
  #failure: FsError | undefined;

  constructor(readonly maxInputBytes: number) {}

  assertOpen(signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.#failure) throw this.#failure;
  }

  async *read(source: ByteSource, signal: AbortSignal): ByteSource {
    this.assertOpen(signal);
    for await (const chunk of readBytes(source, signal)) {
      this.assertOpen(signal);
      if (chunk.byteLength > this.maxInputBytes - this.#bytes) {
        this.#failure = new FsError("EFBIG", { message: "byte command input limit exceeded" });
        throw this.#failure;
      }
      this.#bytes += chunk.byteLength;
      yield chunk;
      this.assertOpen(signal);
    }
  }
}
