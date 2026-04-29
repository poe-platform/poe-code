import type { RunResult, RunSnapshot } from "./run.js";

export function dump(result: Pick<RunResult, "snapshot">): RunSnapshot {
  return result.snapshot;
}
