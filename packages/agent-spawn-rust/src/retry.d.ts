import type { AcpEvent } from "./acp-types.js";
export type SpawnRetryOptions<
  TResult extends {
    exitCode: number;
  }
> = {
  maxAttempts: number;
  backoffMs: number;
  isRetryable?: (result: TResult) => boolean;
};
export type SpawnHandle<TResult> = {
  events: AsyncIterable<AcpEvent>;
  result: Promise<TResult>;
};
export type SpawnRetryFunction<
  TOptions extends {
    signal?: AbortSignal;
  },
  TResult extends {
    exitCode: number;
  }
> = (
  service: string,
  options: TOptions,
  retryOptions: SpawnRetryOptions<TResult>
) => SpawnHandle<TResult>;
export declare function createSpawnRetry<
  TOptions extends {
    signal?: AbortSignal;
  },
  TResult extends {
    exitCode: number;
  }
>(
  spawnOnce: (service: string, options: TOptions) => SpawnHandle<TResult>
): SpawnRetryFunction<TOptions, TResult>;
export declare function defaultIsRetryable(result: { exitCode: number }): boolean;
export declare function calculateBackoffMs(baseBackoffMs: number, completedAttempt: number): number;
