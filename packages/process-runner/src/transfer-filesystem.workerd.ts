import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function createDefaultFileSystem(): FileSystem { throw new Error("Workspace transfer requires an injected filesystem in Workers."); }
