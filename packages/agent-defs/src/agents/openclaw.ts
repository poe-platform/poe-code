import type { AgentDefinition } from "../types.js";

export const openClawAgent: AgentDefinition = {
  id: "openclaw",
  name: "openclaw",
  label: "OpenClaw",
  summary: "Configure OpenClaw to use the Poe API.",
  binaryName: "openclaw",
  configPath: "~/.openclaw/openclaw.json",
  branding: {
    colors: {
      dark: "#E8521C",
      light: "#C44316"
    }
  }
};
