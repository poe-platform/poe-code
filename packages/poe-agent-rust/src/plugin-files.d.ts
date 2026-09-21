import fsPromises from "node:fs/promises";
import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
type PluginFileSystem = Pick<
  typeof fsPromises,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "stat" | "unlink" | "writeFile"
>;
type GrepOutputMode = "files_with_matches" | "content" | "count";
type SearchContentOptions = {
  pattern: string;
  path: string;
  glob?: string;
  outputMode: GrepOutputMode;
  lineNumbers: boolean;
  ignoreCase: boolean;
  signal: AbortSignal;
};
type SearchContentFn = (options: SearchContentOptions) => Promise<string>;
type GlobFilesOptions = {
  pattern: string;
  cwd: string;
};
type GlobFilesFn = (options: GlobFilesOptions) => Promise<string[]>;
type FilesPluginOptions = {
  cwd?: string;
  allowedPaths?: string[];
  fs?: PluginFileSystem;
  searchContent?: SearchContentFn;
  globFiles?: GlobFilesFn;
};
export type FilesPluginConfigOptions = Pick<FilesPluginOptions, "cwd" | "allowedPaths">;
declare const filesPlugin: (options?: FilesPluginOptions) => AgentPlugin;
export default filesPlugin;
export declare const spec: PluginSpec<FilesPluginConfigOptions>;
