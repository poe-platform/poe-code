import type { AgentDefinition } from "../types.js";

export const kimiAgent: AgentDefinition = {
  id: "kimi",
  name: "kimi",
  label: "Kimi",
  summary: "Configure Kimi CLI to use Poe API",
  aliases: ["kimi-cli"],
  binaryName: "kimi",
  apiShapes: ["openai-chat-completions"],
  configPath: "~/.kimi/mcp.json",
  branding: {
    colors: {
      dark: "#7B68EE",
      light: "#6A5ACD"
    }
  }
};
