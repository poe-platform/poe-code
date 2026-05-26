# Agent-eval Vitest report cleanup failure rejects successful score

## Summary

The exported `@poe-code/agent-eval` `runVitest()` API evaluates the JSON reporter output and computes its test results before deleting the temporary reporter file in a `finally` block. If deletion of that temporary file fails, `runVitest()` rejects instead of returning the already computed successful test result.

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
      result: Promise.resolve({ exitCode: 0 }),
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
  unlink: vi.fn(async () => {
    throw new Error("report cleanup denied");
  })
}));

vi.mock("@poe-code/process-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/process-runner")>()),
  createHostRunner: mocked.createHostRunner
}));
vi.mock("node:fs/promises", () => ({ readFile: mocked.readFile, unlink: mocked.unlink }));

const { runVitest } = await import("./vitest-runner.js");

describe("agent eval Vitest output cleanup repro", () => {
  it("rejects a successful test result when temporary report deletion fails", async () => {
    await expect(
      runVitest({
        testsDir: "/work/tests",
        cloneDir: "/work/clone",
        oracleDir: "/work/oracle",
        timeoutMs: 1_000
      })
    ).rejects.toThrow("report cleanup denied");

    expect(mocked.readFile).toHaveBeenCalledOnce();
    expect(mocked.unlink).toHaveBeenCalledOnce();
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-eval/src/run/__probe__.test.ts > agent eval Vitest output cleanup repro > rejects a successful test result when temporary report deletion fails
```

Remove the disposable probe after validation.

## Observed Behavior

The mocked runner completes successfully and the temporary report reader returns a valid JSON result with one passing assertion. Although the test result has been parsed successfully, `runVitest()` rejects with `report cleanup denied` because the final `unlink(outputFile)` fails.

## Expected Behavior

Failure to remove an auxiliary temporary reporter artifact should not convert a successfully computed scoring result into a test execution failure. Cleanup failure should be best-effort or surfaced separately from the already determined evaluation result.

## Impact

Temporary directory permissions, antivirus scanning, or filesystem cleanup failures can turn passing evaluator tests into framework errors. Matrix results and automation can incorrectly report an implementation as failing even though its tests passed, reducing reliability of evaluation outcomes and obscuring the true cleanup-only problem.
