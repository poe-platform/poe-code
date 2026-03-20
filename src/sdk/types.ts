import type { McpSpawnConfig, SpawnMode } from "@poe-code/agent-spawn";

/**
 * Options for spawning a provider CLI.
 */
export interface SpawnOptions {
  /** The prompt to send to the provider */
  prompt: string;
  /** Working directory for the service CLI */
  cwd?: string;
  /** Model identifier override */
  model?: string;
  /** Permission mode: yolo | edit | read (default: yolo) */
  mode?: SpawnMode;
  /** Additional arguments forwarded to the CLI */
  args?: string[];
  /** MCP servers passed at spawn time */
  mcpServers?: McpSpawnConfig;
  /** Launch the agent in interactive (TUI) mode with inherited stdio */
  interactive?: boolean;
  /** Abort signal used to terminate the spawned agent */
  signal?: AbortSignal;
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
  /** Backward-compatible alias for threadId */
  sessionId?: string;
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
