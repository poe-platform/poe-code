# Ralph aborted run with plain executor error is reported as fatal

## Summary

`@poe-code/ralph` classifies cancellation only when its agent executor throws an error named `"AbortError"`. If the workflow signal has already become aborted but the executor rejects with an ordinary transport/process error produced during cancellation, `runRalph()` rejects that error as fatal instead of returning a cancelled run result.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/ralph/src/__probe__.test.ts <<'PROBE'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter/frontmatter.js";
import { runRalph } from "./run/ralph.js";

describe("Ralph cancellation classification", () => {
  it("throws a plain executor error after the workflow signal is cancelled", async () => {
    const docPath = "/repo/.poe-code/ralph/plans/work.md";
    const content = "---\nagent: claude-code\niterations: 2\nstatus:\n  state: open\n  iteration: 0\n---\nWork";
    const volume = Volume.fromJSON({ [docPath]: content }, "/");
    const fs = createFsFromVolume(volume).promises as any;
    const controller = new AbortController();

    await expect(runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath,
      fs,
      signal: controller.signal,
      async runAgent() {
        controller.abort(new Error("cancelled"));
        throw new Error("transport closed after cancel");
      }
    })).rejects.toThrow("transport closed after cancel");

    const { data } = parseFrontmatter(await fs.readFile(docPath, "utf8"));
    console.log(JSON.stringify({ aborted: controller.signal.aborted, status: data.status }));
    expect(controller.signal.aborted).toBe(true);
    expect(data.status).toEqual({ state: "open", iteration: 0 });
  });
});
PROBE
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm packages/ralph/src/__probe__.test.ts
```

Output:

```text
{"aborted":true,"status":{"state":"open","iteration":0}}
✓ packages/ralph/src/__probe__.test.ts > Ralph cancellation classification > throws a plain executor error after the workflow signal is cancelled
```

## Observed Behavior

Inside its agent wrapper, `runRalph()` maps only errors satisfying `isAbortError(error)` to `RalphWorkflowStopError("cancelled")` at `packages/ralph/src/run/ralph.ts:116` through `packages/ralph/src/run/ralph.ts:129`. `isAbortError()` checks only `error.name === "AbortError"` at `packages/ralph/src/run/ralph.ts:441` through `packages/ralph/src/run/ralph.ts:443`; it does not consult `options.signal.aborted`. When the provided executor aborts that signal and then rejects with `Error("transport closed after cancel")`, Ralph sets `fatalError` and ultimately rethrows the ordinary error at `packages/ralph/src/run/ralph.ts:191` through `packages/ralph/src/run/ralph.ts:207`, even though the controlling signal is already cancelled.

## Expected Behavior

Once the supplied workflow signal is aborted during agent execution, Ralph should classify termination as cancellation even if the underlying executor surfaces a transport- or process-specific error while shutting down, unless it can prove that the failure is unrelated to the cancellation request.

## Impact

Interactive cancellations and orchestrator shutdowns can be reported as fatal Ralph failures depending on backend-specific error shape. Callers that rely on `stopReason: "cancelled"` may display spurious failures, trigger retries or alerts, and lose a reliable distinction between user cancellation and genuine run failure.
