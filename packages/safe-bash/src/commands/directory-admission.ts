import { FsError, type CommandContext, type DirectoryEntry } from "../contracts/index.js";
import { yieldTurn } from "../contracts/yield.js";

export function createDirectoryReader(maxEntries = 10000) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    throw new RangeError("maxDirectoryEntries must be a nonnegative safe integer");
  }
  return async (context: CommandContext, path: string, ordered = false): Promise<DirectoryEntry[]> => {
    context.signal.throwIfAborted();
    const entries = await context.fs.readdir(path, { signal: context.signal, maxEntries });
    context.signal.throwIfAborted();
    if (entries.length > maxEntries) {
      throw new FsError("EFBIG", { syscall: "readdir", path, message: "directory entry limit exceeded" });
    }
    await yieldTurn(context.signal);
    if (ordered) {
      for (let index = 1; index < entries.length; index++) {
        if (index % 256 === 0) await yieldTurn(context.signal);
        if (entries[index - 1]!.name > entries[index]!.name) {
          return entries.slice().sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        }
      }
    }
    return entries;
  };
}

export type DirectoryReader = ReturnType<typeof createDirectoryReader>;
