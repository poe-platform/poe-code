import type { SnapshotMissBehavior, SnapshotMode } from "./snapshot-client.js";

export const SNAPSHOT_DIR = ".snapshots";

export interface SnapshotConfig {
  mode: SnapshotMode;
  onMiss: SnapshotMissBehavior;
}

export function parseSnapshotConfig(env: Record<string, string | undefined>): SnapshotConfig {
  return {
    mode: parseSnapshotMode(env.POE_SNAPSHOT_MODE),
    onMiss: parseSnapshotMiss(env.POE_SNAPSHOT_MISS) ?? "error"
  };
}

function parseSnapshotMode(value: string | undefined): SnapshotMode {
  const trimmed = value?.trim();
  if (trimmed === "record" || trimmed === "playback") {
    return trimmed;
  }
  return "playback";
}

function parseSnapshotMiss(value: string | undefined): SnapshotMissBehavior | undefined {
  const trimmed = value?.trim();
  if (trimmed === "error" || trimmed === "warn" || trimmed === "passthrough" || trimmed === "record") {
    return trimmed;
  }
  return undefined;
}
