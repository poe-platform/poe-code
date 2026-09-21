import type { RunContext } from "./run-context.js";
import type { McpServerConfig, PluginApi } from "./plugin-types.js";
import type { Tool, NormalizedTool } from "./types.js";
export declare class PluginApiImpl implements PluginApi {
  constructor(runContext: RunContext, pluginName?: string);
  addTool(tool: Tool): void;
  getTool(name: string): NormalizedTool | undefined;
  addMcp(config: McpServerConfig): void;
  flushSetup(): Promise<void>;
}
