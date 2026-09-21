import type { SpawnOptions, SpawnResult, SpawnContext } from "./types.js";
import type { createSpawnParallel } from "./parallel.js";
export declare function spawn(
  agentId: string,
  options: SpawnOptions,
  context?: SpawnContext
): Promise<SpawnResult>;
export declare namespace spawn {
  const parallel: ReturnType<typeof createSpawnParallel<string, SpawnOptions, SpawnResult>>;
}
export declare function isActivityTimeoutError(error: unknown): boolean;
