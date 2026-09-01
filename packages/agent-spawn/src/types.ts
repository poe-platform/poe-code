import type { AdapterType } from "./adapters/index.js";
import type { RuntimeOverrideOptions } from "@poe-code/agent-harness-tools";
import type { StateManager } from "@poe-code/poe-code-config/core";
import type { AcpMiddleware } from "./acp/middleware.js";
import type { SpawnEnvironment } from "./environment.js";

export const SPAWN_MODES = ["yolo", "auto", "edit", "read"] as const;

export type SpawnMode = (typeof SPAWN_MODES)[number];

/**
 * The single source of truth for the permission mode used when a caller does not
 * ask for one. `auto` uses the provider's unattended safe-action policy.
 * Providers without an auto mode reject the spawn instead of silently selecting
 * a more permissive mode. `yolo` must always be requested explicitly.
 */
export const DEFAULT_SPAWN_MODE: SpawnMode = "auto";

export type SpawnModeConfig = string[] | { args?: string[]; env?: Record<string, string> };

/**
 * `auto` is optional: it maps to the agent's native ask-style approval mode and
 * must be omitted when the agent has no approval channel in headless runs.
 */
export type SpawnModesConfig = Record<Exclude<SpawnMode, "auto">, SpawnModeConfig> & {
  auto?: SpawnModeConfig;
};

export function resolveModeConfig(modeConfig: SpawnModeConfig): {
  args: string[];
  env?: Record<string, string>;
} {
  if (Array.isArray(modeConfig)) {
    return { args: modeConfig };
  }
  return {
    args: modeConfig.args ?? [],
    env: modeConfig.env && Object.keys(modeConfig.env).length > 0 ? modeConfig.env : undefined
  };
}

export function resolveAgentModeConfig(
  config: Pick<CliSpawnConfig, "agentId" | "modes">,
  mode: SpawnMode | undefined
): {
  args: string[];
  env?: Record<string, string>;
} {
  const selected = mode ?? DEFAULT_SPAWN_MODE;
  const modeConfig = config.modes[selected];
  if (modeConfig === undefined) {
    const supported = SPAWN_MODES.filter((name) => config.modes[name] !== undefined);
    throw new Error(
      `Agent "${config.agentId}" does not support mode "${selected}". Supported modes: ${supported.join(", ")}.`
    );
  }
  return resolveModeConfig(modeConfig);
}

export interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /**
   * Whether Codex should automatically approve tools exposed by this explicitly configured server.
   * Defaults to true so headless read/edit spawns can use caller-trusted MCP tools.
   */
  autoApprove?: boolean;
  /**
   * Maximum time in seconds the agent should wait for a single tool call
   * to this MCP server before timing out. Omit to use the agent's default.
   */
  timeout?: number;
}

export type McpSpawnConfig = Record<string, McpSpawnServer>;

export interface McpFileSpec {
  relativePath: string;
  content: (servers: McpSpawnConfig) => Record<string, unknown>;
}

export type OtelSpan = {
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attrs: Record<string, unknown>): void;
  end(): void;
};

export interface OtelSink {
  startSpan(name: string, attrs: Record<string, unknown>): OtelSpan;
  recordException(span: ReturnType<OtelSink["startSpan"]>, error: unknown): void;
}

export interface HookBridgeOptions {
  from: string;
  strategy?: "auto" | "symlink" | "transform";
  scope?: "project" | "user" | "merged";
}

export interface SpawnOptions {
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
  mcpServers?: McpSpawnConfig;
  /** Skill references to bridge into the spawned agent for this run. */
  skills?: string[];
  /** Hooks to bridge from another agent configuration for this run. */
  hooks?: HookBridgeOptions;
  /** Resume a prior provider thread/session before sending the prompt. */
  resumeThreadId?: string;
  useStdin?: boolean;
  interactive?: boolean;
  signal?: AbortSignal;
  otelSink?: OtelSink;
  /** Capture native OTLP telemetry emitted by the spawned agent. */
  captureOtel?: boolean;
  /** Include prompt and tool content in native OTLP telemetry. */
  captureOtelContent?: boolean;
  /** Additional environment passed to the spawned agent. */
  env?: SpawnEnvironment;
  middlewares?: AcpMiddleware[];
  tee?: {
    stdout?: { write(chunk: string): void };
    stderr?: { write(chunk: string): void };
  };
  /**
   * Kill the spawned process after this many milliseconds of inactivity (no stdout data).
   * Resets on every chunk of stdout/stderr received. Disabled when undefined.
   */
  activityTimeoutMs?: number;
  /**
   * Full path for the spawn log file. When set, stdout (and stderr for CLI spawns)
   * are appended to this file, and the absolute path is returned in `SpawnResult.logFile`.
   * Takes precedence over `logDir` + `logFileName`.
   */
  logPath?: string;
  /**
   * Directory for the spawn log file. When set together with `logFileName`, stdout
   * (and stderr for CLI spawns) are appended to `<logDir>/<logFileName>`, and the
   * absolute path is returned in `SpawnResult.logFile`.
   */
  logDir?: string;
  /** Overrides the auto-generated log filename. Must be used together with `logDir`. */
  logFileName?: string;
  /** Per-invocation runtime/runner config overrides. */
  runtime?: RuntimeOverrideOptions["runtime"];
  /** Docker image override for docker runtime. */
  runtimeImage?: string;
  /** Directory used to load runtime config/templates when different from cwd. */
  runtimeConfigCwd?: string;
  /** Run through a detached runtime job when the backend supports it. */
  detach?: boolean;
  /** Mount the local poe-code checkout into the runtime for development. */
  mountPoeCode?: boolean;
  /** Override runner workspace sync behavior. */
  runnerSync?: RuntimeOverrideOptions["runnerSync"];
}

export interface SpawnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs?: number;
  threadId?: string;
  usage?: SpawnUsage;
  logFile?: string;
  detached?: { jobId: string; envId: string };
}

export interface AutonomousResult {
  summary?: string;
  log?: string;
  output?: string;
  stdout?: string;
  text?: string;
  logFile?: string;
  toolCalls?: unknown[];
  sessionResult?: {
    toolCalls?: unknown[];
  };
}

export interface SpawnLogger {
  dryRun(message: string): void;
}

export interface SpawnContext {
  dryRun?: boolean;
  logger?: SpawnLogger;
  homeDir?: string;
  state?: StateManager;
}

export interface StdinMode {
  omitPrompt: boolean;
  extraArgs: string[];
  automaticFallback?: boolean;
}

export interface InteractiveSpawnConfig {
  defaultArgs: string[];
  defaultArgsPosition?: "beforePrompt" | "afterPrompt";
  promptFlag?: string;
}

export interface CliSpawnConfig {
  kind: "cli";
  agentId: string;
  adapter: AdapterType;
  promptFlag?: string;
  defaultArgs: string[];
  defaultArgsPosition?: "beforePrompt" | "afterPrompt";
  modes: SpawnModesConfig;
  stdinMode?: StdinMode;
  modelFlag?: string;
  /**
   * Controls whether the provider prefix is stripped from model IDs before passing to the CLI binary.
   *
   * When `true`: "anthropic/claude-opus-4.6" → "claude-opus-4.6", "openai/gpt-5.2" → "gpt-5.2"
   * When `false`: "anthropic/claude-opus-4.6" stays as-is, "openai/gpt-5.2" stays as-is
   *
   * Most CLI binaries only accept bare model IDs (e.g. `claude --model claude-opus-4.6`),
   * so they need `true`. OpenCode routes through poe and needs the full provider path, so it uses `false`.
   */
  modelStripProviderPrefix: boolean;
  /** Transform model ID before passing to CLI. Runs after provider prefix stripping (if enabled). */
  modelTransform?: (model: string) => string;
  /**
   * Transforms MCP server config into CLI args for this agent.
   * Presence of this function declares spawn-time MCP support.
   */
  mcpArgs?: (servers: McpSpawnConfig) => string[];
  /**
   * Transforms MCP server config into env vars for this agent.
   * Use instead of `mcpArgs` when the agent reads MCP config from the environment.
   */
  mcpEnv?: (servers: McpSpawnConfig) => Record<string, string>;
  mcpFile?: McpFileSpec;
  /**
   * Controls where serialized MCP args are inserted relative to the command.
   *
   * - "beforeCommand": before the prompt/subcommand section (e.g. `codex -c ... exec "prompt"`)
   * - "beforePrompt": after `defaultArgs` but before the prompt/model section
   * - "afterCommand": after `defaultArgs` (default)
   */
  mcpArgsPosition?: "beforeCommand" | "beforePrompt" | "afterCommand";
  /**
   * @deprecated Prefer `mcpArgsPosition`.
   * When true, MCP args are placed before the subcommand (e.g. `codex -c ... exec "prompt"`).
   * When false/undefined, they are placed after defaultArgs (e.g. `claude -p "prompt" --mcp-servers ...`).
   */
  mcpArgsBeforeCommand?: boolean;
  interactive?: InteractiveSpawnConfig;
  resume?: ResumeSpec;
}

export interface ResumeSpec {
  /** Args injected into the live spawn for non-interactive resume. */
  args: (threadId: string, cwd: string) => string[];
  /** Position of `args` relative to the prompt token. Default `afterPrompt`. */
  position?: "beforePrompt" | "afterPrompt";
  /**
   * Some CLIs implement resume as a subcommand under the normal prompt command
   * and require command options before the resume token.
   */
  commandOptionsPosition?: "beforeResume";
  /**
   * Optional override for the printed copy-paste resume hint (e.g. an interactive
   * shell command). When omitted, the hint composes binaryName + `args`.
   */
  hintArgs?: (threadId: string, cwd: string) => string[];
}

export interface FileSpawnConfig {
  kind: "file";
  agentId: string;
  launchCommand?: string;
  launchArgs?: string[];
}

export interface AcpSpawnConfig {
  kind: "acp";
  agentId: string;
  /** Args passed to the agent binary to start its ACP server (e.g. ["acp"]). */
  acpArgs:
    | string[]
    | ((options: { model?: string; mode?: SpawnMode; mcpServers?: McpSpawnConfig }) => string[]);
  /** Environment variables required by the ACP server process. */
  env?: Record<string, string>;
  /** Whether to skip the ACP authenticate step (workaround for servers that advertise but don't implement auth). */
  skipAuth?: boolean;
  /** Whether MCP servers may be forwarded through ACP sessions. Defaults to true. */
  supportsMcpServers?: boolean;
  /** MCP server env serializer, same as CliSpawnConfig. */
  mcpEnv?: (servers: McpSpawnConfig) => Record<string, string>;
}

export type SpawnConfig = CliSpawnConfig | FileSpawnConfig | AcpSpawnConfig;
