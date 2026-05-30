---
name: "Agent eval runVitest infinite timeout expires immediately"
---

# Agent eval runVitest infinite timeout expires immediately

## Summary

The exported `@poe-code/agent-eval` `runVitest()` API accepts `timeoutMs: Infinity` and forwards it directly to Node's `setTimeout()`. Instead of allowing an unbounded evaluation run, Node clamps the unsupported timer value to `1ms`, emits `TimeoutOverflowWarning`, kills the still-running scorer process, and rejects almost immediately with `Vitest timed out after Infinityms`.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { tmpdir } from "node:os";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";

const mocks = vi.hoisted(() => ({ createHostRunner: vi.fn() }));

vi.mock("@poe-code/process-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/process-runner")>();
  return { ...actual, createHostRunner: mocks.createHostRunner };
});
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { runVitest, VitestTimeoutError } = await import("./run/vitest-runner.js");

describe("agent-eval infinite vitest timeout", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(tmpdir(), { recursive: true });
    mocks.createHostRunner.mockReturnValue(
      createMockRunner([{ exitCode: 0, exitAfterMs: 1000 }]),
    );
  });

  it("times out immediately when timeoutMs is Infinity", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`);
    process.on("warning", onWarning);
    const startedAt = Date.now();
    try {
      const outcome = await runVitest({
        testsDir: "/tests",
        cloneDir: "/clone",
        oracleDir: "/oracle",
        timeoutMs: Infinity,
      }).then(
        () => ({ resolved: true as const }),
        (error: Error) => ({
          name: error.name,
          message: error.message,
          elapsed: Date.now() - startedAt,
        }),
      );
      console.log(JSON.stringify({ outcome, warnings }));
      expect(outcome).toMatchObject({
        name: VitestTimeoutError.name,
        message: "Vitest timed out after Infinityms",
      });
      expect("elapsed" in outcome && outcome.elapsed).toBeLessThan(100);
    } finally {
      process.off("warning", onWarning);
    }
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

The probe prints:

```text
(node:90230) TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
{"outcome":{"name":"VitestTimeoutError","message":"Vitest timed out after Infinityms","elapsed":3},"warnings":["TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.\nTimeout duration was set to 1."]}
✓ packages/agent-eval/src/__probe__.test.ts > agent-eval infinite vitest timeout > times out immediately when timeoutMs is Infinity
```

## Observed Behavior

`packages/agent-eval/src/index.ts` exports `runVitest()`. In `packages/agent-eval/src/run/vitest-runner.ts`, `runVitestWithRunner()` forwards the supplied timeout into `waitForVitest()`, which schedules `setTimeout(..., timeoutMs)` without validating that the numeric value is finite and supported by Node timers. With `timeoutMs: Infinity`, a mock evaluation process configured to remain active for one second is instead killed and rejected after approximately `3ms`, while the diagnostic still describes the requested timeout as infinite.

## Expected Behavior

The public runner should reject unsupported non-finite timeout configuration explicitly, or implement an intentional unlimited-timeout mode without creating a timer. An infinite timeout request must not be converted into an immediate evaluation failure.

## Impact

Evaluation harnesses, CI wrappers, or SDK users that use `Infinity` to represent no deadline can unexpectedly abort every oracle test run almost immediately. This can produce false failing evaluations, discard useful work, emit misleading timeout diagnostics, and make otherwise valid scoring configurations unreliable.
