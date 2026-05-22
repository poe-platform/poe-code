import type { AgentDefinition } from "../types.js";

export const geminiCliAgent: AgentDefinition = {
  id: "gemini-cli",
  name: "gemini-cli",
  aliases: ["gemini"],
  label: "Gemini CLI",
  summary: "Configure Google's Gemini CLI to use a compatible Google generations API.",
  binaryName: "gemini",
  configPath: "~/.gemini/settings.json",
  apiShapes: ["google-generations"],
  branding: {
    colors: {
      dark: "#8AB4F8",
      light: "#1A73E8"
    }
  }
};
