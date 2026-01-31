import type { AgentDefinition } from "../types.js";

export const claudeCodeAgent: AgentDefinition = {
  id: "claude-code",
  name: "claude-code",
  label: "Claude Code",
  summary: "Configure Claude Code to route through Poe.",
  aliases: ["claude"],
  binaryName: "claude",
  configPath: "~/.claude/settings.json",
  branding: {
    colors: {
      dark: "#C15F3C",
      light: "#C15F3C"
    }
  }
};
