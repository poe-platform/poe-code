import type { AgentDefinition } from "./types.js";
import {
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent,
  gooseAgent
} from "./agents/index.js";

export const allAgents: AgentDefinition[] = [
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent,
  gooseAgent
];

const lookup = new Map<string, string>();

for (const agent of allAgents) {
  const values = [agent.id, agent.name, ...(agent.aliases ?? [])];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (!lookup.has(normalized)) {
      lookup.set(normalized, agent.id);
    }
  }
}

export function resolveAgentId(input: string): string | undefined {
  if (!input) {
    return undefined;
  }
  return lookup.get(input.toLowerCase());
}
