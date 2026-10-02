import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type { spawn } from "@poe-code/agent-spawn";
export function createDefaultFileSystem(): FileSystem { throw new Error("Memory requires an injected filesystem in Workers."); }
export const defaultSpawn: (...args: Parameters<typeof spawn>) => ReturnType<typeof spawn> = async () => { throw new Error("Memory requires an injected agent runner in Workers."); };
export function countTokens(_text: string): number { throw new Error("Memory requires an injected countTokens function in Workers."); }
export { createProtocolServer as createServer } from "tiny-stdio-mcp-server/core";
