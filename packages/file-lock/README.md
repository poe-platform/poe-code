# @poe-code/file-lock

Minimal file-based locking built on atomic lockfile creation with `open(..., "wx")`.

## Configuration

This package exposes the following options via `FileLockOptions`:

- `staleMs`
  Lockfile age threshold in milliseconds before the lock is treated as stale and reclaimed. Default: `30_000`.
- `retries`
  Number of retry attempts after the initial acquire attempt when the lock already exists. Default: `20`.
- `minTimeout`
  Minimum retry backoff in milliseconds. Default: `25`.
- `maxTimeout`
  Maximum retry backoff in milliseconds. Default: `250`.
- `fs`
  Optional filesystem implementation used for acquiring, inspecting, and deleting the lockfile. Defaults to `node:fs/promises`.
- `signal`
  Optional `AbortSignal` that cancels acquisition while waiting between retries.

## Environment Variables

This package does not read any environment variables directly.
