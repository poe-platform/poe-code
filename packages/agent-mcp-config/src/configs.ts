import type { ShapeName } from "./shapes.js";

export type ConfigFormat = "json" | "toml";
export type Platform = "darwin" | "linux" | "win32";

export interface AgentMcpConfig {
  configFile: string | ((platform: Platform) => string);
  configKey: string;
  format: ConfigFormat;
  shape: ShapeName;
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
    shape: "standard"
  },
  codex: {
    configFile: "~/.codex/config.toml",
    configKey: "mcp_servers",
    format: "toml",
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
  }
};

export const supportedAgents = Object.keys(agentMcpConfigs) as readonly string[];

export function isSupported(agentId: string): boolean {
  return agentId in agentMcpConfigs;
}

export function getAgentConfig(agentId: string): AgentMcpConfig | undefined {
  return agentMcpConfigs[agentId];
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

/**
 * Documented agents registry for future reference.
 * These agents are not yet supported but their config locations are documented.
 */
export const documentedAgents: Record<
  string,
  { configFile: string; configKey: string; format: string; notes?: string }
> = {
  cursor: {
    configFile: "~/.cursor/mcp.json",
    configKey: "mcpServers",
    format: "json"
  },
  windsurf: {
    configFile: "~/.codeium/windsurf/mcp_config.json",
    configKey: "mcpServers",
    format: "json"
  },
  vscode: {
    configFile: "~/.vscode/settings.json",
    configKey: "mcp.servers",
    format: "json",
    notes: "Nested under mcp.servers"
  },
  cline: {
    configFile: "~/.cline/mcp_settings.json",
    configKey: "mcpServers",
    format: "json"
  },
  "roo-cline": {
    configFile: "~/.roo-cline/mcp_settings.json",
    configKey: "mcpServers",
    format: "json"
  },
  zed: {
    configFile: "~/.config/zed/settings.json",
    configKey: "context_servers",
    format: "json",
    notes: "Uses context_servers instead of mcpServers"
  },
  goose: {
    configFile: "~/.config/goose/config.yaml",
    configKey: "extensions",
    format: "yaml",
    notes: "Uses YAML format"
  },
  aider: {
    configFile: "~/.aider.conf.yml",
    configKey: "mcp-servers",
    format: "yaml",
    notes: "Uses YAML format"
  },
  "aider-desk": {
    configFile: "~/.aider-desk/mcp.json",
    configKey: "mcpServers",
    format: "json"
  },
  "gemini-cli": {
    configFile: "~/.gemini/settings.json",
    configKey: "mcpServers",
    format: "json"
  },
  witsy: {
    configFile: "~/.witsy/mcp.json",
    configKey: "mcpServers",
    format: "json"
  },
  enconvo: {
    configFile: "~/.enconvo/mcp.json",
    configKey: "mcpServers",
    format: "json"
  },
  droid: {
    configFile: "~/.droid/mcp.json",
    configKey: "mcpServers",
    format: "json"
  }
};
