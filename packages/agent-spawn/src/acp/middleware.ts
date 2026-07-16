import type { SpawnMode, SpawnUsage } from "../types.js";
import type { AcpEvent } from "./types.js";

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

export async function applyMiddlewares(
  middlewares: AcpMiddleware[],
  ctx: SpawnContext
): Promise<void> {
  let index = -1;

  async function dispatch(position: number): Promise<void> {
    if (position <= index) {
      throw new Error("next() called multiple times");
    }

    index = position;
    if (position === middlewares.length) {
      return;
    }

    const middleware = middlewares[position];
    if (typeof middleware !== "function") {
      throw new Error(`Invalid ACP middleware at index ${position}`);
    }

    await middleware(ctx, () => dispatch(position + 1));
  }

  await dispatch(0);
}
