# Process runner mock runner infinite exit delay completes immediately

## Summary

The publicly exported `@poe-code/process-runner` mock runner accepts `exitAfterMs: Infinity` as a `MockRunBehavior` timing value and passes it directly to Node's timer API. Instead of leaving the simulated run pending indefinitely, Node clamps the timeout to approximately one millisecond, emits a `TimeoutOverflowWarning`, and the mocked command resolves as completed almost immediately.

## Reproduction

Create a disposable Vitest probe at `packages/process-runner/src/testing/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockRunner } from "./mock-runner.js";

describe("mock runner infinite completion delay", () => {
  it("resolves almost immediately instead of staying pending", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`);
    process.on("warning", onWarning);
    try {
      const runner = createMockRunner([{ exitCode: 0, exitAfterMs: Number.POSITIVE_INFINITY }]);
      const handle = runner.exec({ command: "slow" });
      let settled = false;
      void handle.result.then(() => { settled = true; });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(settled).toBe(true);
      expect(warnings.join("\n")).toContain("TimeoutOverflowWarning");
    } finally {
      process.off("warning", onWarning);
    }
  });
});
```

Run the probe and remove it after confirmation:

```sh
npm exec -- vitest run packages/process-runner/src/testing/__probe__.test.ts --reporter verbose
rm -f packages/process-runner/src/testing/__probe__.test.ts
```

The probe passes after Node reports the overflow and resolves the supposedly indefinitely delayed run:

```text
(node:36998) TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
✓ packages/process-runner/src/testing/__probe__.test.ts > mock runner infinite completion delay > resolves almost immediately instead of staying pending
```

## Observed Behavior

`MockRunBehavior.exitAfterMs` is exposed as an unrestricted optional `number` in `packages/process-runner/src/types.ts:178`. The public `createMockRunner()` implementation reads that value in `packages/process-runner/src/testing/mock-runner.ts:73` and, whenever it is greater than zero, schedules completion through `setTimeout(complete, exitAfterMs)` at `packages/process-runner/src/testing/mock-runner.ts:75`. `Infinity > 0` is true, so Node receives an unsupported timer duration and coerces the intended indefinitely-pending behavior into an immediate successful completion.

## Expected Behavior

The mock-runner timing API should reject non-finite completion delays, or explicitly support an unlimited/pending simulation without scheduling an overflowing timer. Passing an infinite delay must not transform a long-running mocked process into one that exits successfully almost immediately.

## Impact

Tests using the exported mock runner to model daemons, blocked commands, timeout handling, cancellation, or startup supervision can silently exercise the wrong lifecycle. A test intended to represent a command that never completes instead observes rapid success, masking hangs or cancellation defects and making higher-level runtime verification unreliable.
