import { FileSnapshotBackend } from "./backend.js";
const DEFAULT_SNAPSHOT_INTERVAL_MS = 30_000;
export function createSnapshotScheduler(options) {
    const snapshotBackend = options.snapshotBackend ??
        (options.snapshotPath === undefined
            ? undefined
            : new FileSnapshotBackend(options.snapshotPath, createFileSnapshotBackendOptions(options)));
    if (snapshotBackend === undefined) {
        return {
            async finish() { },
            onYield() { },
            pause() { },
            resume() { },
            async write() { }
        };
    }
    const intervalMs = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
    if (intervalMs === 0) {
        return {
            async finish() { },
            onYield() { },
            pause() { },
            resume() { },
            async write(snapshot) {
                await snapshotBackend.write(snapshot);
            }
        };
    }
    let nextCheckpointAt = Date.now() + intervalMs;
    let pendingWrite = Promise.resolve();
    let isPaused = false;
    const writeErrors = [];
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
                    await snapshotBackend.write(snapshot);
                }
                catch (error) {
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
            await snapshotBackend.write(snapshot);
        }
    };
}
function createFileSnapshotBackendOptions(options) {
    return {
        writeMaxAttempts: options.snapshotWriteMaxAttempts,
        writeRetryDelayMs: options.snapshotWriteRetryDelayMs
    };
}
