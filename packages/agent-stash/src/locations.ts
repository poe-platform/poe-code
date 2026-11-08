import path from "node:path";
import {
  getAgentConfig as getHookAgentConfig,
  resolveHookPath
} from "@poe-code/agent-hook-config";
import {
  getAgentConfig as getSkillAgentConfig,
  resolveSkillDir
} from "@poe-code/agent-skill-config";
import { resolveAgentId } from "@poe-code/agent-defs";
import type { AgentStashScope } from "./types.js";

export function normalizeAgent(agent: string): string {
  const agentId = resolveAgentId(agent);
  if (!agentId) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  return agentId;
}

export function resolveSkillRoot(agentId: string, scope: AgentStashScope, cwd: string, homeDir: string): string | undefined {
  const config = getSkillAgentConfig(agentId);
  if (!config) {
    return undefined;
  }
  return resolveSkillDir(config, scope === "global" ? "global" : "local", cwd, homeDir);
}

export function resolveHookRoot(agentId: string, scope: AgentStashScope, cwd: string, homeDir: string): string | undefined {
  const config = getHookAgentConfig(agentId);
  if (!config) {
    return undefined;
  }
  return resolveHookPath(config, scope === "global" ? "global" : "local", cwd, homeDir);
}

export function agentStashDir(homeDir: string): string {
  return path.join(homeDir, ".agent-stash");
}

export function profileConfigPath(homeDir: string): string {
  return path.join(agentStashDir(homeDir), "config.json");
}

export function baselineManifestPath(homeDir: string, profile: string): string {
  return path.join(agentStashDir(homeDir), "cache", `${profile}.manifest.json`);
}

export function backupRoot(homeDir: string): string {
  return path.join(agentStashDir(homeDir), "backups");
}
