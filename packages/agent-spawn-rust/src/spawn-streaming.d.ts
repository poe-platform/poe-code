import type { SpawnOptions, SpawnResult } from "./types.js";
import type { AcpEvent } from "./acp-types.js";
export interface SpawnStreamingOptions extends SpawnOptions {
  agentId: string;
}
export interface SpawnStreamingResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
}
export declare function spawnStreaming(input: SpawnStreamingOptions): SpawnStreamingResult;
