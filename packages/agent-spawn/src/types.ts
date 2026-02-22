import type { AdapterType } from "./adapters/index.js";

export type SpawnMode = "yolo" | "edit" | "read";

export interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpSpawnConfig = Record<string, McpSpawnServer>;

export interface SpawnOptions {
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
  mcpServers?: McpSpawnConfig;
  useStdin?: boolean;
  interactive?: boolean;
  tee?: {
    stdout?: { write(chunk: string): void };
    stderr?: { write(chunk: string): void };
  };
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
  threadId?: string;
  sessionId?: string;
  usage?: SpawnUsage;
}

export interface SpawnLogger {
  dryRun(message: string): void;
}

export interface SpawnContext {
  dryRun?: boolean;
  logger?: SpawnLogger;
  homeDir?: string;
}

export interface StdinMode {
  omitPrompt: boolean;
  extraArgs: string[];
}

export interface InteractiveSpawnConfig {
  defaultArgs: string[];
  promptFlag?: string;
}

export interface CliSpawnConfig {
  kind: "cli";
  agentId: string;
  adapter: AdapterType;
  promptFlag: string;
  defaultArgs: string[];
  modes: Record<SpawnMode, string[]>;
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
  interactive?: InteractiveSpawnConfig;
  resumeCommand?: (threadId: string, cwd: string) => string[];
}

export interface FileSpawnConfig {
  kind: "file";
  agentId: string;
  launchCommand?: string;
  launchArgs?: string[];
}

export type SpawnConfig = CliSpawnConfig | FileSpawnConfig;
