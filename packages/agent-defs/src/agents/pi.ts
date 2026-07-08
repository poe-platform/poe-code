import type { AgentDefinition } from "../types.js";

export const piAgent: AgentDefinition = {
  id: "pi",
  name: "pi",
  aliases: ["pi-agent"],
  label: "Pi",
  summary: "Pi coding agent (spawn-only; uses local Pi auth/settings).",
  binaryName: "pi",
  branding: {
    colors: {
      dark: "#F2F2F2",
      light: "#242424"
    }
  }
};
