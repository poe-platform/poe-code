import type { Readable } from "node:stream";
import type { SpawnUsage, SpawnMode } from "./types.js";
import type { AcpEvent } from "./acp-types.js";
export interface SessionToolCall {
  id?: string;
  kind?: string;
  title?: string;
  input?: unknown;
  path?: string;
  status?: "completed" | "failed" | "cancelled";
}
export interface SessionResult {
  output: string;
  messages: string[];
  toolCalls: SessionToolCall[];
}
export interface SpawnContext {
  sessionId: string;
  agent: string;
  logPath?: string;
  logDir?: string;
  logFileName?: string;
  logContent?: boolean;
  events: AcpEvent[];
  usage: SpawnUsage;
  eventStream?: AsyncIterable<AcpEvent>;
  sessionResult?: SessionResult;
  threadId?: string;
  prompt?: string;
  model?: string;
  mode?: SpawnMode;
  cwd?: string;
  startedAt?: Date;
  logFile?: string;
  /** Reason the spawn log could not be written, when logging failed. */
  logError?: string;
  metadata?: Record<string, unknown>;
}
export type AcpMiddleware = (ctx: SpawnContext, next: () => Promise<void>) => Promise<void>;
export declare function applyMiddlewares(
  middlewares: AcpMiddleware[],
  ctx: SpawnContext
): Promise<void>;
export declare function readLines(stream: Readable): AsyncGenerator<string>;
