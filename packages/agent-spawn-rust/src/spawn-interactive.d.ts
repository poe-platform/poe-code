import type { SpawnOptions, SpawnResult } from "./types.js";
export declare function spawnInteractive(
  agentId: string,
  options: SpawnOptions
): Promise<SpawnResult>;
