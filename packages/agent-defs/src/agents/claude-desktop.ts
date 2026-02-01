import type { AgentDefinition } from "../types.js";

export const claudeDesktopAgent: AgentDefinition = {
  id: "claude-desktop",
  name: "claude-desktop",
  label: "Claude Desktop",
  summary: "Anthropic's official desktop application for Claude",
  configPath: "~/.claude/settings.json",
  branding: {
    colors: {
      dark: "#D97757",
      light: "#D97757"
    }
  }
};
