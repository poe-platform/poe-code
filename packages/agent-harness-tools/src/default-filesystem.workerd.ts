import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function createDefaultFileSystem(): FileSystem {
  throw new Error("Harness tools require an injected filesystem in this runtime.");
}
