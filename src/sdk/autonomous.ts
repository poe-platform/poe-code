import { spawnAutonomous as agentSpawnAutonomous, type AcpEvent } from "@poe-code/agent-spawn";
import type { SpawnOptions, SpawnResult } from "./types.js";

export interface AutonomousSpawnOptions extends SpawnOptions {
  service: string;
  maxTimeoutRetries?: number;
}

export type SdkSpawnFn = (
  service: string,
  options: SpawnOptions
) => {
  events: AsyncIterable<AcpEvent>;
  result: Promise<SpawnResult>;
};

export async function spawnAutonomous(
  sdkSpawn: SdkSpawnFn,
  options: AutonomousSpawnOptions
): Promise<SpawnResult> {
  return agentSpawnAutonomous<SpawnOptions, SpawnResult>(sdkSpawn, options);
}
