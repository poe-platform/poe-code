import type { AgentDefinition } from "../types.js";

export const geminiCliAgent: AgentDefinition = {
  id: "gemini-cli",
  name: "gemini-cli",
  aliases: ["gemini"],
  label: "Gemini CLI",
  summary: "Google's open-source AI agent for the terminal.",
  binaryName: "gemini",
  configPath: "~/.gemini/settings.json",
  apiShapes: ["google-generations"],
  capabilities: ["spawn", "configure", "install", "test", "skill"],
  branding: {
    colors: {
      dark: "#8AB4F8",
      light: "#1A73E8"
    }
  }
};
