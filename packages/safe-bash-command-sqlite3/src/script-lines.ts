import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ByteSource, CommandContext } from "safe-bash-contracts";

/** Admit the complete input before running commands, retaining it in caller
 * storage. Only the current decoded line is handed to the SQL statement parser. */
export async function* stagedScriptLines(source: ByteSource, context: CommandContext,
  account: (bytes: number) => void): AsyncGenerator<string> {
  const storage = new PagedStorage(context, 4), start = storage.allocate(0);
  let size = 0, failed = false;
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
    const decoder = new TextDecoder();
    let pending = "";
    for (let offset = 0; offset < size; offset += 16384) {
      context.signal.throwIfAborted();
      const text = decoder.decode(await storage.read(start + offset, Math.min(16384, size - offset)), { stream: true });
      let from = 0;
      for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", from)) {
        const line = pending + text.slice(from, at); pending = "";
        context.signal.throwIfAborted();
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        from = at + 1;
      }
      pending += text.slice(from);
    }
    context.signal.throwIfAborted();
    yield pending + decoder.decode();
  } catch (error) { failed = true; throw error; } finally {
    await storage.close().catch(error => { if (!failed) throw error; });
  }
}
