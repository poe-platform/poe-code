import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type { GaslightSpawn, GaslightCollectHumanPrompts } from "./types.js";
export function createDefaultFileSystem(): FileSystem { throw new Error("Gaslight requires an injected filesystem in Workers."); }
export const hostEnvironment = { homedir(): string { throw new Error("Gaslight requires an explicit homeDir in Workers."); } };
export const defaultSpawn: GaslightSpawn = async () => { throw new Error("Gaslight requires an injected spawn capability in Workers."); };
export const collectHumanPromptsWithStats: GaslightCollectHumanPrompts = async () => { throw new Error("Gaslight ingestion requires an injected collectHumanPrompts capability in Workers."); };
export const hostCwd = (): string => "/";
export const hostEnv = (): Record<string, string | undefined> => ({});
