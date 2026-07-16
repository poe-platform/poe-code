import type { AgentDefinition } from "../types.js";

export const openCodeAgent: AgentDefinition = {
  id: "opencode",
  name: "opencode",
  label: "OpenCode CLI",
  summary: "Open-source AI coding agent for the terminal.",
  binaryName: "opencode",
  apiShapes: ["openai-chat-completions"],
  otelCapture: {
    env: {
      OPENCODE_CONFIG_CONTENT: '{"experimental":{"openTelemetry":true}}'
    }
  },
  configPath: "~/.config/opencode/opencode.json",
  capabilities: ["spawn", "configure", "install", "test", "skill", "mcp"],
  branding: {
    colors: {
      dark: "#4A4F55",
      light: "#2F3338"
    }
  }
};
