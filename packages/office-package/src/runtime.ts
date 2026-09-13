export type ByteSource = AsyncIterable<Uint8Array>;

export class CodecError extends Error {
  readonly code: "invalid-package" | "resource-limit";
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
    this.code = message.includes("limit") ? "resource-limit" : "invalid-package";
  }
}

export interface CodecRuntime {
  yieldTurn(signal: AbortSignal): Promise<void>;
  readBytes(source: ByteSource, signal: AbortSignal): AsyncGenerator<Uint8Array>;
  diagnostic(error: unknown): unknown;
}

export const defaultRuntime: CodecRuntime = {
  async yieldTurn(signal) {
    signal.throwIfAborted();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal.throwIfAborted();
  },
  async *readBytes(source, signal) {
    signal.throwIfAborted();
    for await (const bytes of source) {
      signal.throwIfAborted();
      if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected byte chunks");
      yield bytes;
    }
    signal.throwIfAborted();
  },
  diagnostic(error) {
    return error instanceof Error ? new CodecError(error.message) : error;
  }
};
