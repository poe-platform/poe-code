# E2E log rotation NaN retention limit deletes all logs

## Summary

The exported `@poe-code/e2e-test-runner` `rotateLogs()` helper accepts `NaN` as its `maxLogs` retention limit. Instead of rejecting the malformed limit, it treats every existing `.log` file as outside retention and deletes the entire available log history.

## Reproduction

Create a disposable Vitest probe at `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  readdirSync: vi.fn(() => ["a.log", "b.log"]),
  statSync: vi.fn((file: string) => ({
    mtime: new Date(file.endsWith("a.log") ? 2_000 : 1_000),
  })),
  unlinkSync: vi.fn(),
}));

vi.mock("node:fs", () => fsMock);

import { rotateLogs } from "./log-rotation.js";

describe("non-finite retention limit", () => {
  it("deletes every log when maxLogs is NaN", () => {
    expect(rotateLogs("/logs", Number.NaN)).toBe(2);
    expect(fsMock.unlinkSync.mock.calls).toEqual([
      ["/logs/a.log"],
      ["/logs/b.log"],
    ]);
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
✓ packages/e2e-test-runner/src/__probe__.test.ts > non-finite retention limit > deletes every log when maxLogs is NaN
```

## Observed Behavior

Calling `rotateLogs("/logs", Number.NaN)` deletes both mock log files and returns `2`. At `packages/e2e-test-runner/src/log-rotation.ts`, the guard `files.length <= maxLogs` is false for `NaN`, and `files.slice(maxLogs)` coerces `NaN` to slice index `0`, selecting every log for unlinking. The exported `createGlobalSetup()` surface passes through its optional `maxLogs` value unchanged.

## Expected Behavior

The rotation API should reject non-finite or otherwise invalid retention limits before deleting anything, or constrain them to a safe defined policy. A malformed limit must not silently convert normal retention into deletion of all available logs.

## Impact

Configuration values produced by arithmetic, deserialization, or environment parsing can erase all E2E diagnostic logs at setup time. These logs may be needed to diagnose failing tests, proxy traffic, sandbox behavior, or credential exposure; the data loss occurs silently under an apparently valid public API call.
