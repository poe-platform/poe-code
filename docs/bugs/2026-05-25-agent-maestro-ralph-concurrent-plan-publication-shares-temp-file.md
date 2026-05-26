# Agent Maestro Ralph concurrent plan publication shares one temporary file

## Summary

The Agent Maestro Ralph driver publishes updated plan content through a temporary pathname derived only from the destination basename and `process.pid`. Two successful Ralph runs in the same process that publish the same plan concurrently therefore share one temporary file. If one run pauses before its rename while another finishes publication, the paused run later fails because its temporary file has already been renamed away.

## Reproduction

1. Add this disposable probe as `packages/agent-maestro/src/drivers/__probe__.test.ts`:

```ts
import * as fs from "node:fs/promises";
import type { RalphRunOptions, RalphRunResult } from "@poe-code/ralph";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConfig, createDriverContext, createTask } from "../__test_utils__/fixtures.js";
import { createRalphDriver } from "./ralph.js";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFs } = await import("memfs");
  return { ...memoryFs.promises, default: memoryFs.promises };
});

describe("Ralph concurrent plan publication probe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vol.reset();
  });

  it("reports one completed run as failed when another run shares its temp plan path", async () => {
    const planPath = "/repo/docs/plans/shared.md";
    vol.fromJSON({ [planPath]: "original" });

    let firstRenameReached!: () => void;
    let releaseFirstRename!: () => void;
    const firstRenameIsWaiting = new Promise<void>((resolve) => {
      firstRenameReached = resolve;
    });
    const firstRenameMayContinue = new Promise<void>((resolve) => {
      releaseFirstRename = resolve;
    });
    const rename = fs.rename.bind(fs);
    let renameCount = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      renameCount += 1;
      if (renameCount === 1) {
        firstRenameReached();
        await firstRenameMayContinue;
      }
      await rename(source, destination);
    });

    const createDriver = (content: string) =>
      createRalphDriver({
        runRalph: async (options: RalphRunOptions) => {
          await fs.writeFile(options.docPath, content, "utf8");
          return {
            stopReason: "completed",
            docPath: options.docPath,
            iterationsCompleted: 1,
            totalDurationMs: 1
          } as RalphRunResult;
        }
      });
    const context = (workspaceDir: string) =>
      createDriverContext({
        task: createTask({ name: "Shared", state: "in-progress", description: "Shared" }),
        workspaceDir,
        planPath,
        cfg: createConfig({ workspace: { root: "/repo/workspaces" } })
      });

    const firstRun = createDriver("first completed").run(context("/repo/workspaces/first"));
    await firstRenameIsWaiting;
    await expect(
      createDriver("second completed").run(context("/repo/workspaces/second"))
    ).resolves.toEqual({ reason: "normal" });
    releaseFirstRename();

    await expect(firstRun).resolves.toMatchObject({
      reason: "abnormal",
      failure: "step_failed"
    });
    await expect(fs.readFile(planPath, "utf8")).resolves.toBe("second completed");
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/agent-maestro/src/drivers/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/agent-maestro/src/drivers/__probe__.test.ts > Ralph concurrent plan publication probe > reports one completed run as failed when another run shares its temp plan path
```

## Observed Behavior

Both Ralph runners complete normally and produce separate workspace documents, but `persistPlan()` maps both publications to `/.shared.md.<pid>.tmp`. The first run writes that file and pauses before renaming it. The second run overwrites and renames the same temporary file successfully. When the first run resumes, its rename fails because the shared temporary file no longer exists, and the driver reports `step_failed` even though Ralph completed successfully.

## Expected Behavior

Each plan publication attempt should use an exclusive temporary path or serialize updates to the same plan so one successful Ralph run cannot consume another run's publication staging file. Concurrent successful runs should not fail solely because they share a process ID and destination pathname.

## Impact

If the scheduler or API permits overlapping attempts for the same Ralph-backed plan, successful work can be reported as a failed step based only on publication timing. This can trigger retries, misleading failure events, or incorrect task state despite a valid completed plan having been published by the competing run.
