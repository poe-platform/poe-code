---
name: "Agent-eval Vitest nonzero process exit can return passing score"
---

# Agent-eval Vitest nonzero process exit can return passing score

## Summary

The exported `@poe-code/agent-eval` `runVitest()` API waits for the Vitest subprocess to finish, but does not inspect its exit code before reading and accepting the JSON reporter artifact. If the process exits nonzero while leaving a parseable artifact containing passing assertions, the scorer resolves with a passing result rather than reporting test-run failure.

## Reproduction

From the repository root, add a disposable probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createHostRunner: vi.fn(() => ({
    name: "mock",
    exec: () => ({
      pid: null,
      stdout: null,
      stderr: null,
      stdin: null,
      result: Promise.resolve({ exitCode: 1 }),
      kill: vi.fn()
    })
  })),
  readFile: vi.fn(async () =>
    JSON.stringify({
      testResults: [
        {
          name: "/work/tests/foo.test.ts",
          assertionResults: [{ title: "passes", status: "passed", duration: 1 }]
        }
      ]
    })
  ),
  unlink: vi.fn(async () => undefined)
}));

vi.mock("@poe-code/process-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/process-runner")>()),
  createHostRunner: mocked.createHostRunner
}));
vi.mock("node:fs/promises", () => ({ readFile: mocked.readFile, unlink: mocked.unlink }));

const { runVitest } = await import("./vitest-runner.js");

describe("agent eval Vitest process failure repro", () => {
  it("returns a passing score after the Vitest process exits nonzero", async () => {
    await expect(
      runVitest({
        testsDir: "/work/tests",
        cloneDir: "/work/clone",
        oracleDir: "/work/oracle",
        timeoutMs: 1_000
      })
    ).resolves.toEqual({
      passed: 1,
      total: 1,
      cases: [{ name: "foo.test.ts > passes", passed: true, durationMs: 1 }]
    });
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-eval/src/run/__probe__.test.ts > agent eval Vitest process failure repro > returns a passing score after the Vitest process exits nonzero
```

Remove the disposable probe after validation.

## Observed Behavior

The mocked Vitest process resolves with `exitCode: 1`, while its report file contains one passing assertion. `runVitest()` resolves with `{ passed: 1, total: 1 }` instead of rejecting or reporting a failed framework/test execution, because its completion path ignores the subprocess exit status and trusts only the JSON report contents.

## Expected Behavior

A nonzero Vitest subprocess exit should not produce a successful scorer result solely because a parseable report artifact exists. The runner should validate process completion status and surface unexpected execution failure alongside any available report details.

## Impact

Vitest may exit nonzero for configuration errors, setup failures, reporter problems, unhandled errors, or incomplete execution while still leaving stale or partial JSON output. Accepting that artifact as a passing score can incorrectly award correctness to a broken evaluated run and corrupt downstream aggregates or comparisons.
