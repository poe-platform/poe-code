import { posixPath } from "@poe-code/safe-fs/runtime-core";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type * as Host from "./platform.js";
export const nativePath = { ...posixPath, posix: posixPath };
export const hostEnvironment = { homedir: () => "/" };
export const hostProcess = { cwd: () => "/", env: {}, version: "workerd", platform: "workerd",
  kill() { throw new Error("Host processes are unavailable in Workers."); } };
export const fsPromises: typeof Host.fsPromises = new Proxy({} as typeof Host.fsPromises, {
  get() { throw new Error("Provide an explicit filesystem in Workers."); }
});
export function createHostFileSystem(): FileSystem { throw new Error("Provide an explicit filesystem in Workers."); }
export const spawn: typeof Host.spawn = () => { throw new Error("Host shell commands are unavailable in Workers. Use safe-bash with runtime.fs."); };
export const execFile: typeof Host.execFile = (() => { throw new Error("Provide an explicit filesystem for portable searches."); }) as typeof Host.execFile;
export function fastGlob(..._args: Parameters<typeof Host.fastGlob>): ReturnType<typeof Host.fastGlob> { throw new Error("Provide an explicit filesystem for portable searches."); }
export const createSecretStore: typeof Host.createSecretStore = () => { throw new Error("Provide an explicit API key in Workers."); };
export const StdioTransport: typeof Host.StdioTransport = class {
  constructor() { throw new Error("Stdio MCP transports require a host process capability."); }
} as unknown as typeof Host.StdioTransport;
export const runCommand: typeof Host.runCommand = async () => { throw new Error("Host Git context is unavailable in Workers."); };
