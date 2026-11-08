import type { AgentDefinition } from "../types.js";

export const piAgent: AgentDefinition = {
  id: "pi",
  name: "pi",
  aliases: ["pi-agent"],
  label: "Pi",
  summary: "Minimal AI coding agent for the terminal.",
  binaryName: "pi",
  capabilities: ["spawn"],
  branding: {
    colors: {
      dark: "#F2F2F2",
      light: "#242424"
    }
  }
};
