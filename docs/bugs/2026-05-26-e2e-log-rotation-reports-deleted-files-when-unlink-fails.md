# E2E log rotation reports deleted files when unlink fails

## Summary

The exported `@poe-code/e2e-test-runner` `rotateLogs()` helper counts every stale log selected for deletion as rotated even when `unlinkSync()` fails and the file remains on disk. Global setup can therefore print that old logs were removed while none of the failed deletions actually occurred.

## Reproduction

Create a disposable Vitest probe at `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  readdirSync: vi.fn(() => ["new.log", "old.log"]),
  statSync: vi.fn((file: string) => ({
    mtime: new Date(file.endsWith("new.log") ? 2_000 : 1_000),
  })),
  unlinkSync: vi.fn(() => {
    throw new Error("permission denied");
  }),
}));

vi.mock("node:fs", () => fsMock);

import { rotateLogs } from "./log-rotation.js";

describe("log rotation deletion accounting", () => {
  it("reports a rotated file even when deletion fails", () => {
    expect(rotateLogs("/logs", 1)).toBe(1);
    expect(fsMock.unlinkSync).toHaveBeenCalledWith("/logs/old.log");
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
rm packages/e2e-test-runner/src/__probe__.test.ts
```

Observed test output:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > log rotation deletion accounting > reports a rotated file even when deletion fails
```

## Observed Behavior

`rotateLogs("/logs", 1)` identifies `/logs/old.log` as stale, attempts to unlink it, catches and ignores the simulated permission failure, and still returns `1`. `packages/e2e-test-runner/src/log-rotation.ts` returns `toDelete.length` rather than tracking successful unlinks. `packages/e2e-test-runner/src/vitest.ts` interprets this return value as completed rotation and prints `Rotated 1 old log file(s).`.

## Expected Behavior

The rotation count should reflect files successfully deleted, or failed deletion should be surfaced so setup cannot state that retention cleanup succeeded when stale log files remain in place.

## Impact

Test operators can be told that sensitive or space-consuming E2E logs were rotated while deletion failures silently preserve them. This undermines log-retention guarantees, hides permission or filesystem problems, and can leave old captured request or runtime diagnostics available longer than intended.
