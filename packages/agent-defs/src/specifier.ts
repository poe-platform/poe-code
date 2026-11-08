import { resolveAgentId } from "./registry.js";

export interface AgentSpecifier {
  agent: string;
  model?: string;
}

function getOwnModel(specifier: AgentSpecifier): string | undefined {
  return Object.prototype.hasOwnProperty.call(specifier, "model") ? specifier.model : undefined;
}

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
  return trimmed;
}

export function parseAgentSpecifier(input: string): AgentSpecifier {
  const colonIndex = input.indexOf(":");
  if (colonIndex === -1) {
    return { agent: requireNonBlank(input, "agent") };
  }

  const agent = requireNonBlank(input.slice(0, colonIndex), "agent");
  const model = input.slice(colonIndex + 1).trim();

  return {
    agent,
    ...(model.length > 0 ? { model } : {})
  };
}

export function formatAgentSpecifier(specifier: AgentSpecifier): string {
  const agent = requireNonBlank(specifier.agent, "agent");
  const model = getOwnModel(specifier);
  const normalizedModel = model?.trim();
  if (normalizedModel) {
    return `${agent}:${normalizedModel}`;
  }
  return agent;
}

export function normalizeAgentId(input: string): string {
  const specifier = parseAgentSpecifier(input.trim());
  const agent = resolveAgentId(specifier.agent) ?? specifier.agent;

  return formatAgentSpecifier({
    agent,
    model: getOwnModel(specifier)
  });
}
