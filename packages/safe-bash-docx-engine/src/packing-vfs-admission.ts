import type { FileSystem } from "@poe-code/safe-fs/core";
import { CancellationError, InvalidContainerError } from "./archive.js";
import type { DocumentBudget } from "./budget.js";

/** Preflight the complete declared VFS inventory before any payload acquisition. */
export async function admitPackingFiles(
  files: readonly { readonly path: string; readonly bytes: number }[],
  context: { readonly filesystem: FileSystem; readonly signal: AbortSignal; readonly budget: DocumentBudget }
): Promise<void> {
  const { filesystem: fs, signal, budget } = context;
  const directories = new Set<string>();
  for (const { path, bytes } of files) {
    try {
      if (signal.aborted) throw new CancellationError("Archive packing cancelled.", { cause: signal.reason });
      await budget.checkpoint(1);
      let parent = "";
      for (const segment of path.split("/").slice(1, -1)) {
        parent += "/" + segment;
        if (directories.has(parent)) continue;
        const stat = await fs.lstat(parent, { signal });
        if (stat.type !== "directory" || await fs.realpath(parent, { signal }) !== parent) throw new InvalidContainerError("Inventory VFS ancestors must be canonical directories.");
        directories.add(parent);
      }
      const stat = await fs.lstat(path, { signal });
      if (stat.type !== "file" || await fs.realpath(path, { signal }) !== path) throw new InvalidContainerError("Inventory payloads must be canonical regular files.");
      signal.throwIfAborted();
      if (stat.size !== bytes) throw new InvalidContainerError("Inventory payload byte length mismatch.");
    } catch (error) {
      if (signal.aborted) throw new CancellationError("Archive packing cancelled.", { cause: signal.reason });
      throw error;
    }
  }
}
