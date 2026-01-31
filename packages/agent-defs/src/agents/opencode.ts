import type { AgentDefinition } from "../types.js";

export const openCodeAgent: AgentDefinition = {
  id: "opencode",
  name: "opencode",
  label: "OpenCode CLI",
  summary: "Configure OpenCode CLI to use the Poe API.",
  binaryName: "opencode",
  configPath: "~/.config/opencode/config.json",
  branding: {
    colors: {
      dark: "#4A4F55",
      light: "#2F3338"
    }
  }
};
