import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
type PluginFileSystem = {
  lstat(path: string): Promise<{
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  stat(path: string): Promise<{
    mtimeMs: number;
    isDirectory(): boolean;
  }>;
  mkdir(path: string, options?: {
    recursive?: boolean;
  }): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: string, options?: {
    encoding: "utf8";
    flag?: string;
  }): Promise<void>;
};
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
