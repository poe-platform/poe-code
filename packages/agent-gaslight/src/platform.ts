export { createHostFileSystem as createDefaultFileSystem } from "@poe-code/safe-fs/node";
export { default as hostEnvironment } from "node:os";
export { spawn as defaultSpawn } from "@poe-code/agent-spawn";
export { collectHumanPromptsWithStats } from "@poe-code/agent-traces";
export const hostCwd = (): string => process.cwd();
export const hostEnv = (): Record<string, string | undefined> => process.env;
