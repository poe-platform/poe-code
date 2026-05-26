# Agent harness final stage abort resolves as completed workflow

## Summary

`@poe-code/agent-harness-tools` checks an `AbortSignal` before each stage, but does not re-check it after the final agent call finishes. If the last stage triggers cancellation while still resolving normally, the workflow resolves successfully and emits a `"completed"` iteration despite its supplied signal being aborted.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { runDocumentWorkflow, type IterationResult } from "./runner.js";

describe("final stage cancellation", () => {
  it("resolves a workflow successfully after the final stage aborts its signal", async () => {
    const controller = new AbortController();
    const results: Array<[number, IterationResult]> = [];

    await expect(runDocumentWorkflow({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/workflow.md",
      fs: {
        async readFile() { return "# workflow"; },
        async mkdir() {},
        async rmdir() {},
        async stat() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
        async open() { return { async writeFile() {}, async close() {} }; },
        async unlink() {}
      } as any,
      signal: controller.signal,
      async readConfig() {
        return {
          frontmatter: {
            participants: { default: { agent: "claude", mode: "edit" } },
            stages: [{ id: "work", participant: "default", prompt: "Run stage" }],
            max_iterations: 1
          },
          body: ""
        };
      },
      runAgent: vi.fn(async () => {
        controller.abort(new Error("cancelled"));
        return { exitCode: 0 };
      }),
      onIterationEnd(iteration, result) {
        results.push([iteration, result]);
      }
    })).resolves.toBeUndefined();

    console.log(JSON.stringify({ aborted: controller.signal.aborted, results }));
    expect(controller.signal.aborted).toBe(true);
    expect(results).toEqual([[0, "completed"]]);
  });
});
PROBE
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

Output:

```text
{"aborted":true,"results":[[0,"completed"]]}
✓ packages/agent-harness-tools/src/__probe__.test.ts > final stage cancellation > resolves a workflow successfully after the final stage aborts its signal
```

## Observed Behavior

`runDocumentWorkflow()` checks `options.signal` before execution begins at `packages/agent-harness-tools/src/runner.ts:317`, before each iteration at `packages/agent-harness-tools/src/runner.ts:337`, and before each stage at `packages/agent-harness-tools/src/runner.ts:346`. It then awaits `runWorkflowStage()` at `packages/agent-harness-tools/src/runner.ts:349` through `packages/agent-harness-tools/src/runner.ts:355`, emits the iteration result at `packages/agent-harness-tools/src/runner.ts:371`, and exits after the last iteration without another abort check. In the reproduction, the only stage aborts the supplied signal and returns `{ exitCode: 0 }`; the workflow nevertheless resolves normally and reports `[0, "completed"]`.

## Expected Behavior

If the supplied workflow signal becomes aborted while the final stage is running, `runDocumentWorkflow()` should observe that abort before reporting completion and reject with the cancellation reason rather than returning successful workflow completion.

## Impact

Callers can receive successful workflow completion for a run they cancelled during its final agent operation. Status reporting, orchestration, retries, and user-facing cancellation behavior can therefore claim completion while the controlling signal explicitly records that the work was cancelled.
