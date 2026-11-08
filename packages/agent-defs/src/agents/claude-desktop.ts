import type { AgentDefinition } from "../types.js";

export const claudeDesktopAgent: AgentDefinition = {
  id: "claude-desktop",
  name: "claude-desktop",
  label: "Claude Desktop",
  summary: "Anthropic's official desktop application for Claude",
  configPath: "~/.config/Claude/claude_desktop_config.json",
  configPaths: {
    darwin: "~/Library/Application Support/Claude/claude_desktop_config.json",
    linux: "~/.config/Claude/claude_desktop_config.json",
    win32: "~/AppData/Roaming/Claude/claude_desktop_config.json"
  },
  capabilities: ["mcp"],
  branding: {
    colors: {
      dark: "#D97757",
      light: "#D97757"
    }
  }
};
