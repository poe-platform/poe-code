import {
  FileSnapshotBackend,
  type FileSnapshotBackendOptions,
  type Snapshot,
  type SnapshotBackend
} from "./backend.js";

const DEFAULT_SNAPSHOT_INTERVAL_MS = 30_000;

export type SnapshotSchedulerOptions = {
  snapshotBackend?: SnapshotBackend;
  snapshotIntervalMs?: number;
  snapshotPath?: string;
  snapshotWriteMaxAttempts?: number;
  snapshotWriteRetryDelayMs?: number;
};

export type SnapshotScheduler<TSnapshot> = {
  finish(): Promise<void>;
  onYield(createSnapshot: () => TSnapshot): void;
  pause(): void;
  resume(): void;
  write(snapshot: TSnapshot): Promise<void>;
};

export function createSnapshotScheduler<TSnapshot>(
  options: SnapshotSchedulerOptions
): SnapshotScheduler<TSnapshot> {
  const snapshotBackend =
    options.snapshotBackend ??
    (options.snapshotPath === undefined
      ? undefined
      : new FileSnapshotBackend(options.snapshotPath, createFileSnapshotBackendOptions(options)));

  if (snapshotBackend === undefined) {
    return {
      async finish() {},
      onYield() {},
      pause() {},
      resume() {},
      async write() {}
    };
  }

  const intervalMs = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  if (intervalMs === 0) {
    return {
      async finish() {},
      onYield() {},
      pause() {},
      resume() {},
      async write(snapshot) {
        await snapshotBackend.write(snapshot as Snapshot);
      }
    };
  }

  let nextCheckpointAt = Date.now() + intervalMs;
  let pendingWrite = Promise.resolve();
  let isPaused = false;
  const writeErrors: unknown[] = [];

  return {
    async finish() {
      await pendingWrite;
      if (writeErrors.length > 0) {
        throw writeErrors[0];
      }
    },
    onYield(createSnapshot) {
      if (isPaused) {
        return;
      }

      if (Date.now() < nextCheckpointAt) {
        return;
      }

      nextCheckpointAt = Date.now() + intervalMs;
      const snapshot = createSnapshot();
      pendingWrite = pendingWrite
        .catch(() => undefined)
        .then(async () => {
          try {
            await snapshotBackend.write(snapshot as Snapshot);
          } catch (error) {
            writeErrors.push(error);
          }
        });
    },
    pause() {
      isPaused = true;
    },
    resume() {
      if (!isPaused) {
        return;
      }

      isPaused = false;
      nextCheckpointAt = Date.now() + intervalMs;
    },
    async write(snapshot) {
      await pendingWrite.catch(() => undefined);
      await snapshotBackend.write(snapshot as Snapshot);
    }
  };
}

function createFileSnapshotBackendOptions(
  options: SnapshotSchedulerOptions
): FileSnapshotBackendOptions {
  return {
    writeMaxAttempts: options.snapshotWriteMaxAttempts,
    writeRetryDelayMs: options.snapshotWriteRetryDelayMs
  };
}
