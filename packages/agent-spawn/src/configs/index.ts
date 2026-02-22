import { resolveAgentId } from "@poe-code/agent-defs";
import type { SpawnConfig } from "../types.js";
import { claudeCodeSpawnConfig } from "./claude-code.js";
import { codexSpawnConfig } from "./codex.js";
import { openCodeSpawnConfig } from "./opencode.js";
import { kimiSpawnConfig } from "./kimi.js";

// ACP adapter support (spawn streaming):
// - Supported (has `adapter`): claude-code, codex, opencode, kimi
export const allSpawnConfigs: readonly SpawnConfig[] = [
  claudeCodeSpawnConfig,
  codexSpawnConfig,
  openCodeSpawnConfig,
  kimiSpawnConfig
];

const lookup = new Map<string, SpawnConfig>();

for (const config of allSpawnConfigs) {
  lookup.set(config.agentId, config);
}

export function getSpawnConfig(input: string): SpawnConfig | undefined {
  const resolvedId = resolveAgentId(input);
  if (!resolvedId) {
    return undefined;
  }
  return lookup.get(resolvedId);
}

export function supportsMcpAtSpawn(input: string): boolean {
  const config = getSpawnConfig(input);
  return (
    !!config &&
    config.kind === "cli" &&
    typeof config.mcpArgs === "function"
  );
}

export function listMcpSupportedAgents(): string[] {
  const supported: string[] = [];

  for (const config of allSpawnConfigs) {
    if (config.kind !== "cli" || typeof config.mcpArgs !== "function") {
      continue;
    }
    supported.push(config.agentId);
  }

  return supported;
}
