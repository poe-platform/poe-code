import type { AgentDefinition } from "../types.js";

export const gooseAgent: AgentDefinition = {
  id: "goose",
  name: "goose",
  label: "Goose",
  summary: "Block's open-source AI agent with ACP support.",
  binaryName: "goose",
  apiShapes: ["openai-chat-completions"],
  otelCapture: {},
  configPath: "~/.config/goose/config.yaml",
  capabilities: ["spawn", "configure", "install", "test", "skill", "mcp"],
  branding: {
    colors: {
      dark: "#FF6B35",
      light: "#E85D26"
    }
  }
};
