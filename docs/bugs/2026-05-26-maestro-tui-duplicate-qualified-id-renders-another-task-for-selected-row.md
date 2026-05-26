# Maestro TUI duplicate qualified id renders another task for selected row

## Summary

The exported `@poe-code/maestro-tui` explorer configuration renders every supplied `Task` as a visible row but indexes tasks for details and actions in a `Map` keyed only by `qualifiedId`. If two task records have the same `qualifiedId`, the later task silently overwrites the earlier entry, so selecting the earlier visible row displays and can act on the later task instead.

## Reproduction

From the repository root, create and execute this disposable Vitest probe, then remove it:

```sh
cat > packages/maestro-tui/src/__probe__.test.ts <<'EOF'
import { expect, it, vi } from "vitest";
import type { Task, TaskList, Tasks } from "@poe-code/task-list";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

function task(name: string): Task {
  return {
    list: "tasks",
    id: name,
    qualifiedId: "tasks/collision",
    name,
    state: "planned",
    description: `${name} description`,
    metadata: {}
  };
}

function taskList(): TaskList {
  const tasks = {
    name: "tasks",
    stateMachine: { initial: "planned", states: ["planned"], events: {} },
    all: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    fire: vi.fn(),
    canFire: vi.fn(),
    events: vi.fn(async () => []),
    delete: vi.fn(),
    move: vi.fn(),
    reorder: vi.fn()
  } as unknown as Tasks;
  return {
    list: () => tasks,
    lists: vi.fn(),
    allTasks: vi.fn(),
    get: vi.fn(),
    moveBetweenLists: vi.fn()
  };
}

it("renders the second duplicate task when the first visible row is selected", async () => {
  const config = buildMaestroExplorerConfig({
    tasks: [task("first"), task("second")],
    taskList: taskList(),
    variables: {},
    onRefresh: async () => []
  });
  const rows = await config.rows();

  expect(rows.map((row) => row.title)).toEqual(["first", "second"]);
  expect(rows[0]!.id).toBe(rows[1]!.id);

  const items = await config.detail.items(rows[0]!, {
    width: 80,
    height: 20,
    signal: new AbortController().signal,
    row: rows[0]!
  });
  const markdown = items[0]!.render({
    width: 80,
    height: 20,
    signal: new AbortController().signal,
    row: rows[0]!
  });

  expect(markdown).toContain("# second");
  expect(markdown).not.toContain("# first");
});
EOF
npm exec -- vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
rm -f packages/maestro-tui/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/maestro-tui/src/__probe__.test.ts > renders the second duplicate task when the first visible row is selected
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

With two supplied tasks named `first` and `second` sharing `qualifiedId: "tasks/collision"`, `config.rows()` returns two visible rows titled `first` and `second`, and both rows have the same row identifier. When the detail pane is requested for the first visible row, the rendered Markdown starts with `# second` rather than `# first`.

`buildMaestroExplorerConfig()` independently constructs the visible row array and lookup map at `packages/maestro-tui/src/explorer-config.ts:38` through `packages/maestro-tui/src/explorer-config.ts:40`. `toRow()` uses `task.qualifiedId` as each row identifier at `packages/maestro-tui/src/explorer-config.ts:168` through `packages/maestro-tui/src/explorer-config.ts:175`, while `toTaskMap()` creates a `Map` from that same value at `packages/maestro-tui/src/explorer-config.ts:219` through `packages/maestro-tui/src/explorer-config.ts:221`, silently preserving only the later duplicate. Detail rendering then resolves the selected row exclusively through this overwritten lookup at `packages/maestro-tui/src/explorer-config.ts:119` through `packages/maestro-tui/src/explorer-config.ts:136` and `packages/maestro-tui/src/explorer-config.ts:282` through `packages/maestro-tui/src/explorer-config.ts:287`.

## Expected Behavior

The explorer should not display a row whose detail and action identity can be redirected by another supplied task. Duplicate task identities should be rejected, disambiguated, or otherwise represented so selecting each visible row always resolves to that row's own task.

## Impact

A malformed or inconsistent task backend can produce multiple visible Maestro rows that are not safely selectable. Operators may inspect the wrong task description and metadata, and actions wired through the same row-to-task map can open, transition, or reorder a different task than the row shown as selected, undermining confidence in task triage and mutation from the TUI.
