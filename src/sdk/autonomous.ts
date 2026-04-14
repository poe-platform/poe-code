import { isActivityTimeoutError, renderAcpStream, type AcpEvent } from "@poe-code/agent-spawn";
import type { SpawnOptions, SpawnResult } from "./types.js";

const DEFAULT_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_TIMEOUT_RETRIES = 3;

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
  const {
    service,
    maxTimeoutRetries = DEFAULT_MAX_TIMEOUT_RETRIES,
    activityTimeoutMs = DEFAULT_ACTIVITY_TIMEOUT_MS,
    ...spawnOptions
  } = options;

  for (let attempt = 1; attempt <= maxTimeoutRetries; attempt++) {
    try {
      const { events, result } = sdkSpawn(service, {
        ...spawnOptions,
        activityTimeoutMs
      });
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
