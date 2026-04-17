import type { AgentDefinition } from "../types.js";

export const poeAgentAgent: AgentDefinition = {
  id: "poe-agent",
  name: "poe-agent",
  label: "Poe Agent",
  summary: "Run one-shot prompts with the built-in Poe agent runtime.",
  configPath: "~/.poe-code/config.json",
  branding: {
    colors: {
      dark: "#A465F7",
      light: "#7A3FD3"
    }
  }
};
