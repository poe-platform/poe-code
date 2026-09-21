import fsPromises from "node:fs/promises";
import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
type MemoryPluginFileSystem = Pick<typeof fsPromises, "lstat" | "readFile" | "realpath">;
export type MemoryPluginOptions = {
  cwd?: string;
  homeDir?: string;
  fs?: MemoryPluginFileSystem;
};
export type MemoryPluginConfigOptions = Pick<MemoryPluginOptions, "cwd" | "homeDir">;
declare const memoryPlugin: (options?: MemoryPluginOptions) => AgentPlugin;
export default memoryPlugin;
export declare const spec: PluginSpec<MemoryPluginConfigOptions>;
