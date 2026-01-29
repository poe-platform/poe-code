import type { SnapshotMissBehavior, SnapshotMode } from "./snapshot-client.js";

export interface SnapshotConfig {
  mode: SnapshotMode;
  snapshotDir: string;
  onMiss: SnapshotMissBehavior;
}

export function parseSnapshotConfig(env: Record<string, string | undefined>): SnapshotConfig {
  return {
    mode: parseSnapshotMode(env.POE_SNAPSHOT_MODE),
    snapshotDir: env.POE_SNAPSHOT_DIR?.trim() || "__snapshots__",
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
  if (trimmed === "error" || trimmed === "warn" || trimmed === "passthrough") {
    return trimmed;
  }
  return undefined;
}
