import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function createDefaultFileSystem(): FileSystem {
  throw new Error("Cached resources require an injected filesystem in this runtime.");
}
