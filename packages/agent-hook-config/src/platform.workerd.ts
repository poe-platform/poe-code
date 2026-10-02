import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function homedir(): string { return "/"; }
export function defaultFileSystem(): FileSystem { throw new Error("Hook operations require an injected filesystem in Workers."); }
