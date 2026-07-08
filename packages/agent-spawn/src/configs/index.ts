import { allAgents, resolveAgentId, type AgentDefinition } from "@poe-code/agent-defs";
import type { AcpSpawnConfig, SpawnConfig, SpawnMode } from "../types.js";
import { claudeCodeSpawnConfig } from "./claude-code.js";
import { codexSpawnConfig } from "./codex.js";
import { openCodeSpawnConfig, openCodeAcpSpawnConfig } from "./opencode.js";
import { kimiSpawnConfig, kimiAcpSpawnConfig } from "./kimi.js";
import { gooseSpawnConfig, gooseAcpSpawnConfig } from "./goose.js";
import { geminiCliAcpSpawnConfig } from "./gemini-cli.js";
import { cursorSpawnConfig } from "./cursor.js";
import { piSpawnConfig } from "./pi.js";

export interface SpawnableAgent {
  id: string;
  name: string;
  label: string;
  summary: string;
  aliases: string[];
  binaryName?: string;
  supportsStdinPrompt: boolean;
  supportsMcpSpawn: boolean;
  config?: SpawnConfig;
  acpConfig?: AcpSpawnConfig;
}

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
  freezeConfig(piSpawnConfig),
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

/**
 * CLI agents support a mode when their spawn config defines it. ACP and custom
 * spawn paths have a live permission channel, so every mode is accepted there.
 */
export function supportsSpawnMode(input: string, mode: SpawnMode): boolean {
  const config = getSpawnConfig(input);
  if (config && config.kind === "cli") {
    return config.modes[mode] !== undefined;
  }
  return true;
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

function agentSupportsStdinPrompt(config: SpawnConfig | undefined): boolean {
  return config?.kind === "cli" && config.stdinMode !== undefined;
}

function toSpawnableAgent(agent: AgentDefinition): SpawnableAgent | undefined {
  const config = lookup.get(agent.id);
  const acpConfig = acpLookup.get(agent.id);
  if (!config && !acpConfig) {
    return undefined;
  }

  return {
    id: agent.id,
    name: agent.name,
    label: agent.label,
    summary: agent.summary,
    aliases: [...(agent.aliases ?? [])],
    ...(agent.binaryName !== undefined ? { binaryName: agent.binaryName } : {}),
    supportsStdinPrompt: agentSupportsStdinPrompt(config),
    supportsMcpSpawn: supportsMcpAtSpawn(agent.id),
    ...(config ? { config } : {}),
    ...(acpConfig ? { acpConfig } : {})
  };
}

export function listSpawnableAgents(): readonly SpawnableAgent[] {
  const agents: SpawnableAgent[] = [];
  for (const agent of allAgents) {
    const spawnable = toSpawnableAgent(agent);
    if (spawnable) agents.push(spawnable);
  }
  return Object.freeze(agents);
}

export function resolveSpawnableAgent(input: string): SpawnableAgent | undefined {
  const resolvedId = resolveAgentId(input);
  if (!resolvedId) return undefined;
  const agent = allAgents.find((candidate) => candidate.id === resolvedId);
  return agent ? toSpawnableAgent(agent) : undefined;
}
