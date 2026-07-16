import type { AgentCapability } from "./types.js";
import { allAgents, resolveAgentId } from "./registry.js";

export function listAgentsWithCapability(
  capability: AgentCapability,
  options?: { includeAliases?: boolean }
): readonly string[] {
  const names: string[] = [];
  for (const agent of allAgents) {
    if (!agent.capabilities?.includes(capability)) {
      continue;
    }
    names.push(agent.id);
    if (options?.includeAliases) {
      names.push(...(agent.aliases ?? []));
    }
  }
  return names;
}

export function agentSupportsCapability(input: string, capability: AgentCapability): boolean {
  const id = resolveAgentId(input);
  return id !== undefined && listAgentsWithCapability(capability).includes(id);
}

const MAX_SUGGESTION_DISTANCE = 3;

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    previous = current;
  }

  return previous[b.length];
}

/** Every candidate tied for the smallest edit distance, when one is close enough. */
function suggest(input: string, candidates: readonly string[]): string[] {
  const needle = input.trim().toLowerCase();
  const scored = candidates
    .map((candidate) => ({ candidate, score: editDistance(needle, candidate.toLowerCase()) }))
    .filter((entry) => entry.score <= MAX_SUGGESTION_DISTANCE);

  if (scored.length === 0) {
    return [];
  }

  const best = Math.min(...scored.map((entry) => entry.score));
  return scored.filter((entry) => entry.score === best).map((entry) => entry.candidate);
}

/**
 * The single message for every agent argument that misses. It distinguishes a
 * typo (unknown id, plus a did-you-mean) from a real capability gap ("pi
 * supports: spawn"), and always names the agents the command does accept.
 */
export function formatAgentCapabilityError(input: {
  agent: string;
  capability: AgentCapability;
}): string {
  const allowed = listAgentsWithCapability(input.capability, { includeAliases: true });
  const allowList = `Agents supporting ${input.capability}: ${
    allowed.length > 0 ? allowed.join(", ") : "none"
  }.`;

  const id = resolveAgentId(input.agent);
  if (!id) {
    const near = suggest(input.agent, allowed);
    const hint = near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : "";
    return `Unknown agent "${input.agent}".${hint} ${allowList}`;
  }

  const supported = (
    ["spawn", "configure", "install", "test", "skill", "mcp"] as AgentCapability[]
  ).filter((capability) => listAgentsWithCapability(capability).includes(id));
  const supports =
    supported.length > 0
      ? `${id} supports: ${supported.join(", ")}.`
      : `${id} is not supported by poe-code agent commands.`;

  return `Agent "${id}" does not support ${input.capability}. ${supports} ${allowList}`;
}
