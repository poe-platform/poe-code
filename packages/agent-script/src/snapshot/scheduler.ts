import { FileSnapshotBackend, type Snapshot, type SnapshotBackend } from "./backend.js";

const DEFAULT_SNAPSHOT_INTERVAL_MS = 30_000;

export type SnapshotSchedulerOptions = {
  snapshotBackend?: SnapshotBackend;
  snapshotIntervalMs?: number;
  snapshotPath?: string;
};

export type SnapshotScheduler<TSnapshot> = {
  finish(): Promise<void>;
  onYield(createSnapshot: () => TSnapshot): void;
};

export function createSnapshotScheduler<TSnapshot>(
  options: SnapshotSchedulerOptions
): SnapshotScheduler<TSnapshot> {
  const snapshotBackend =
    options.snapshotBackend ??
    (options.snapshotPath === undefined
      ? undefined
      : new FileSnapshotBackend(options.snapshotPath));

  if (snapshotBackend === undefined) {
    return {
      async finish() {},
      onYield() {}
    };
  }

  const intervalMs = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  let nextCheckpointAt = Date.now() + intervalMs;
  let pendingWrite = Promise.resolve();

  return {
    async finish() {
      await pendingWrite;
    },
    onYield(createSnapshot) {
      if (Date.now() < nextCheckpointAt) {
        return;
      }

      const snapshot = createSnapshot();
      nextCheckpointAt = Date.now() + intervalMs;
      pendingWrite = pendingWrite.then(async () => {
        await snapshotBackend.write(snapshot as Snapshot);
      });
    }
  };
}
