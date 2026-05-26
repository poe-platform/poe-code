# Maestro TUI multi-list reorder failure partially commits list order

## Summary

The `@poe-code/maestro-tui` reorder handler applies ordering changes separately for every affected task list. When a drag-and-drop operation changes the relative order within multiple lists, the handler awaits the first list's successful `reorder()` mutation before attempting the next list. If a later list rejects, the whole UI operation rejects after earlier list order has already been committed, leaving the requested cross-list reorder only partially applied.

## Reproduction

Create a disposable Vitest probe with two changed lists: `work` accepts its reordered IDs, while `bugs` rejects its reorder request:

```sh
cat > packages/maestro-tui/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import type { Task, TaskList, Tasks } from "@poe-code/task-list";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

function task(list: string, id: string): Task {
  return {
    list,
    id,
    qualifiedId: `${list}/${id}`,
    name: id,
    state: "planned",
    description: "",
    metadata: {}
  };
}

describe("maestro multi-list reorder failure", () => {
  it("rejects after the first changed list has already been reordered", async () => {
    const workReorder = vi.fn(async () => [task("work", "b"), task("work", "a")]);
    const bugsReorder = vi.fn(async () => {
      throw new Error("bugs backend unavailable");
    });
    const makeTasks = (name: string, reorder: Tasks["reorder"]) =>
      ({ name, reorder } as unknown as Tasks);
    const taskList = {
      list: vi.fn((name: string) =>
        name === "work" ? makeTasks(name, workReorder) : makeTasks(name, bugsReorder)
      )
    } as unknown as TaskList;
    const config = buildMaestroExplorerConfig({
      tasks: [task("work", "a"), task("work", "b"), task("bugs", "a"), task("bugs", "b")],
      taskList,
      variables: {},
      onRefresh: async () => []
    });

    await expect(
      config.reorder!.onReorder(["work/b", "work/a", "bugs/b", "bugs/a"])
    ).rejects.toThrow("bugs backend unavailable");

    expect(workReorder).toHaveBeenCalledWith(["b", "a"]);
    expect(bugsReorder).toHaveBeenCalledWith(["b", "a"]);
  });
});
EOF
trap 'rm -f packages/maestro-tui/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
nl -ba packages/maestro-tui/src/explorer-config.ts | sed -n '82,110p'
```

The probe passes:

```text
✓ packages/maestro-tui/src/__probe__.test.ts > maestro multi-list reorder failure > rejects after the first changed list has already been reordered
```

## Observed Behavior

`onReorder()` groups the requested row ordering by backing list and loops through each changed list at `packages/maestro-tui/src/explorer-config.ts:84` through `packages/maestro-tui/src/explorer-config.ts:98`. Each changed list is independently persisted by awaiting `options.taskList.list(listName).reorder(...)` at `packages/maestro-tui/src/explorer-config.ts:94` through `packages/maestro-tui/src/explorer-config.ts:96`. In the probe, the `work` reorder commits successfully before the subsequent `bugs` reorder rejects, and the handler propagates the rejection without compensating for the already-applied `work` order.

## Expected Behavior

A single TUI reorder gesture that requires mutations to multiple backing lists should either apply atomically, roll back already-updated lists if a later mutation fails, or report a partial-commit outcome that allows safe reconciliation instead of representing the operation as an ordinary rejection.

## Impact

Users can drag rows expecting one coherent visual reorder and instead persist only part of the intended ordering when a second backend list experiences a transient or validation failure. The dashboard then starts from a state the failed action did not visibly acknowledge, making retries ambiguous and allowing task priorities or execution order to diverge across lists.
