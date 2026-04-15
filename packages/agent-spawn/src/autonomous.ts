import { renderAcpStream } from "./acp/renderer.js";
import type { AcpEvent } from "./acp/types.js";
import { isActivityTimeoutError } from "./spawn.js";

const DEFAULT_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_TIMEOUT_RETRIES = 3;

export interface StreamingSpawnReturn<TResult> {
  events: AsyncIterable<AcpEvent>;
  result: Promise<TResult>;
}

export type StreamingSpawnFn<TOptions, TResult> = (
  service: string,
  options: TOptions
) => StreamingSpawnReturn<TResult>;

export type AutonomousOptions<TOptions> = TOptions & {
  service: string;
  maxTimeoutRetries?: number;
  activityTimeoutMs?: number;
};

/**
 * Drive a streaming spawn end-to-end: pipe ACP events through `renderAcpStream`
 * (which routes through `withAcpWriter` if bound) and return the final result.
 * Retries on activity timeout up to `maxTimeoutRetries` attempts.
 *
 * Both the SDK `spawn.autonomous` and the superintendent loop consume this —
 * callers supply a streaming spawn function whose `result` promise resolves
 * to their own result shape.
 */
export async function spawnAutonomous<
  TOptions extends { activityTimeoutMs?: number },
  TResult
>(
  spawnFn: StreamingSpawnFn<TOptions, TResult>,
  options: AutonomousOptions<TOptions>
): Promise<TResult> {
  const {
    service,
    maxTimeoutRetries = DEFAULT_MAX_TIMEOUT_RETRIES,
    activityTimeoutMs = DEFAULT_ACTIVITY_TIMEOUT_MS,
    ...rest
  } = options;

  const spawnOptions = { ...rest, activityTimeoutMs } as unknown as TOptions;

  for (let attempt = 1; attempt <= maxTimeoutRetries; attempt += 1) {
    try {
      const { events, result } = spawnFn(service, spawnOptions);
      await renderAcpStream(events);
      return await result;
    } catch (error) {
      if (!isActivityTimeoutError(error) || attempt === maxTimeoutRetries) {
        throw error;
      }
    }
  }

  throw new Error("Unreachable");
}
