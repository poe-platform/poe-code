import type { OtelSink, SpawnMode, SpawnResult } from "./types.js";
export declare const noopOtelSink: OtelSink;
export declare function observeAgentSpawn(
  input: { agent: string; cwd?: string; mode?: SpawnMode; otelSink?: OtelSink; prompt: string },
  operation: () => Promise<SpawnResult>
): Promise<SpawnResult>;
