import {
  FileSnapshotBackend,
  type FileSnapshotBackendOptions,
  type Snapshot,
  type SnapshotBackend
} from "./backend.js";
import { UnsnapshotableValueError } from "./serialize.js";

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
      resume() {}
    };
  }

  const intervalMs = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  if (intervalMs === 0) {
    return {
      async finish() {},
      onYield() {},
      pause() {},
      resume() {}
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
      let snapshot: TSnapshot;
      try {
        snapshot = createSnapshot();
      } catch (error) {
        if (error instanceof UnsnapshotableValueError) {
          logSkippedSnapshot(error);
          return;
        }
        throw error;
      }
      pendingWrite = pendingWrite
        .catch(() => undefined)
        .then(async () => {
          try {
            await snapshotBackend.write(snapshot as Snapshot);
          } catch (error) {
            if (error instanceof UnsnapshotableValueError) {
              logSkippedSnapshot(error);
              return;
            }
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
    }
  };
}

function logSkippedSnapshot(error: UnsnapshotableValueError): void {
  console.warn(`Skipping periodic snapshot: ${error.message} (at ${error.path})`);
}

function createFileSnapshotBackendOptions(
  options: SnapshotSchedulerOptions
): FileSnapshotBackendOptions {
  return {
    writeMaxAttempts: options.snapshotWriteMaxAttempts,
    writeRetryDelayMs: options.snapshotWriteRetryDelayMs
  };
}
