import { allAgents, resolveAgentId } from "@poe-code/agent-defs";
import type { SpawnConfig } from "../types.js";
import { getSpawnConfig } from "./index.js";

export interface ResolvedSpawnConfig {
  agentId: string;
  binaryName?: string;
  spawnConfig?: SpawnConfig;
}

export function resolveConfig(
  agentId: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): ResolvedSpawnConfig {
  const resolvedAgentId = resolveAgentId(agentId);
  if (!resolvedAgentId) {
    throw new Error(`Unknown agent "${agentId}".`);
  }

  const agentDefinition = allAgents.find((agent) => agent.id === resolvedAgentId);
  if (!agentDefinition) {
    throw new Error(`Unknown agent "${agentId}".`);
  }

  const spawnConfig = getSpawnConfig(resolvedAgentId);
  const binaryName = env["POE_AGENT_BINARY"]?.trim() || agentDefinition.binaryName;

  return { agentId: resolvedAgentId, binaryName, spawnConfig };
}
