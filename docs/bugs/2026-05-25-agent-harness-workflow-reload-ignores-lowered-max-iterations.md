# Agent harness workflow reload ignores lowered max iterations

## Summary

`@poe-code/agent-harness-tools` re-reads a workflow document before later iterations so updated stages and participants take effect, but it continues to bound execution using only the initial `max_iterations` value. If the workflow document is updated during execution to lower its iteration limit to the number already completed, the harness still runs additional iterations that the current document no longer permits.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { runDocumentWorkflow } from "./runner.js";

describe("live workflow max_iterations reload", () => {
  it("continues running after the document lowers max_iterations to the completed count", async () => {
    let reads = 0;
    const prompts: string[] = [];
    const workflow = (maxIterations: number) => ({
      participants: { default: { agent: "claude", mode: "edit" } },
      stages: [{ id: "work", participant: "default", prompt: "Run stage" }],
      max_iterations: maxIterations
    });

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
      },
      async readConfig() {
        reads += 1;
        return { frontmatter: reads === 1 ? workflow(3) : workflow(1) };
      },
      runAgent: vi.fn(async (input) => {
        prompts.push(input.prompt);
        return { exitCode: 0 };
      })
    });

    console.log(JSON.stringify({ reads, prompts }));
    expect(prompts).toEqual(["Run stage", "Run stage", "Run stage"]);
    expect(reads).toBe(3);
  });
});
PROBE
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

Output:

```text
{"reads":3,"prompts":["Run stage","Run stage","Run stage"]}
✓ packages/agent-harness-tools/src/__probe__.test.ts > live workflow max_iterations reload > continues running after the document lowers max_iterations to the completed count
```

## Observed Behavior

`runDocumentWorkflow()` reads the initial document at `packages/agent-harness-tools/src/runner.ts:308`, then loops using `initialWorkflow.maxIterations` at `packages/agent-harness-tools/src/runner.ts:336`. Inside that loop it explicitly re-reads the document for every later iteration at `packages/agent-harness-tools/src/runner.ts:339` and executes the freshly loaded stages and participants. In the reproduction, the initial document allows three runs, but the reloaded document lowers `max_iterations` to `1` after the first completed stage. Despite reading the new document twice, the harness invokes the stage three times because the limit is never reconsidered.

## Expected Behavior

If workflow configuration is live-reloaded between iterations, control settings that govern whether another iteration may run should be applied from the reloaded document as well. Once `max_iterations` is lowered to the completed iteration count, no further stage should execute.

## Impact

A workflow updated to stop or cap ongoing automated work can continue executing agents after the operator's new limit is visible in the document and already being used for other runtime fields. This can consume unnecessary model/tool resources and allow unintended edits or side effects during iterations that should have been suppressed.
