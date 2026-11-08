import { readBytes, writeBytes, type ByteSink, type ByteSource } from "safe-bash-contracts/io";
import type { CommandContext } from "safe-bash-contracts/command";
import { createOutputOperation } from "safe-bash-contracts/output";

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
