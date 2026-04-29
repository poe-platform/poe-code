import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_SNAPSHOT_INTERVAL_MS = 30_000;

export type SnapshotSchedulerOptions = {
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
  if (options.snapshotPath === undefined) {
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
        await writeSnapshotAtomically(options.snapshotPath as string, snapshot);
      });
    }
  };
}

async function writeSnapshotAtomically<TSnapshot>(
  snapshotPath: string,
  snapshot: TSnapshot
): Promise<void> {
  const temporaryPath = `${snapshotPath}.tmp`;

  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2));
  await rename(temporaryPath, snapshotPath);
}
