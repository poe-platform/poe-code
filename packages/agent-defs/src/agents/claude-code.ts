import type { AgentDefinition } from "../types.js";

export const claudeCodeAgent: AgentDefinition = {
  id: "claude-code",
  name: "claude-code",
  label: "Claude Code",
  summary: "Anthropic's agentic coding tool for the terminal.",
  aliases: ["claude"],
  binaryName: "claude",
  apiShapes: ["anthropic-messages"],
  otelCapture: {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1"
    }
  },
  configPath: "~/.claude.json",
  branding: {
    colors: {
      dark: "#C15F3C",
      light: "#C15F3C"
    }
  }
};
