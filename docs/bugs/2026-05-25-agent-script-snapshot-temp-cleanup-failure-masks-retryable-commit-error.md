# Agent-script snapshot temp cleanup failure masks retryable commit error

## Summary

The exported `@poe-code/agent-script` `FileSnapshotBackend.write()` API stages a snapshot in a `.tmp` file and retries commits that fail with lock-related errors such as `EBUSY`. However, if removing that temporary file fails after a retryable rename failure, the cleanup error replaces the lock error before retry classification, causing the write to reject immediately without using its remaining retry attempts.

## Reproduction

From the repository root, add a disposable probe at `packages/agent-script/src/snapshot/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  stat: vi.fn(async () => ({ isDirectory: () => true })),
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => {
    const error = new Error("snapshot is locked") as NodeJS.ErrnoException;
    error.code = "EBUSY";
    throw error;
  }),
  unlink: vi.fn(async () => {
    throw new Error("temp cleanup denied");
  })
}));

vi.mock("node:fs/promises", () => mocked);

const { FileSnapshotBackend } = await import("./backend.js");

describe("agent-script snapshot cleanup masking repro", () => {
  it("reports temp cleanup failure instead of retrying a locked snapshot commit", async () => {
    const backend = new FileSnapshotBackend("/snapshots/run.json", {
      writeMaxAttempts: 3,
      writeRetryDelayMs: 0
    });

    await expect(
      backend.write({ sourceHash: "abc123", version: 1, clock: {}, modules: {} })
    ).rejects.toThrow("temp cleanup denied");
    expect(mocked.rename).toHaveBeenCalledTimes(1);
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-script/src/snapshot/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-script/src/snapshot/__probe__.test.ts > agent-script snapshot cleanup masking repro > reports temp cleanup failure instead of retrying a locked snapshot commit
```

Remove the disposable probe after validation.

## Observed Behavior

The probe configures `writeMaxAttempts: 3`, makes the snapshot rename fail with retryable error code `EBUSY`, and makes abandoned temporary-file cleanup reject with `temp cleanup denied`. `FileSnapshotBackend.write()` rejects with the cleanup message, and `rename()` is called only once instead of attempting the configured retries.

## Expected Behavior

Temporary-file cleanup failure should not replace the primary retryable commit error or prevent configured retry behavior. The backend should retain the lock failure for classification and report cleanup as secondary diagnostic information if cleanup also fails.

## Impact

On platforms where antivirus scanners, editors, synchronization tools, or concurrent processes briefly lock a snapshot destination, an otherwise recoverable snapshot update can fail permanently because cleanup of the staging file also encounters an error. Callers receive misleading diagnostics, configured resilience is bypassed, and checkpoint persistence can fail even though a later retry would have succeeded.
