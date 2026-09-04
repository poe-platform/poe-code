import type { ShellLimits } from "./types.js";

export const cloudflareWorkerLimits: Readonly<Required<ShellLimits>> = Object.freeze({
  maxParseUnits: 65_536,
  maxInputBytes: 4 * 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxCommands: 1_000,
  maxRedirects: 64,
  maxPipelineStages: 64,
  maxLoopIterations: 1_000,
  maxSubstitutionDepth: 16,
  maxSourceBytes: 256 * 1024,
  maxExpansionFields: 1_000,
  maxExpansionBytes: 4 * 1024 * 1024,
  maxWallClockMs: 10_000,
  maxCpuMs: 10_000,
  pipeHighWaterMark: 16 * 1024,
});
