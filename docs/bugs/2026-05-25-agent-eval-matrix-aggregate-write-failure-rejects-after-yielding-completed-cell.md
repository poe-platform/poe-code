# `runMatrix()` yields completed cell results before aggregate publication can fail

## Summary

The exported `@poe-code/agent-eval` `runMatrix()` API yields each completed run result before writing the aggregate artifact for that matrix cell. If the aggregate write fails after the final repeat, consumers have already observed successful completed results but the async iterator then rejects and no cell aggregate is published.

## Reproduction

From the repository root, add a disposable probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { EvalRunOptions, EvalRunResult } from "../types.js";

const mocked = vi.hoisted(() => ({
  runEval: vi.fn<[EvalRunOptions], Promise<EvalRunResult>>(),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (targetPath: string) => {
    if (targetPath.includes("aggregate-")) {
      throw new Error("aggregate publication failed");
    }
  })
}));

vi.mock("./run.js", () => ({ runEval: mocked.runEval }));
vi.mock("node:fs/promises", () => ({ mkdir: mocked.mkdir, writeFile: mocked.writeFile }));
vi.mock("../source/open.js", () => ({ openSource: vi.fn(async () => ({ rootDir: "/source" })) }));
vi.mock("../source/registry.js", () => ({
  listEvals: vi.fn(async () => ["task"]),
  loadEval: vi.fn(async () => ({ plan: { kind: "plan" }, weights: { tests: 1, judge: 0 } }))
}));

const { runMatrix } = await import("./matrix.js");

describe("agent eval aggregate publication failure repro", () => {
  it("yields completed runs before rejecting on aggregate publication", async () => {
    mocked.runEval.mockResolvedValue({
      runId: "completed-run",
      eval: "task",
      agent: "codex",
      model: "model-one",
      planKind: "plan",
      verdict: "pass",
      correctness: 1,
      iterations: 1,
      durationMs: 10,
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0 },
      tests: { passed: 1, total: 1, pass_rate: 1, cases: [] },
      scoring: {
        tests: { configured: true, required: true, configuredWeight: 1, effectiveWeight: 1, status: "scored" },
        judge: { configured: false, required: false, configuredWeight: 0, effectiveWeight: 0, status: "disabled", reason: "disabled" }
      },
      cheated: false,
      cheatReport: { cheated: false, violations: [] },
      trace: { available: false }
    });

    const iterator = runMatrix({
      sourceDir: "/source",
      evalIds: ["task"],
      agents: ["codex"],
      models: ["model-one"],
      repeats: 1,
      outDir: "/runs",
      verifyOracle: false,
      judge: "off"
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { runId: "completed-run" }, done: false });
    await expect(iterator.next()).rejects.toThrow("aggregate publication failed");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-eval/src/run/__probe__.test.ts > agent eval aggregate publication failure repro > yields completed runs before rejecting on aggregate publication
```

Remove the disposable probe after validation.

## Observed Behavior

For a single completed matrix cell, the first `iterator.next()` returns the successful run result with `runId: "completed-run"`. The next `iterator.next()` rejects with `aggregate publication failed`, because `runMatrix()` performs `yield result` for every repeat before it calls `writeAggregate()` for the completed cell.

## Expected Behavior

Cell completion should not be reported to streaming consumers until required cell publication succeeds, or aggregate publication failures should be represented explicitly without retroactively rejecting a stream that has already emitted apparently successful results.

## Impact

CLI and SDK consumers can display, accumulate, or act on successful completed evaluation results and only afterward receive a matrix-level rejection with no aggregate artifact for that cell. This creates inconsistent observable state between streamed results and durable reports, complicates retries, and can cause automation to treat unpublished evaluation data as accepted results.
