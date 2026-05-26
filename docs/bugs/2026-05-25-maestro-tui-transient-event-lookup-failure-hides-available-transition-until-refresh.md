# Maestro TUI transient event lookup failure hides available transition until refresh

## Summary

The `@poe-code/maestro-tui` explorer loads available workflow transitions into a row-action cache. If a task's `events()` lookup rejects transiently, the loader silently stores an empty event list and marks the cache complete. The `Move to state…` action is then hidden for that task on later row renders without retrying the lookup or surfacing the failure, even if the transition source is immediately available again.

## Reproduction

Create a disposable Vitest probe whose first `events()` call fails and whose second call would expose a valid `complete` transition:

```sh
cat > packages/maestro-tui/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import type { StateMachineDef, Task, TaskList, Tasks } from "@poe-code/task-list";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

const machine = {
  initial: "planned",
  states: ["planned", "done"],
  events: { complete: { from: ["planned"], to: "done" } }
} as const satisfies StateMachineDef;

const task: Task = {
  list: "work",
  id: "ship",
  qualifiedId: "work/ship",
  name: "Ship",
  state: "planned",
  description: "",
  metadata: {}
};

describe("maestro event cache transient failure", () => {
  it("hides a now-available transition after its first event lookup fails", async () => {
    const events = vi.fn()
      .mockRejectedValueOnce(new Error("temporary offline"))
      .mockResolvedValueOnce(["complete"]);
    const taskList = {
      list: vi.fn(() => ({ name: "work", stateMachine: machine, events } as unknown as Tasks))
    } as unknown as TaskList;
    const config = buildMaestroExplorerConfig({
      tasks: [task],
      taskList,
      variables: {},
      onRefresh: async () => [task]
    });
    const [row] = await config.rows();
    const action = config.actions.find((candidate) => candidate.id === "move-state")!;

    expect(action.predicate!(
      { row: row! } as Parameters<NonNullable<typeof action.predicate>>[0]
    )).toBe(false);
    const [sameRow] = await config.rows();
    expect(action.predicate!(
      { row: sameRow! } as Parameters<NonNullable<typeof action.predicate>>[0]
    )).toBe(false);
    expect(events).toHaveBeenCalledOnce();
  });
});
EOF
trap 'rm -f packages/maestro-tui/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
nl -ba packages/maestro-tui/src/explorer-config.ts | sed -n '58,65p;112,118p;265,280p'
```

The probe passes:

```text
✓ packages/maestro-tui/src/__probe__.test.ts > maestro event cache transient failure > hides a now-available transition after its first event lookup fails
```

## Observed Behavior

Rows call `loadCachedEvents()` before rendering at `packages/maestro-tui/src/explorer-config.ts:112` through `packages/maestro-tui/src/explorer-config.ts:118`. That loader stores the `toEventsMap()` result and sets `eventsCached = true` at `packages/maestro-tui/src/explorer-config.ts:58` through `packages/maestro-tui/src/explorer-config.ts:65`. `toEventsMap()` catches each `events()` error and replaces it with `[]` at `packages/maestro-tui/src/explorer-config.ts:265` through `packages/maestro-tui/src/explorer-config.ts:280`. In the probe, the initial transient failure becomes a cached empty event list; rendering rows again never attempts the now-successful second lookup, so the move-state predicate remains false.

## Expected Behavior

A failure to discover available transitions should remain distinguishable from a confirmed terminal task with no transitions. The TUI should expose the lookup failure and allow retry, or avoid caching a failure-derived empty list as a successful action state until an explicit refresh is required and communicated.

## Impact

Transient backend outages can make actionable tasks appear terminal or non-editable in the dashboard. Users may overlook required workflow transitions or assume a task cannot advance, while the underlying task list already supports the hidden action and the UI gives no indication that its absence came from an event-loading failure.
