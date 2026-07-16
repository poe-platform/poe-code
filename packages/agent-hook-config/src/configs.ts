import os from "node:os";
import path from "node:path";
import { resolveAgentId } from "@poe-code/agent-defs";

export type HookFormat = "claude-settings-json" | "codex-hooks-json" | "codex-config-toml";

export type HookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PermissionRequest"
  | "Stop"
  | "StopFailure"
  | "Notification"
  | "PreCompact"
  | "PostCompact"
  | "SubagentStart"
  | "SubagentStop";

export type HookHandlerType = "command" | "http" | "mcp_tool" | "prompt" | "agent";

export interface AgentHookConfig {
  /** File where this agent reads hooks. Supports `~` expansion. */
  globalHookPath: string;
  /** Project-relative path, may be undefined for agents without project scope. */
  localHookPath?: string;
  format: HookFormat;
  /** Hooks can be read out of this agent's config, making it usable as a transform source. */
  transformReadable?: boolean;
  /** Hooks can be written into this agent's config, making it usable as a transform target. */
  transformWritable?: boolean;
  /** Events the agent honors. Anything outside this set is dropped at bridge time. */
  supportedEvents: readonly HookEvent[];
  /** Handler types the agent executes. Anything outside this set is dropped. */
  supportedHandlerTypes: readonly HookHandlerType[];
  /**
   * Placeholders the agent recognizes. Bridge consults the source-agent
   * placeholder list to identify tokens that need rewriting and the
   * target-agent list as the canonical destination form.
   */
  placeholders: {
    /** Maps abstract token → concrete substring the agent recognizes. */
    projectDir: string;
    pluginRoot?: string;
    pluginData?: string;
  };
}

export type HookScope = "global" | "local";

const agentHookConfigs: Record<string, AgentHookConfig> = {
  "claude-code": {
    globalHookPath: "~/.claude/settings.json",
    localHookPath: ".claude/settings.json",
    format: "claude-settings-json",
    transformReadable: true,
    supportedEvents: [
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "Stop",
      "StopFailure",
      "Notification",
      "PreCompact",
      "PostCompact",
      "SubagentStart",
      "SubagentStop"
    ],
    supportedHandlerTypes: ["command", "http", "mcp_tool", "prompt", "agent"],
    placeholders: {
      projectDir: "${CLAUDE_PROJECT_DIR}",
      pluginRoot: "${CLAUDE_PLUGIN_ROOT}",
      pluginData: "${CLAUDE_PLUGIN_DATA}"
    }
  },
  codex: {
    globalHookPath: "~/.codex/hooks.json",
    localHookPath: ".codex/hooks.json",
    format: "codex-hooks-json",
    transformWritable: true,
    supportedEvents: [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "Stop"
    ],
    supportedHandlerTypes: ["command"],
    placeholders: {
      projectDir: "$(git rev-parse --show-toplevel)",
      pluginRoot: "$PLUGIN_ROOT",
      pluginData: "$PLUGIN_DATA"
    }
  }
};

export const supportedHookAgents = Object.freeze(Object.keys(agentHookConfigs)) as readonly string[];

export type AgentSupportStatus = "supported" | "unsupported" | "unknown";

export interface AgentSupportResult {
  status: AgentSupportStatus;
  input: string;
  id?: string;
  config?: AgentHookConfig;
}

export function resolveAgentSupport(
  input: string,
  registry: Record<string, AgentHookConfig> = agentHookConfigs
): AgentSupportResult {
  const resolvedId = resolveAgentId(input);
  if (!resolvedId) {
    return { status: "unknown", input };
  }

  const config = registry[resolvedId];
  if (!config) {
    return { status: "unsupported", input, id: resolvedId };
  }

  return { status: "supported", input, id: resolvedId, config: cloneAgentHookConfig(config) };
}

export interface TransformPair {
  source: string;
  target: string;
}

/**
 * A transform can run when hooks can be read out of the source, written into
 * the target, and the two speak different formats (same format is a symlink).
 */
export function canTransform(source: AgentHookConfig, target: AgentHookConfig): boolean {
  return (
    source.transformReadable === true &&
    target.transformWritable === true &&
    source.format !== target.format
  );
}

/**
 * Source→target pairs the transform strategy can actually bridge, derived from
 * which agents expose readable and writable hook configs.
 */
export function supportedTransformPairs(
  registry: Record<string, AgentHookConfig> = agentHookConfigs
): TransformPair[] {
  const entries = Object.entries(registry);
  return entries.flatMap(([source, sourceConfig]) =>
    entries
      .filter(([, targetConfig]) => canTransform(sourceConfig, targetConfig))
      .map(([target]) => ({ source, target }))
  );
}

export function formatSupportedTransformPairs(): string {
  return supportedTransformPairs()
    .map((pair) => `${pair.source} -> ${pair.target}`)
    .join(", ");
}

export function isTransformSupported(sourceInput: string, targetInput: string): boolean {
  const source = resolveAgentSupport(sourceInput).config;
  const target = resolveAgentSupport(targetInput).config;
  return source !== undefined && target !== undefined && canTransform(source, target);
}

export function getAgentConfig(agentId: string): AgentHookConfig | undefined {
  const support = resolveAgentSupport(agentId);
  return support.status === "supported" ? support.config : undefined;
}

function cloneAgentHookConfig(config: AgentHookConfig): AgentHookConfig {
  return {
    ...config,
    supportedEvents: [...config.supportedEvents],
    supportedHandlerTypes: [...config.supportedHandlerTypes],
    placeholders: { ...config.placeholders }
  };
}

function expandHome(targetPath: string, homeDir: string = os.homedir()): string {
  if (!targetPath?.startsWith("~")) {
    return targetPath;
  }

  if (targetPath === "~") {
    return homeDir;
  }

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

export function resolveHookPath(
  config: AgentHookConfig,
  scope: HookScope,
  cwd: string,
  homeDir?: string
): string | undefined {
  if (scope === "global") {
    return path.resolve(expandHome(config.globalHookPath, homeDir));
  }

  return config.localHookPath ? path.resolve(cwd, config.localHookPath) : undefined;
}
