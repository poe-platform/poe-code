import os from "node:os";
import path from "node:path";
import { resolveAgentId } from "@poe-code/agent-defs";

export interface AgentSkillConfig {
  globalSkillDir: string;
  localSkillDir: string;
}

export type SkillScope = "global" | "local";

const agentSkillConfigs: Record<string, AgentSkillConfig> = {
  "claude-code": {
    globalSkillDir: "~/.claude/skills",
    localSkillDir: ".claude/skills"
  },
  codex: {
    globalSkillDir: "~/.codex/skills",
    localSkillDir: ".codex/skills"
  },
  cursor: {
    globalSkillDir: "~/.cursor/skills-cursor",
    localSkillDir: ".cursor/skills"
  },
  "gemini-cli": {
    globalSkillDir: "~/.gemini/skills",
    localSkillDir: ".gemini/skills"
  },
  opencode: {
    globalSkillDir: "~/.config/opencode/skills",
    localSkillDir: ".opencode/skills"
  },
  goose: {
    globalSkillDir: "~/.agents/skills",
    localSkillDir: ".agents/skills"
  }
};

export const supportedAgents = Object.freeze(Object.keys(agentSkillConfigs)) as readonly string[];

export type AgentSupportStatus = "supported" | "unsupported" | "unknown";

export interface AgentSupportResult {
  status: AgentSupportStatus;
  input: string;
  id?: string;
  config?: AgentSkillConfig;
}

export function resolveAgentSupport(
  input: string,
  registry: Record<string, AgentSkillConfig> = agentSkillConfigs
): AgentSupportResult {
  const resolvedId = resolveAgentId(input);
  if (!resolvedId) {
    return { status: "unknown", input };
  }

  const config = registry[resolvedId];
  if (!config) {
    return { status: "unsupported", input, id: resolvedId };
  }

  return { status: "supported", input, id: resolvedId, config: { ...config } };
}

export function getAgentConfig(agentId: string): AgentSkillConfig | undefined {
  const support = resolveAgentSupport(agentId);
  return support.status === "supported" ? support.config : undefined;
}

function expandHome(targetPath: string, homeDir: string = os.homedir()): string {
  if (!targetPath?.startsWith("~")) {
    return targetPath;
  }

  if (targetPath === "~") {
    return homeDir;
  }

  // Handle ~./ -> ~/.
  if (targetPath.startsWith("~./")) {
    targetPath = `~/.${targetPath.slice(3)}`;
  }

  let remainder = targetPath.slice(1);
  if (remainder.startsWith("/") || remainder.startsWith("\\")) {
    remainder = remainder.slice(1);
  } else if (remainder.startsWith(".")) {
    remainder = remainder.slice(1);
    if (remainder.startsWith("/") || remainder.startsWith("\\")) {
      remainder = remainder.slice(1);
    }
  }

  return remainder.length === 0 ? homeDir : path.join(homeDir, remainder);
}

export function resolveSkillDir(
  config: AgentSkillConfig,
  scope: SkillScope,
  cwd: string,
  homeDir?: string
): string {
  if (scope === "global") {
    return path.resolve(expandHome(config.globalSkillDir, homeDir));
  }

  return path.resolve(cwd, config.localSkillDir);
}
