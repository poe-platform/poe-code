import type { AgentDefinition } from "./types.js";
import {
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  cursorAgent,
  geminiCliAgent,
  openCodeAgent,
  kimiAgent,
  gooseAgent,
  piAgent,
  poeAgentAgent
} from "./agents/index.js";

function freezeAgent(agent: AgentDefinition): AgentDefinition {
  if (agent.aliases !== undefined) {
    Object.freeze(agent.aliases);
  }
  if (agent.apiShapes !== undefined) {
    Object.freeze(agent.apiShapes);
  }
  if (agent.capabilities !== undefined) {
    Object.freeze(agent.capabilities);
  }
  if (agent.otelCapture?.env !== undefined) {
    Object.freeze(agent.otelCapture.env);
  }
  if (agent.otelCapture !== undefined) {
    Object.freeze(agent.otelCapture);
  }
  Object.freeze(agent.branding.colors);
  Object.freeze(agent.branding);
  return Object.freeze(agent);
}

export const allAgents: readonly AgentDefinition[] = Object.freeze([
  freezeAgent(claudeCodeAgent),
  freezeAgent(claudeDesktopAgent),
  freezeAgent(codexAgent),
  freezeAgent(cursorAgent),
  freezeAgent(geminiCliAgent),
  freezeAgent(openCodeAgent),
  freezeAgent(kimiAgent),
  freezeAgent(gooseAgent),
  freezeAgent(piAgent),
  freezeAgent(poeAgentAgent)
]);

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
  return lookup.get(input.trim().toLowerCase());
}
