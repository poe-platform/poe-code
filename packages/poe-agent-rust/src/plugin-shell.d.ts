import * as fsPromises from "node:fs/promises";
import type { AgentPlugin } from "./plugin-types.js";
import type { ToolContext } from "./types.js";
import type { PluginSpec } from "./plugin-spec.js";
type RunCommandOptions = {
  signal: AbortSignal;
  timeoutMs: number;
  notify?: ToolContext["notify"];
};
type RunCommandFn = (command: string, cwd: string, options: RunCommandOptions) => Promise<string>;
type ShellPluginOptions = {
  cwd?: string;
  allowedPaths?: string[];
  fs?: Pick<typeof fsPromises, "lstat">;
  runCommand?: RunCommandFn;
};
export type ShellPluginConfigOptions = Pick<ShellPluginOptions, "cwd" | "allowedPaths">;
declare const shellPlugin: (options?: ShellPluginOptions) => AgentPlugin;
export default shellPlugin;
export declare const spec: PluginSpec<ShellPluginConfigOptions>;
