import { readBytes, writeBytes, type ByteSink, type ByteSource } from "../../contracts/io.js";
import type { CommandContext } from "../../contracts/command.js";
import { createOutputOperation } from "../../contracts/output.js";

export function documentByteSource(source: ByteSource): { open(signal: AbortSignal): AsyncIterable<Uint8Array> } {
  return { open: signal => readBytes(source, signal) };
}

export function documentByteSink(sink: ByteSink): { write(bytes: Uint8Array, signal: AbortSignal): Promise<void> } {
  return { write: (bytes, signal) => writeBytes(sink, bytes, signal) };
}

export function createDocumentOutput(context: Pick<CommandContext, "signal" | "registerCleanup">, destination: ByteSink): {
  readonly sink: { write(bytes: Uint8Array, signal: AbortSignal): Promise<void> };
  readonly cleanup: () => Promise<void>;
} {
  const operation = createOutputOperation(context, destination);
  return {
    sink: documentByteSink(operation.output),
    cleanup: operation.close,
  };
}
