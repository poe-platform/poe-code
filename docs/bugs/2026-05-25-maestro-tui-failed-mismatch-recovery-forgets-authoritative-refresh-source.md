# Maestro TUI failed mismatch recovery forgets authoritative refresh source

## Summary

When a Maestro reorder detects an `OrderMismatchError`, the TUI marks its next refresh to load authoritative tasks directly from `taskList.allTasks()`. However, `refresh()` clears that recovery flag before the authoritative load succeeds. If the recovery fetch rejects once, the next refresh silently falls back to the ordinary `onRefresh()` source instead of retrying authoritative reconciliation, allowing stale task rows to remain displayed after the backend explicitly reported that the UI's task set was outdated.

## Reproduction

Create a disposable Vitest probe that triggers an order mismatch, makes the first authoritative reload fail transiently, and configures `onRefresh()` to continue returning the stale row set:

```sh
cat > packages/maestro-tui/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { OrderMismatchError, type Task, type TaskList, type Tasks } from "@poe-code/task-list";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

function task(id: string): Task {
  return {
    list: "work",
    id,
    qualifiedId: `work/${id}`,
    name: id,
    state: "planned",
    description: "",
    metadata: {}
  };
}

describe("maestro mismatch refresh recovery", () => {
  it("falls back to stale onRefresh data after one authoritative reload failure", async () => {
    const allTasks = vi.fn()
      .mockRejectedValueOnce(new Error("task backend temporarily offline"))
      .mockResolvedValueOnce([task("authoritative")]);
    const taskList = {
      list: vi.fn(() => ({
        name: "work",
        reorder: vi.fn(async () => {
          throw new OrderMismatchError({ missing: ["authoritative"], extra: ["stale"] });
        })
      } as unknown as Tasks)),
      allTasks
    } as unknown as TaskList;
    const onRefresh = vi.fn(async () => [task("stale")]);
    const config = buildMaestroExplorerConfig({
      tasks: [task("stale"), task("other")],
      taskList,
      variables: {},
      onRefresh
    });
    const ctx = {
      refresh: vi.fn(async () => config.refresh!()),
      toast: vi.fn()
    };

    await expect(config.reorder!.onReorder(["work/other", "work/stale"], ctx)).rejects.toThrow(
      "task backend temporarily offline"
    );
    await config.refresh!();

    expect(allTasks).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    await expect(config.rows()).resolves.toEqual([
      expect.objectContaining({ id: "work/stale" })
    ]);
  });
});
EOF
trap 'rm -f packages/maestro-tui/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
nl -ba packages/maestro-tui/src/explorer-config.ts | sed -n '43,56p;98,106p'
```

The probe passes:

```text
✓ packages/maestro-tui/src/__probe__.test.ts > maestro mismatch refresh recovery > falls back to stale onRefresh data after one authoritative reload failure
```

## Observed Behavior

The reorder mismatch branch sets `refreshFromTaskList = true` and immediately awaits `ctx.refresh()` at `packages/maestro-tui/src/explorer-config.ts:98` through `packages/maestro-tui/src/explorer-config.ts:106`. Inside `refresh()`, the code copies the flag and clears it at `packages/maestro-tui/src/explorer-config.ts:45` through `packages/maestro-tui/src/explorer-config.ts:47` before awaiting the selected source at `packages/maestro-tui/src/explorer-config.ts:48` through `packages/maestro-tui/src/explorer-config.ts:50`. In the probe, the mismatch-triggered `allTasks()` call rejects, and a later refresh invokes stale `onRefresh()` instead of retrying `allTasks()`, even though the latter would now return the authoritative replacement row.

## Expected Behavior

Once a reorder mismatch establishes that the cached task set is not authoritative, the TUI should preserve its forced reconciliation mode until a direct `taskList.allTasks()` refresh succeeds. A transient failure while loading authoritative tasks should leave later refresh attempts able to retry that required reconciliation rather than silently returning to the stale source.

## Impact

After concurrent task-list changes trigger an order mismatch, a single transient backend read failure can leave the Maestro dashboard showing tasks that the backend has already declared missing or obsolete. Users may continue acting on stale rows, miss newly authoritative tasks, or repeat failed reorders without any indication that recovery stopped attempting the required task-list refresh.
