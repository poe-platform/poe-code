# Agent harness reloaded empty iteration is reported as completed

## Summary

`@poe-code/agent-harness-tools` exposes `"nothing_to_run"` as an iteration result when a workflow contains no stages, but that result is only emitted for the initial workflow snapshot. If stages are removed before a later live-reloaded iteration, the runner executes no agent stage and reports that iteration as `"completed"`.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { runDocumentWorkflow, type IterationResult } from "./runner.js";

describe("reloaded empty workflow iteration result", () => {
  it("reports a reloaded no-stage iteration as completed", async () => {
    let reads = 0;
    const prompts: string[] = [];
    const results: Array<[number, IterationResult]> = [];

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
      async readConfig() {
        reads += 1;
        return {
          frontmatter: {
            participants: { default: { agent: "claude", mode: "edit" } },
            stages: reads === 1 ? [{ id: "work", participant: "default", prompt: "Run stage" }] : [],
            max_iterations: 2
          },
          body: ""
        };
      },
      runAgent: vi.fn(async (input) => {
        prompts.push(input.prompt);
        return { exitCode: 0 };
      }),
      onIterationEnd(iteration, result) {
        results.push([iteration, result]);
      }
    });

    console.log(JSON.stringify({ prompts, results }));
    expect(prompts).toEqual(["Run stage"]);
    expect(results).toEqual([[0, "completed"], [1, "completed"]]);
  });
});
PROBE
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

Output:

```text
{"prompts":["Run stage"],"results":[[0,"completed"],[1,"completed"]]}
✓ packages/agent-harness-tools/src/__probe__.test.ts > reloaded empty workflow iteration result > reports a reloaded no-stage iteration as completed
```

## Observed Behavior

`IterationResult` explicitly includes `"nothing_to_run"` at `packages/agent-harness-tools/src/runner.ts:38`, and `runDocumentWorkflow()` emits that value when its initial workflow has no runnable stages at `packages/agent-harness-tools/src/runner.ts:328` through `packages/agent-harness-tools/src/runner.ts:331`. For later iterations, however, the runner reloads `currentWorkflow` at `packages/agent-harness-tools/src/runner.ts:339`, initializes `iterationResult` to `"completed"` at `packages/agent-harness-tools/src/runner.ts:343`, and emits that default at `packages/agent-harness-tools/src/runner.ts:371` even when `currentWorkflow.stages` is empty and no stage executes. In the reproduction, only iteration `0` runs an agent, but both iterations are reported as completed work.

## Expected Behavior

When a live-reloaded iteration contains no runnable stages, the harness should emit `"nothing_to_run"` for that iteration, matching the already exposed result contract used for an initially empty workflow.

## Impact

Progress callbacks and orchestrators cannot distinguish actual completed agent work from an iteration suppressed by an updated workflow document. Metrics, UI progress, logs, and higher-level decisions can therefore record work as successfully executed when the current workflow ran nothing at all.
