import { allAgents, parseAgentSpecifier, resolveAgentId } from "@poe-code/agent-defs";

type Select = typeof import("toolcraft-design").select;
type IsCancel = typeof import("toolcraft-design").isCancel;

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

const loopAgents = allAgents.filter(
  (agent) => agent.binaryName !== undefined || agent.id === "poe-agent"
);
const selectableLoopAgents = loopAgents.filter((agent) => agent.id !== "poe-agent");
const supportedAgents = loopAgents
  .map((agent) => (agent.id === "poe-agent" ? "poe-agent:<model>" : agent.id))
  .join(", ");

function resolveSelectedAgent(agent: string): { agent: string } {
  const specifier = parseAgentSpecifier(agent);
  const resolvedAgentId = resolveAgentId(specifier.agent);

  if (!resolvedAgentId || !loopAgents.some((agent) => agent.id === resolvedAgentId)) {
    throw new Error(`Unsupported agent "${agent}". Supported agents: ${supportedAgents}`);
  }

  if (resolvedAgentId === "poe-agent" && !specifier.model) {
    throw new Error(
      'poe-agent requires a model in the agent specifier (e.g. "poe-agent:openai/gpt-5.4").'
    );
  }

  return {
    agent: specifier.model ? `${resolvedAgentId}:${specifier.model}` : resolvedAgentId
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

  if (input.assumeYes) {
    if (input.configuredDefaultAgent !== undefined && input.configuredDefaultAgent !== null) {
      return resolveSelectedAgent(input.configuredDefaultAgent);
    }

    return resolveSelectedAgent(input.fallbackAgent);
  }

  const selectedAgent = await input.select({
    message: input.message,
    options: selectableLoopAgents.map((agent) => ({
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
