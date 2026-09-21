import type { SpawnHandle } from "./retry.js";
export type SpawnParallelTuple<TService, TOptions> = readonly [
  service: TService,
  options: TOptions
];
export type SpawnParallelThunk<
  TResult extends {
    exitCode: number;
  }
> = (signal?: AbortSignal) => SpawnHandle<TResult>;
export type SpawnParallelCall<
  TService,
  TOptions,
  TResult extends {
    exitCode: number;
  }
> = SpawnParallelTuple<TService, TOptions> | SpawnParallelThunk<TResult>;
export type SpawnParallelOptions = {
  check?: boolean;
  maxConcurrent?: number;
  failFast?: boolean;
  signal?: AbortSignal;
};
export declare class SpawnParallelError<
  TResult extends {
    exitCode: number;
  }
> extends Error {
  readonly index: number;
  readonly result: TResult;
  readonly results: Array<TResult | undefined>;
  constructor(index: number, result: TResult, results: Array<TResult | undefined>);
}
export declare function createSpawnParallel<
  TService,
  TOptions extends {
    signal?: AbortSignal;
  },
  TResult extends {
    exitCode: number;
  }
>(
  spawnOnce: (service: TService, options: TOptions) => SpawnHandle<TResult>
): (
  calls: Array<SpawnParallelCall<TService, TOptions, TResult>>,
  options?: SpawnParallelOptions
) => Promise<TResult[]>;
