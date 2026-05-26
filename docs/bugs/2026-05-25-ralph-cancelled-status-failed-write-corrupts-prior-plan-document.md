# Ralph Cancelled Status Failed Write Corrupts Prior Plan Document

## Summary

The exported `@poe-code/ralph` `runRalph()` workflow rewrites the active Ralph Markdown plan to persist execution status. If an already-cancelled run partially overwrites the document before its status write rejects, the run fails and destroys the previously valid plan contents without executing an agent.

## Reproduction

Create a disposable Vitest probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runRalph } from "./run/ralph.js";
import type { RalphFileSystem } from "./types.js";

describe("ralph interrupted status persistence", () => {
  it("destroys the prior plan when cancelled-run status write rejects", async () => {
    const docPath = "/repo/docs/plans/plan.md";
    const original = [
      "---",
      "kind: ralph",
      "version: 1",
      "agent: codex",
      "iterations: 1",
      "status:",
      "  state: open",
      "  iteration: 0",
      "---",
      "# Preserve this Ralph plan",
      ""
    ].join("\n");
    const base = createFsFromVolume(Volume.fromJSON({ [docPath]: original })).promises;
    const fs = {
      ...base,
      async writeFile(filePath: string, content: string) {
        if (filePath === docPath) {
          await base.writeFile(filePath, "---\nstatus:", "utf8");
          throw new Error("ralph disk full");
        }
        await base.writeFile(filePath, content, "utf8");
      }
    } as unknown as RalphFileSystem;
    const controller = new AbortController();
    controller.abort();

    await expect(runRalph({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      signal: controller.signal,
      runAgent: async () => ({ stdout: "", stderr: "", exitCode: 0 })
    })).rejects.toThrow("ralph disk full");

    const raw = await base.readFile(docPath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("---\nstatus:");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"---\nstatus:"}
✓ packages/ralph/src/__probe__.test.ts > ralph interrupted status persistence > destroys the prior plan when cancelled-run status write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

When `options.signal.aborted` is already true, `runRalph()` persists an `open` cancellation status before returning at `packages/ralph/src/run/ralph.ts:58` through `packages/ralph/src/run/ralph.ts:60`. The status helper reads the current document and directly overwrites the same plan through `fs.writeFile()` at `packages/ralph/src/run/ralph.ts:457` through `packages/ralph/src/run/ralph.ts:480`. In the probe, no agent is invoked; the cancellation-status write rejects with `"ralph disk full"` after replacing the valid plan with truncated frontmatter `"---\nstatus:"`.

## Expected Behavior

Persisting Ralph runtime status should preserve the last valid plan document when the replacement cannot complete. In particular, an already-cancelled run that performs no work should not corrupt its input document while attempting to record cancellation state.

## Impact

A cancellation or shutdown path can destroy a Ralph plan and its authored instructions during a transient filesystem failure, even though no agent action has run. Users attempting to safely stop or avoid execution may instead lose the plan source needed for later resume, review, or recovery.
