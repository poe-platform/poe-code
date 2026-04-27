# @poe-code/file-lock

Atomic file locking built on lockfile creation with `open(..., "wx")` and timestamped stale cleanup.

It creates a sibling lockfile at `<filePath>.lock`, retries with bounded backoff when the lock is already held, and automatically reclaims stale locks. Locks from the current host are reclaimed immediately when their recorded process is no longer running; other locks fall back to the lockfile timestamp and `staleMs`.

## Public API

### `acquireFileLock(filePath, options?)`

```ts
function acquireFileLock(
  filePath: string,
  options?: FileLockOptions
): Promise<ReleaseLock>;
```

Attempts to acquire an exclusive lock for `filePath` and resolves to an async release function. If the lock already exists, acquisition retries until it succeeds, the lock is considered stale and cleaned up, the provided abort signal fires, or retries are exhausted. When retries are exhausted, it throws `LockTimeoutError`.

## Options

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `staleMs` | `number` | `1_000` | Lockfile age in milliseconds after which an existing lock is treated as stale and removed when live local PID metadata does not prove the owner is still running. |
| `retries` | `number` | `20` | Number of retry attempts after the initial acquire attempt. |
| `minTimeout` | `number` | `25` | Minimum retry backoff in milliseconds. |
| `maxTimeout` | `number` | `250` | Maximum retry backoff in milliseconds. |
| `isPidRunning` | `(pid: number) => boolean` | `process.kill(pid, 0)` check | Injectable process liveness check used to reclaim dead local lock owners. |
| `signal` | `AbortSignal` | none | Cancels acquisition while waiting between retries and rejects with an abort error. |
| `fs` | `FileLockFs` | `node:fs/promises` adapter | Injectable filesystem used for lock creation, metadata reading, inspection, and deletion. |

## Env vars

None.

## Usage

```ts
import { acquireFileLock } from "@poe-code/file-lock";

const release = await acquireFileLock("/repo/workflow.md");

try {
  // Do work while holding the lock.
} finally {
  await release();
}
```

## Notes

`@poe-code/agent-harness-tools` re-exports `acquireFileLock` as `lockWorkflow`.
