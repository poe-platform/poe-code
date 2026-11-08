import type { AcpEvent } from "./acp-types.js";

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

/** Consume events concurrently with the result, retrying only activity timeouts.
 * An explicit maxTimeoutRetries is the total attempt budget, including the initial attempt.
 */
export declare function createSpawnAutonomous(
  consumeEvents: (events: AsyncIterable<AcpEvent>) => void | Promise<void>
): <TOptions extends { activityTimeoutMs?: number; signal?: AbortSignal }, TResult>(
  streamSpawn: StreamingSpawnFn<TOptions, TResult>,
  options: AutonomousOptions<TOptions>
) => Promise<TResult>;
