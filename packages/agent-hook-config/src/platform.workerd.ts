import type { FileSystem } from "@poe-code/safe-fs/contracts";
export { posixPath as path } from "@poe-code/safe-fs";
export function homedir(): string { return "/"; }
export function defaultFileSystem(): FileSystem { throw new Error("Hook operations require an injected filesystem in Workers."); }
