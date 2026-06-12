import { resolveAgentId } from "@poe-code/agent-defs";
import type { ShapeName } from "./shapes.js";

export type ConfigFormat = "json" | "toml" | "yaml";
export type Platform = "darwin" | "linux" | "win32";

export interface AgentMcpConfig {
  configFile: string | ((platform: Platform) => string);
  configKey: string;
  format: ConfigFormat;
  shape: ShapeName;
  mcpOutputFormat?: string;
}

function snapshotConfig(config: AgentMcpConfig): AgentMcpConfig {
  return { ...config };
}

const agentMcpConfigs: Record<string, AgentMcpConfig> = {
  "claude-code": {
    configFile: "~/.claude.json",
    configKey: "mcpServers",
    format: "json",
    shape: "standard"
  },
  "claude-desktop": {
    configFile: (platform: Platform) => {
      switch (platform) {
        case "darwin":
          return "~/Library/Application Support/Claude/claude_desktop_config.json";
        case "win32":
          return "~/AppData/Roaming/Claude/claude_desktop_config.json";
        default:
          return "~/.config/Claude/claude_desktop_config.json";
      }
    },
    configKey: "mcpServers",
    format: "json",
    shape: "standard",
    mcpOutputFormat: "markdown_instructions"
  },
  codex: {
    configFile: "~/.codex/config.toml",
    configKey: "mcp_servers",
    format: "toml",
    shape: "standard"
  },
  cursor: {
    configFile: "~/.cursor/mcp.json",
    configKey: "mcpServers",
    format: "json",
    shape: "standard"
  },
  opencode: {
    configFile: "~/.config/opencode/opencode.json",
    configKey: "mcp",
    format: "json",
    shape: "opencode"
  },
  kimi: {
    configFile: "~/.kimi/mcp.json",
    configKey: "mcpServers",
    format: "json",
    shape: "standard"
  },
  goose: {
    configFile: "~/.config/goose/config.yaml",
    configKey: "extensions",
    format: "yaml",
    shape: "goose"
  }
};

export const supportedAgents = Object.keys(agentMcpConfigs) as readonly string[];

export type AgentSupportStatus = "supported" | "unsupported" | "unknown";

export interface AgentSupportResult {
  status: AgentSupportStatus;
  input: string;
  id?: string;
  config?: AgentMcpConfig;
}

export function resolveAgentSupport(
  input: string,
  registry: Record<string, AgentMcpConfig> = agentMcpConfigs
): AgentSupportResult {
  const resolvedId = resolveAgentId(input);
  if (!resolvedId) {
    return { status: "unknown", input };
  }
  const config = registry[resolvedId];
  if (!config) {
    return { status: "unsupported", input, id: resolvedId };
  }
  return { status: "supported", input, id: resolvedId, config: snapshotConfig(config) };
}

export function isSupported(agentId: string): boolean {
  return resolveAgentSupport(agentId).status === "supported";
}

export function getAgentConfig(agentId: string): AgentMcpConfig | undefined {
  const support = resolveAgentSupport(agentId);
  return support.status === "supported" ? support.config : undefined;
}

export function resolveConfigPath(
  config: AgentMcpConfig,
  platform: Platform
): string {
  if (typeof config.configFile === "function") {
    return config.configFile(platform);
  }
  return config.configFile;
}
