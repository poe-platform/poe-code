import { allAgents, parseAgentSpecifier, resolveAgentId } from "@poe-code/agent-defs";

type Select = typeof import("@poe-code/design-system").select;
type IsCancel = typeof import("@poe-code/design-system").isCancel;

export interface ResolveLoopAgentInput {
  providedAgent?: string;
  configuredDefaultAgent?: string | null;
  frontmatterAgent?: string | string[];
  assumeYes: boolean;
  fallbackAgent: string;
  message: string;
  select: Select;
  isCancel: IsCancel;
}

const supportedAgents = allAgents.map((agent) => agent.id).join(", ");

function resolveSelectedAgent(agent: string): { agent: string } {
  const specifier = parseAgentSpecifier(agent);
  const resolvedAgentId = resolveAgentId(specifier.agent);

  if (!resolvedAgentId) {
    throw new Error(
      `Unsupported agent "${agent}". Supported agents: ${supportedAgents}`
    );
  }

  return {
    agent: specifier.model
      ? `${resolvedAgentId}:${specifier.model}`
      : resolvedAgentId
  };
}

export async function resolveLoopAgent(
  input: ResolveLoopAgentInput
): Promise<{ agent: string } | { cancelled: true }> {
  if (input.providedAgent !== undefined) {
    return resolveSelectedAgent(input.providedAgent);
  }

  if (Array.isArray(input.frontmatterAgent)) {
    throw new Error("array handled by caller");
  }

  if (typeof input.frontmatterAgent === "string") {
    return resolveSelectedAgent(input.frontmatterAgent);
  }

  if (input.configuredDefaultAgent !== undefined && input.configuredDefaultAgent !== null) {
    return resolveSelectedAgent(input.configuredDefaultAgent);
  }

  if (input.assumeYes) {
    return resolveSelectedAgent(input.fallbackAgent);
  }

  const selectedAgent = await input.select({
    message: input.message,
    options: allAgents.map((agent) => ({
      value: agent.id,
      label: agent.label,
      hint: agent.summary
    }))
  });

  if (input.isCancel(selectedAgent)) {
    return { cancelled: true };
  }

  return resolveSelectedAgent(selectedAgent);
}
