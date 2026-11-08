import type { FileSystem } from "@poe-code/safe-fs/contracts";

export function createDefaultFileSystem(): FileSystem {
  throw new Error("Markdown reading requires an injected filesystem in this runtime.");
}
