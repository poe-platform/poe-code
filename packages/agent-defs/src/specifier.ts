import { resolveAgentId } from "./registry.js";

export interface AgentSpecifier {
  agent: string;
  model?: string;
}

function getOwnModel(specifier: AgentSpecifier): string | undefined {
  return Object.prototype.hasOwnProperty.call(specifier, "model") ? specifier.model : undefined;
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
  const model = getOwnModel(specifier);
  if (model) {
    return `${specifier.agent}:${model}`;
  }
  return specifier.agent;
}

export function normalizeAgentId(input: string): string {
  const specifier = parseAgentSpecifier(input.trim());
  const agent = resolveAgentId(specifier.agent) ?? specifier.agent;

  return formatAgentSpecifier({
    agent,
    model: getOwnModel(specifier)
  });
}
