import type { AcpMiddleware, SpawnContext } from "./stream.js";
export declare const usageCapture: AcpMiddleware;
export declare function getCapturedUsage(
  usage: SpawnContext["usage"] | undefined
): SpawnContext["usage"] | undefined;
export declare function captureAbortUsage(
  error: unknown,
  usage: SpawnContext["usage"] | undefined
): unknown;
