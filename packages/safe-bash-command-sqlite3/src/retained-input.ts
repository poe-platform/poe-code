import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ByteSource, CommandContext } from "safe-bash-contracts";

/** Complete admission before execution, with replayable bytes in caller storage. */
export async function retainInput(source: ByteSource, context: CommandContext, account: (bytes: number) => void) {
  const storage = new PagedStorage(context, 4), start = storage.allocate(0);
  let size = 0;
  try {
    for await (const bytes of source) {
      context.signal.throwIfAborted(); account(bytes.length);
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        context.signal.throwIfAborted();
        const chunk = bytes.subarray(offset, offset + 16384);
        await storage.append(chunk); size += chunk.length;
      }
    }
    context.signal.throwIfAborted();
    async function* bytes(): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < size; offset += 16384) {
        context.signal.throwIfAborted();
        yield await storage.read(start + offset, Math.min(16384, size - offset));
      }
      context.signal.throwIfAborted();
    }
    return {
      size, bytes,
      async *text(): AsyncGenerator<string> {
        const decoder = new TextDecoder();
        for await (const chunk of bytes()) yield decoder.decode(chunk, {stream: true});
        yield decoder.decode();
      },
      close: () => storage.close()
    };
  } catch (error) { await storage.close().catch(() => {}); throw error; }
}
