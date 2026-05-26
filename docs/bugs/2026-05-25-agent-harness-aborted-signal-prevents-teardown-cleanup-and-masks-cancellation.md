# Agent harness aborted signal prevents teardown cleanup and masks cancellation

## Summary

`@poe-code/agent-harness-tools` runs teardown hooks after a workflow is cancelled, but forwards the same already-aborted signal into teardown. With a cancellation-aware agent executor, the teardown hook rejects immediately instead of performing cleanup, and the original cancellation error is replaced by an aggregate execution-and-teardown failure.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { runDocumentWorkflow } from "./runner.js";

describe("workflow cancellation teardown", () => {
  it("passes an aborted signal into teardown and masks cancellation as dual failure", async () => {
    const controller = new AbortController();
    const prompts: string[] = [];
    let caught: unknown;

    try {
      await runDocumentWorkflow({
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
              stages: [{ id: "work", participant: "default", prompt: "Abort work" }],
              teardown: { prompt: "Restore workspace" },
              max_iterations: 1
            },
            body: ""
          };
        },
        runAgent: vi.fn(async (input) => {
          if (input.signal?.aborted) {
            throw input.signal.reason;
          }
          prompts.push(input.prompt);
          controller.abort(new Error("cancelled"));
          throw new Error("cancelled");
        })
      });
    } catch (error) {
      caught = error;
    }

    console.log(JSON.stringify({ prompts, message: (caught as Error).message }));
    expect(prompts).toEqual(["Abort work"]);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as Error).message).toBe("Workflow execution and teardown both failed.");
  });
});
PROBE
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

Output:

```text
{"prompts":["Abort work"],"message":"Workflow execution and teardown both failed."}
✓ packages/agent-harness-tools/src/__probe__.test.ts > workflow cancellation teardown > passes an aborted signal into teardown and masks cancellation as dual failure
```

## Observed Behavior

`runDocumentWorkflow()` forwards `options.signal` to stages at `packages/agent-harness-tools/src/runner.ts:349` through `packages/agent-harness-tools/src/runner.ts:355`, catches the cancelled execution at `packages/agent-harness-tools/src/runner.ts:377` through `packages/agent-harness-tools/src/runner.ts:378`, and then unconditionally forwards that same signal to teardown at `packages/agent-harness-tools/src/runner.ts:381` through `packages/agent-harness-tools/src/runner.ts:387`. When the executor honors an already-aborted signal, the teardown prompt never runs; its immediate cancellation failure is merged with the original failure through `mergeErrors()` at `packages/agent-harness-tools/src/runner.ts:293` through `packages/agent-harness-tools/src/runner.ts:299` and `packages/agent-harness-tools/src/runner.ts:389` through `packages/agent-harness-tools/src/runner.ts:390`. The reproduction records only `"Abort work"` and surfaces `"Workflow execution and teardown both failed."` instead of performing `"Restore workspace"` cleanup.

## Expected Behavior

Teardown intended to clean up after cancellation should be allowed to execute independently of the already-triggered work cancellation signal, or use a separate bounded cleanup signal. Cancelling the main run should not automatically cancel the cleanup hook before it starts or replace the original cancellation error with a synthetic teardown failure.

## Impact

Workflow cancellation can skip configured cleanup operations such as restoring working state, persisting diagnostics, releasing external resources, or reporting final status. Callers also receive an aggregate failure that misleadingly implies the cleanup hook itself failed during execution, when the runner prevented it from starting by passing an already-aborted signal.
