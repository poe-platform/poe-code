import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function createDefaultFileSystem(): FileSystem { throw new Error("Superintendent requires an injected filesystem in Workers."); }
export function defaultCwd(): string { return "/"; }
export function defaultHome(): string { return "/"; }
