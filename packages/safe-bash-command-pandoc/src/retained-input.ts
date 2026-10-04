import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {ExecutionContext} from "./execution.js";
import type {Limits} from "./types.js";

/** Preserve acquisition-before-decoding budgets using caller-backed bytes. */
export async function* retainInput(chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>, context: ExecutionContext, storage: PagedStorage, budgets: readonly (keyof Limits)[]): AsyncGenerator<Uint8Array> {
  const start = storage.allocate(0); let length = 0;
  await context.consume(chunks, async bytes => {
    const count = Math.ceil((length + bytes.length) / 4096) - Math.ceil(length / 4096);
    for (let index = 0; index < count; index++) context.charge("references", 1);
    await storage.append(bytes); length += bytes.length;
  }, budgets);
  for (let offset = 0; offset < length; offset += 16384)
    yield await storage.read(start + offset, Math.min(16384, length - offset));
}
