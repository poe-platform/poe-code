---
name: "Agent eval runVitest accepts overflowing JSON case duration"
---

# Agent eval runVitest accepts overflowing JSON case duration

## Summary

The exported `@poe-code/agent-eval` `runVitest()` API maps every numeric Vitest assertion duration into typed `CaseResult.durationMs` output without requiring it to be finite. A syntactically valid JSON report containing an assertion duration of `1e309` is parsed as `Infinity` and returned to callers as a successful test-case duration.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { tmpdir } from "node:os";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { Runner, RunSpec } from "@poe-code/process-runner";

const mocks = vi.hoisted(() => ({ createHostRunner: vi.fn() }));
vi.mock("@poe-code/process-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/process-runner")>()),
  createHostRunner: mocks.createHostRunner,
}));
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const { runVitest } = await import("./run/vitest-runner.js");

function runner(): Runner {
  const mock = createMockRunner([{ exitCode: 0 }]);
  return {
    name: mock.name,
    exec(spec: RunSpec) {
      const index = spec.args?.indexOf("--outputFile") ?? -1;
      vol.writeFileSync(
        spec.args![index + 1]!,
        '{"testResults":[{"name":"/tests/foo.test.ts","assertionResults":[{"title":"runs","state":"pass","duration":1e309}]}]}',
      );
      return mock.exec(spec);
    },
  };
}

describe("agent-eval overflowing duration", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(tmpdir(), { recursive: true });
    mocks.createHostRunner.mockReturnValue(runner());
  });

  it("returns an infinite JSON assertion duration as typed case data", async () => {
    const result = await runVitest({
      testsDir: "/tests",
      cloneDir: "/clone",
      oracleDir: "/oracle",
      timeoutMs: 1000,
    });
    console.log(JSON.stringify({
      duration: String(result.cases[0]?.durationMs),
      finite: Number.isFinite(result.cases[0]?.durationMs),
    }));
    expect(result.cases[0]?.durationMs).toBe(Infinity);
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
{"duration":"Infinity","finite":false}
✓ packages/agent-eval/src/__probe__.test.ts > agent-eval overflowing duration > returns an infinite JSON assertion duration as typed case data
```

## Observed Behavior

`packages/agent-eval/src/index.ts` exports `runVitest()`. The result parser in `packages/agent-eval/src/run/vitest-runner.ts` reads the generated JSON report and maps each assertion with `durationMs: typeof assertion.duration === "number" ? assertion.duration : 0`. JSON numbers with extremely large exponent notation are valid input and are converted by JavaScript parsing to `Infinity`; no finite-value check is applied before the `CaseResult` is returned. The reproduction therefore resolves a passing case whose `durationMs` is infinite.

## Expected Behavior

The runner should accept only finite, non-negative case durations from Vitest output, normalizing or rejecting malformed overflowed timing values rather than returning them as trustworthy test-result metadata.

## Impact

Malformed, corrupted, or unexpectedly large test-report data can contaminate evaluation results with impossible timing measurements. Consumers that total durations, format reports, persist result JSON, compare performance, or use case timings for budgets may serialize `Infinity` as `null`, render misleading values, or produce invalid aggregate decisions while the run otherwise appears successful.
