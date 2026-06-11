import { resolveAgentId } from "@poe-code/agent-defs";
import type { AcpSpawnConfig, SpawnConfig } from "../types.js";
import { claudeCodeSpawnConfig } from "./claude-code.js";
import { codexSpawnConfig } from "./codex.js";
import { openCodeSpawnConfig, openCodeAcpSpawnConfig } from "./opencode.js";
import { kimiSpawnConfig, kimiAcpSpawnConfig } from "./kimi.js";
import { gooseSpawnConfig, gooseAcpSpawnConfig } from "./goose.js";
import { geminiCliAcpSpawnConfig } from "./gemini-cli.js";
import { cursorSpawnConfig } from "./cursor.js";

function freezeConfig<T extends SpawnConfig | AcpSpawnConfig>(config: T): T {
  freezeValue(config);
  return config;
}

function freezeValue(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }

  for (const nested of Object.values(value)) {
    freezeValue(nested);
  }
  Object.freeze(value);
}

// ACP adapter support (spawn streaming):
// - Supported (has `adapter`): claude-code, codex, opencode, kimi, goose
export const allSpawnConfigs: readonly SpawnConfig[] = Object.freeze([
  freezeConfig(claudeCodeSpawnConfig),
  freezeConfig(codexSpawnConfig),
  freezeConfig(cursorSpawnConfig),
  freezeConfig(openCodeSpawnConfig),
  freezeConfig(kimiSpawnConfig),
  freezeConfig(gooseSpawnConfig)
]);

const lookup = new Map<string, SpawnConfig>();

for (const config of allSpawnConfigs) {
  lookup.set(config.agentId, config);
}

const acpLookup = new Map<string, AcpSpawnConfig>();
acpLookup.set(openCodeAcpSpawnConfig.agentId, freezeConfig(openCodeAcpSpawnConfig));
acpLookup.set(kimiAcpSpawnConfig.agentId, freezeConfig(kimiAcpSpawnConfig));
acpLookup.set(gooseAcpSpawnConfig.agentId, freezeConfig(gooseAcpSpawnConfig));
acpLookup.set(geminiCliAcpSpawnConfig.agentId, freezeConfig(geminiCliAcpSpawnConfig));

export function getSpawnConfig(input: string): SpawnConfig | undefined {
  const resolvedId = resolveAgentId(input);
  if (!resolvedId) {
    return undefined;
  }
  return lookup.get(resolvedId);
}

export function getAcpSpawnConfig(input: string): AcpSpawnConfig | undefined {
  const resolvedId = resolveAgentId(input);
  if (!resolvedId) {
    return undefined;
  }
  return acpLookup.get(resolvedId);
}

export function supportsMcpAtSpawn(input: string): boolean {
  const config = getSpawnConfig(input);
  return (
    !!config &&
    config.kind === "cli" &&
    (typeof config.mcpArgs === "function" ||
      typeof config.mcpEnv === "function" ||
      config.mcpFile !== undefined)
  );
}

export function listMcpSupportedAgents(): string[] {
  const supported: string[] = [];

  for (const config of allSpawnConfigs) {
    if (
      config.kind !== "cli" ||
      (typeof config.mcpArgs !== "function" &&
        typeof config.mcpEnv !== "function" &&
        config.mcpFile === undefined)
    ) {
      continue;
    }
    supported.push(config.agentId);
  }

  return supported;
}
