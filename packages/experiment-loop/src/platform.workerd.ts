import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function createDefaultFileSystem(): FileSystem { throw new Error("Experiments require an injected filesystem in Workers."); }
export const hostCwd = (): string => "/";
export const hostEnv = (): Record<string, string | undefined> => ({});
