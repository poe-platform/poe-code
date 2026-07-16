export type SpawnMode = "yolo" | "auto" | "edit" | "read";
export type Runtime = "host" | "docker";
export type RunnerSync = "both" | "upload" | "none";

export interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  autoApprove?: boolean;
  timeout?: number;
}

export type McpSpawnConfig = Record<string, McpSpawnServer>;

export type AcpEvent = any;

export interface SessionToolCall {
  id?: string;
  kind?: string;
  title?: string;
  input?: unknown;
  path?: string;
}

export interface SessionResult {
  output: string;
  messages: string[];
  toolCalls: SessionToolCall[];
}

export interface AcpSpawnContext {
  sessionId: string;
  agent: string;
  events: AcpEvent[];
  usage: SpawnUsage;
  eventStream?: AsyncIterable<AcpEvent>;
  prompt?: string;
  model?: string;
  mode?: SpawnMode;
  cwd?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type AcpMiddleware = (...args: any[]) => Promise<void>;

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

import type { TraceSink } from "./trace.js";
import type { Worktree, WorktreeReconciliationSummary } from "@poe-code/worktree";

export type WorktreeExecutionOptions = boolean;

export type WorktreeExecutionResult = {
  worktree: Worktree;
  reconciliation?: WorktreeReconciliationSummary;
};

/**
 * Options for spawning a provider CLI.
 */
export interface SpawnOptions {
  /** The prompt to send to the provider */
  prompt: string;
  /** Working directory or workspace locator for the service CLI */
  cwd?: string;
  /** Model identifier override */
  model?: string;
  /** Permission mode: yolo | auto | edit | read (default: edit; yolo must be requested explicitly) */
  mode?: SpawnMode;
  /** Additional arguments forwarded to the CLI */
  args?: string[];
  /** Environment overrides applied only to this spawned run. */
  env?: Record<string, string | undefined>;
  /** MCP servers passed at spawn time */
  mcpServers?: McpSpawnConfig;
  /** @deprecated Use mcpServers instead. */
  mcpConfig?: McpSpawnConfig;
  /** Skill references to bridge into the spawned agent for this run. */
  skills?: string[];
  /** Hooks to bridge from another agent configuration for this run. */
  hooks?: HookBridgeOptions;
  /** Resume a prior provider thread/session before sending the prompt. */
  resumeThreadId?: string;
  /** Directory override for ACP JSONL spawn logs */
  logDir?: string;
  /** Filename override for the spawn log. Requires `logDir`. */
  logFileName?: string;
  /** Include message/tool content in ACP JSONL spawn logs. Defaults to redacted logs. */
  logContent?: boolean;
  /** Additional ACP middlewares appended to the spawn capture chain. */
  middlewares?: AcpMiddleware[];
  /** Receive the completed backend-neutral ACP trace exactly once. */
  traceSink?: TraceSink;
  /** Launch the agent in interactive (TUI) mode with inherited stdio */
  interactive?: boolean;
  /** Abort signal used to terminate the spawned agent */
  signal?: AbortSignal;
  /** OpenTelemetry-compatible sink supplied by the consumer */
  otelSink?: OtelSink;
  /** Capture native OTLP telemetry emitted internally by the spawned agent. */
  captureOtel?: boolean;
  /** Include prompt and tool content in native OTLP telemetry. */
  captureOtelContent?: boolean;
  /** Send the prompt over stdin when the provider supports it */
  useStdin?: boolean;
  /** Mirror spawned stdout/stderr chunks to additional writers while preserving the final result */
  tee?: {
    stdout?: { write(chunk: string): void };
    stderr?: { write(chunk: string): void };
  };
  /**
   * Kill the spawned process after this many milliseconds of inactivity (no stdout data).
   * Disabled when undefined.
   */
  activityTimeoutMs?: number;
  /** Runtime backend override: host or docker */
  runtime?: Runtime;
  /** Docker image override for docker runtime */
  runtimeImage?: string;
  /** Directory used to load runtime config/templates when different from cwd */
  runtimeConfigCwd?: string;
  /** Run as a detached runtime job when supported */
  detach?: boolean;
  /** Mount the local poe-code checkout into the runtime for development */
  mountPoeCode?: boolean;
  /** Runner workspace sync override: both, upload, or none */
  runnerSync?: RunnerSync;
  /** Run the provider in a managed git worktree and reconcile successful output afterward */
  worktree?: WorktreeExecutionOptions;
}

/**
 * Token usage reported by a provider CLI spawn.
 */
export interface SpawnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
}

/**
 * Result from spawning a provider CLI.
 */
export interface SpawnResult {
  /** Standard output from the CLI */
  stdout: string;
  /** Standard error from the CLI */
  stderr: string;
  /** Exit code from the CLI process */
  exitCode: number;
  /** Thread identifier from streaming agents (if available) */
  threadId?: string;
  /** Token usage from providers that report usage */
  usage?: SpawnUsage;
  /** Path to the JSONL spawn log file (if logging was active) */
  logFile?: string;
  /** Detached runtime job details when detach mode is used */
  detached?: { jobId: string; envId: string };
  /** Captured session messages and tool calls (ACP streaming only) */
  sessionResult?: SessionResult;
  /** Managed worktree metadata when worktree mode is enabled */
  worktree?: WorktreeExecutionResult;
}

export interface SpawnRetryOptions {
  maxAttempts: number;
  backoffMs: number;
  isRetryable?: (result: SpawnResult) => boolean;
}
