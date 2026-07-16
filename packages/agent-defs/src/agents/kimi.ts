import type { AgentDefinition } from "../types.js";

export const kimiAgent: AgentDefinition = {
  id: "kimi",
  name: "kimi",
  label: "Kimi",
  summary: "Moonshot AI's coding agent for the terminal.",
  aliases: ["kimi-cli"],
  binaryName: "kimi",
  apiShapes: ["openai-chat-completions"],
  configPath: "~/.kimi/mcp.json",
  capabilities: ["spawn", "configure", "install", "test", "mcp"],
  branding: {
    colors: {
      dark: "#7B68EE",
      light: "#6A5ACD"
    }
  }
};
