import { resolveAgentId } from "./registry.js";

export interface AgentSpecifier {
  agent: string;
  model?: string;
}

export function parseAgentSpecifier(input: string): AgentSpecifier {
  const colonIndex = input.indexOf(":");
  if (colonIndex === -1) {
    return { agent: input.trim() };
  }

  const agent = input.slice(0, colonIndex).trim();
  const model = input.slice(colonIndex + 1).trim();

  return {
    agent,
    ...(model.length > 0 ? { model } : {}),
  };
}

export function formatAgentSpecifier(specifier: AgentSpecifier): string {
  if (specifier.model) {
    return `${specifier.agent}:${specifier.model}`;
  }
  return specifier.agent;
}

export function normalizeAgentId(input: string): string {
  const specifier = parseAgentSpecifier(input.trim());
  const agent = resolveAgentId(specifier.agent) ?? specifier.agent;

  return formatAgentSpecifier({
    agent,
    model: specifier.model
  });
}
