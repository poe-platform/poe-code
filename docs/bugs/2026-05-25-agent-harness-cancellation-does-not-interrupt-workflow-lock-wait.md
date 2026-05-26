# Agent harness cancellation does not interrupt workflow lock wait

## Summary

`@poe-code/agent-harness-tools` accepts an `AbortSignal` for workflow execution, but it does not pass that signal into workflow lock acquisition. A run cancelled while it is waiting behind another workflow lock remains pending until that lock is released or its normal retry budget is exhausted.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'PROBE'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { acquireFileLock } from "@poe-code/file-lock";
import { runDocumentWorkflow } from "./runner.js";

describe("workflow lock cancellation", () => {
  it("stays blocked on the workflow lock after its signal is aborted", async () => {
    const volume = Volume.fromJSON({ "/repo/workflow.md": "# workflow" }, "/");
    const fs = createFsFromVolume(volume).promises as any;
    const releaseExistingLock = await acquireFileLock("/repo/workflow.md", { fs });
    const controller = new AbortController();

    const runPromise = runDocumentWorkflow({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/workflow.md",
      fs,
      signal: controller.signal,
      async readConfig() {
        controller.abort(new Error("cancelled"));
        return { frontmatter: { max_iterations: 0 }, body: "" };
      },
      async runAgent() {
        return { exitCode: 0 };
      }
    });

    const outcomeBeforeUnlock = await Promise.race([
      runPromise.then(() => "resolved", () => "rejected"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 75))
    ]);
    await releaseExistingLock();

    await expect(runPromise).rejects.toThrow("cancelled");
    console.log(JSON.stringify({ outcomeBeforeUnlock }));
    expect(outcomeBeforeUnlock).toBe("pending");
  });
});
PROBE
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

Output:

```text
{"outcomeBeforeUnlock":"pending"}
✓ packages/agent-harness-tools/src/__probe__.test.ts > workflow lock cancellation > stays blocked on the workflow lock after its signal is aborted
```

## Observed Behavior

`runDocumentWorkflow()` accepts `options.signal`, but its lock call at `packages/agent-harness-tools/src/runner.ts:309` through `packages/agent-harness-tools/src/runner.ts:311` supplies only the filesystem adapter. It does not call `throwIfAborted(options.signal)` until after lock acquisition at `packages/agent-harness-tools/src/runner.ts:316` through `packages/agent-harness-tools/src/runner.ts:317`. The underlying `acquireFileLock()` already supports abortable retries and abortable sleep through its `signal` option at `packages/file-lock/src/lock.ts:216` through `packages/file-lock/src/lock.ts:287`, but the harness never supplies that signal. In the reproduction, cancellation occurs before lock acquisition, yet the workflow promise remains pending while another process holds the lock and rejects only after the lock is released.

## Expected Behavior

`runDocumentWorkflow()` should forward its execution signal into `lockWorkflow()` so a cancelled workflow rejects promptly while blocked on lock acquisition rather than waiting for unrelated work to unlock the document.

## Impact

Cancellation and shutdown requests can hang behind another workflow execution even when no agent stage has started. This delays interactive cancellation, CI timeout handling, and orchestrator teardown, while retaining pending workflow work that callers reasonably expect to have stopped.
