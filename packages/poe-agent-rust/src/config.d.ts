import type { AgentOptions } from "@poe-code/poe-agent";
import type { AgentPlugin, McpServerConfig } from "./plugin-types.js";
export type ResolvedAgentConfig = AgentOptions & { customFs: boolean; model?: string; plugins: AgentPlugin[] };
export declare function cloneAgentPlugin(plugin: AgentPlugin): AgentPlugin;
export declare function cloneMcpServerConfig(config: McpServerConfig): McpServerConfig;
export declare function createResolvedAgentConfig(
  input?: Partial<ResolvedAgentConfig>
): ResolvedAgentConfig;
export declare function toRuntimePlugins(config: ResolvedAgentConfig): AgentPlugin[];
export declare function resolvePluginSetupOrder(plugins: AgentPlugin[]): AgentPlugin[];
