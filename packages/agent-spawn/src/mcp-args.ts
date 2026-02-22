import { listMcpSupportedAgents } from "./configs/index.js";
import type { CliSpawnConfig, McpSpawnConfig } from "./types.js";

export function hasMcpServers(servers?: McpSpawnConfig): servers is McpSpawnConfig {
  if (!servers) {
    return false;
  }
  return Object.keys(servers).length > 0;
}

export function getMcpArgs(
  config: CliSpawnConfig,
  servers?: McpSpawnConfig
): string[] {
  if (!hasMcpServers(servers)) {
    return [];
  }
  if (!config.mcpArgs) {
    throw new Error(formatUnsupportedMcpSpawnMessage(config.agentId));
  }
  return config.mcpArgs(servers);
}

export function formatUnsupportedMcpSpawnMessage(agentId: string): string {
  const supported = listMcpSupportedAgents();
  const supportedText = supported.length > 0 ? supported.join(", ") : "(none)";
  return (
    `Agent "${agentId}" does not support MCP servers at spawn time.\n` +
    `Agents with spawn-time MCP support: ${supportedText}`
  );
}
