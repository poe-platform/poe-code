import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
type MemoryPluginFileSystem = {
  lstat(path: string): Promise<{
    isSymbolicLink(): boolean;
  }>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  realpath(path: string): Promise<string>;
};
export type MemoryPluginOptions = {
  cwd?: string;
  homeDir?: string;
  fs?: MemoryPluginFileSystem;
};
export type MemoryPluginConfigOptions = Pick<MemoryPluginOptions, "cwd" | "homeDir">;
declare const memoryPlugin: (options?: MemoryPluginOptions) => AgentPlugin;
export default memoryPlugin;
export declare const spec: PluginSpec<MemoryPluginConfigOptions>;
