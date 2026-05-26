# Agent harness tools duplicate numbered plan IDs hide earlier live plan

## Summary

The exported `@poe-code/agent-harness-tools` `discoverPlans()` API permits multiple active Markdown plan files whose numbered filenames normalize to the same plan ID. Given `01-feature.md` and `02-feature.md`, it returns two identical entries for the later file and does not expose the still-present earlier file at all.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type { TaskListFs } from "@poe-code/task-list";
import { discoverPlans } from "./plans.js";

function plan(name: string): string {
  return `---\nkind: pipeline\nname: ${name}\nstate: draft\n---\n`;
}

describe("duplicate normalized plan filenames", () => {
  it("returns duplicate references to the later file and hides the earlier live plan", async () => {
    const volume = Volume.fromJSON({
      "/repo/.poe-code/plans/01-feature.md": plan("First"),
      "/repo/.poe-code/plans/02-feature.md": plan("Second")
    }, "/");
    volume.mkdirSync("/home/test", { recursive: true });
    const rawFs = createFsFromVolume(volume).promises;

    const plans = await discoverPlans({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: ".poe-code/plans",
      fs: rawFs as unknown as TaskListFs
    });

    expect(plans).toEqual([
      {
        id: "feature",
        name: "Second",
        kind: "pipeline",
        absolutePath: "/repo/.poe-code/plans/02-feature.md",
        displayPath: ".poe-code/plans/02-feature.md"
      },
      {
        id: "feature",
        name: "Second",
        kind: "pipeline",
        absolutePath: "/repo/.poe-code/plans/02-feature.md",
        displayPath: ".poe-code/plans/02-feature.md"
      }
    ]);
    await expect(rawFs.readFile("/repo/.poe-code/plans/01-feature.md", "utf8"))
      .resolves.toContain("name: First");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-harness-tools/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > duplicate normalized plan filenames > returns duplicate references to the later file and hides the earlier live plan
```

## Observed Behavior

Both active source files exist in memory, but `discoverPlans()` returns two identical `feature` results with `name: "Second"` and `absolutePath: "/repo/.poe-code/plans/02-feature.md"`; `01-feature.md` is not represented. In `packages/agent-harness-tools/src/plans.ts`, `idFromPlanFileName()` strips any leading numeric order prefix and `readPlanPaths()` stores paths in a `Map` by that derived ID, so the later matching filename replaces the earlier path. Separately, the markdown task backend in `packages/task-list/src/backends/markdown-dir.ts` reads both active entries but stores task content in another `Map` keyed by the same normalized ID; `all()` then maps each original entry through the one overwritten task value. The two overwrites combine into duplicate output for the later document.

## Expected Behavior

Plan discovery should not silently accept two active plan files with the same normalized identifier. It should either reject the collision with a useful diagnostic or preserve each source as a distinguishable discoverable item; it must not return duplicate references to one file while hiding another existing live plan.

## Impact

If plan numbering is edited manually, generated concurrently, or duplicated during merge/recovery, workflow selectors and user interfaces built on `discoverPlans()` can omit actionable work while displaying an apparent duplicate instead. A user may open, execute, archive, or reason about the wrong plan and be unable to locate the hidden live document through the public discovery API.
