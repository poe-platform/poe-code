import type { AgentDefinition } from "../types.js";

export const kimiAgent: AgentDefinition = {
  id: "kimi",
  name: "kimi",
  label: "Kimi",
  summary: "Configure Kimi CLI to use Poe API",
  aliases: ["kimi-cli"],
  binaryName: "kimi",
  configPath: "~/.kimi/config.toml",
  branding: {
    colors: {
      dark: "#7B68EE",
      light: "#6A5ACD"
    }
  }
};
