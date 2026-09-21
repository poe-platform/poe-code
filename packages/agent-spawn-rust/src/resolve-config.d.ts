import type { ResolvedSpawnConfig } from "./index.js";
export declare function resolveConfig(
  agentId: string,
  env?: Readonly<Record<string, string | undefined>>
): ResolvedSpawnConfig;
