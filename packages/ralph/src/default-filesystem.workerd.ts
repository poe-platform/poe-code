import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function createDefaultFileSystem(): FileSystem { throw new Error("Ralph requires an injected filesystem in Workers."); }
