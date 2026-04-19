import type { McpSpawnConfig, SessionResult, SpawnMode } from "@poe-code/agent-spawn";

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
  /** Permission mode: yolo | edit | read (default: yolo) */
  mode?: SpawnMode;
  /** Additional arguments forwarded to the CLI */
  args?: string[];
  /** MCP servers passed at spawn time */
  mcpServers?: McpSpawnConfig;
  /** @deprecated Use mcpServers instead. */
  mcpConfig?: McpSpawnConfig;
  /** Directory override for ACP JSONL spawn logs */
  logDir?: string;
  /** Filename override for the spawn log. Requires `logDir`. */
  logFileName?: string;
  /** Launch the agent in interactive (TUI) mode with inherited stdio */
  interactive?: boolean;
  /** Abort signal used to terminate the spawned agent */
  signal?: AbortSignal;
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
  /** Captured session messages and tool calls (ACP streaming only) */
  sessionResult?: SessionResult;
}

export interface GenerateOptions {
  /** Model identifier override */
  model?: string;
  /** Additional parameters passed to the API */
  params?: Record<string, string>;
}

export type MediaGenerateOptions = GenerateOptions;

export interface GenerateResult {
  content: string;
}

export interface MediaGenerateResult {
  url: string;
  mimeType?: string;
}
