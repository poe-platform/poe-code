import type { McpSpawnConfig, OtelSink, SpawnMode, SpawnResult } from "./types.js";
import type { AcpEvent } from "./acp-types.js";
import { type AcpMiddleware } from "./stream.js";
type HookBridgeOptions = NonNullable<import("./types.js").SpawnOptions["hooks"]>;
export interface SpawnAcpOptions {
  agentId: string;
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  mcpServers?: McpSpawnConfig;
  skills?: string[];
  hooks?: HookBridgeOptions;
  resumeThreadId?: string;
  runtime?: "host" | "docker";
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: "both" | "upload" | "none";
  signal?: AbortSignal;
  otelSink?: OtelSink;
  middlewares?: AcpMiddleware[];
  env?: Record<string, string | undefined>;
}
export interface SpawnAcpResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
  unstable_setSessionModel?(model: string): Promise<void>;
}
export declare function spawnAcp(input: SpawnAcpOptions): SpawnAcpResult;
