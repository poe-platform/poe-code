import type { AgentDefinition } from "../types.js";

export const codexAgent: AgentDefinition = {
  id: "codex",
  name: "codex",
  label: "Codex",
  summary: "Configure Codex to use Poe as the model provider.",
  binaryName: "codex",
  configPath: "~/.codex/config.toml",
  branding: {
    colors: {
      dark: "#D5D9DF",
      light: "#7A7F86"
    }
  }
};
