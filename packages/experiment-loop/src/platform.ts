import "@poe-code/agent-spawn/register-factories";
export { createHostFileSystem as createDefaultFileSystem } from "@poe-code/safe-fs/node";
export const hostCwd = (): string => process.cwd();
export const hostEnv = (): Record<string, string | undefined> => process.env;
