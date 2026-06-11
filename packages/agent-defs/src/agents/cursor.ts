import type { AgentDefinition } from "../types.js";

export const cursorAgent: AgentDefinition = {
  id: "cursor",
  name: "cursor",
  aliases: ["cursor-agent"],
  label: "Cursor",
  summary: "Cursor's CLI coding agent.",
  binaryName: "cursor-agent",
  configPath: "~/.cursor/cli-config.json",
  branding: {
    colors: {
      dark: "#FFFFFF",
      light: "#000000"
    }
  }
};
