# Agent spawn autonomous negative timeout retry limit skips initial run

## Summary

The exported `@poe-code/agent-spawn` `spawnAutonomous()` API accepts a negative `maxTimeoutRetries` option and treats it as zero total attempts, skipping the requested agent execution entirely before throwing the internal sentinel error `Unreachable`. The public SDK `spawn.autonomous()` forwards the same option without validation.

## Reproduction

Create a disposable Vitest probe at `packages/agent-spawn/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { spawnAutonomous } from "./autonomous.js";

describe("spawnAutonomous invalid attempt limits", () => {
  it("does not start the requested agent when maxTimeoutRetries is negative", async () => {
    const streamSpawn = vi.fn(() => ({
      events: (async function* () {})(),
      result: Promise.resolve({ stdout: "done", stderr: "", exitCode: 0 }),
    }));

    await expect(
      spawnAutonomous(streamSpawn, {
        service: "codex",
        prompt: "Run once",
        maxTimeoutRetries: -1,
      }),
    ).rejects.toThrow("Unreachable");

    expect(streamSpawn).not.toHaveBeenCalled();
  });
});
```

Run the probe, then delete it:

```sh
npm exec -- vitest run packages/agent-spawn/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-spawn/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-spawn/src/__probe__.test.ts > spawnAutonomous invalid attempt limits > does not start the requested agent when maxTimeoutRetries is negative
```

## Observed Behavior

`spawnAutonomous()` declares `maxTimeoutRetries?: number` at `packages/agent-spawn/src/autonomous.ts:18` and uses the supplied value directly as the upper bound of its attempt loop at `packages/agent-spawn/src/autonomous.ts:49`. With `maxTimeoutRetries: -1`, the loop body never executes, so `streamSpawn()` is never called. The API then reaches the internal fallback `throw new Error("Unreachable")` at `packages/agent-spawn/src/autonomous.ts:69` instead of validating the option or attempting the requested spawn.

This behavior is reachable from the public SDK surface: `src/sdk/autonomous.ts:4` exposes the same `maxTimeoutRetries?: number` option and forwards it directly, while `src/sdk/spawn.ts:429` exposes it through `spawn.autonomous()`.

## Expected Behavior

An autonomous spawn request should always make its initial execution attempt unless rejected as invalid before execution with a clear option-validation error. A negative maximum retry setting should not silently convert a requested run into zero attempts or leak an internal unreachable-state exception.

## Impact

SDK consumers that pass a computed, decoded, or misconfigured retry limit can receive a failure without any agent being started, while the error message gives no indication that the input suppressed execution. Automation may report an agent failure, retry externally, or skip intended work even though no autonomous attempt actually occurred.
