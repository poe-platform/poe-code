# Maestro TUI read-only browser exposes task-state mutation

## Summary

`@poe-code/maestro-tui` is documented as a read-only TUI for browsing Maestro task lists, but its default explorer configuration exposes a `Move to state…` action that calls the task-list mutation API. A user opening the advertised read-only browser can therefore transition persisted task state directly from the UI.

## Reproduction

From the repository root, run a disposable Vitest probe that builds the public explorer configuration and invokes its advertised state action:

```sh
cat > packages/maestro-tui/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    select: vi.fn(async () => ({ event: "finish", targetState: "done" })),
    isCancel: vi.fn(() => false)
  };
});

describe("maestro read-only contract", () => {
  it("exposes an action that fires a task-state transition", async () => {
    const fire = vi.fn(async () => undefined);
    const tasksApi = {
      stateMachine: { events: { finish: { from: ["planned"], to: "done" } } },
      events: vi.fn(async () => ["finish"]),
      fire
    };
    const task = {
      id: "ship",
      qualifiedId: "tasks/ship",
      name: "Ship",
      list: "tasks",
      state: "planned",
      metadata: {}
    } as never;
    const config = buildMaestroExplorerConfig({
      tasks: [task],
      taskList: { list: vi.fn(() => tasksApi) } as never,
      variables: {},
      onRefresh: vi.fn(async () => [task])
    });
    const action = config.actions.find((candidate) => candidate.id === "move-state")!;
    await action.handler({
      row: { id: "tasks/ship", title: "Ship" },
      rows: [],
      filter: "",
      refresh: vi.fn(async () => undefined),
      suspendAnd: async (operation) => operation(),
      toast: vi.fn(),
      confirm: vi.fn(async () => true),
      exit: vi.fn()
    });
    console.log(JSON.stringify({ label: action.label, fireCalls: fire.mock.calls }));
    expect(fire).toHaveBeenCalledWith("ship", "finish");
  });
});
EOF
trap 'rm -f packages/maestro-tui/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
nl -ba packages/maestro-tui/README.md | sed -n '1,12p'
nl -ba packages/maestro-tui/src/actions.ts | sed -n '29,82p'
nl -ba packages/maestro-tui/src/explorer-config.ts | sed -n '74,93p'
```

## Observed Behavior

Invoking the action included in the browser configuration submits a state transition through `fire()`:

```text
{"label":"Move to state…","fireCalls":[["ship","finish"]]}
✓ packages/maestro-tui/src/__probe__.test.ts > maestro read-only contract > exposes an action that fires a task-state transition
```

The package README identifies the public surface as a “Read-only TUI package for browsing maestro task lists” in `packages/maestro-tui/README.md:3`. However, `buildMoveStateAction()` implements the mutation by invoking `tasks.fire(task.id, selected.event)` in `packages/maestro-tui/src/actions.ts:36`, and the explorer configuration includes that state-changing action while explicitly noting it is a state mutation path in `packages/maestro-tui/src/explorer-config.ts:83`.

## Expected Behavior

A package described as a read-only TUI should not provide actions that change task state, reorder persisted tasks, or otherwise mutate its task-list backend. If mutation is an intended feature, the public documentation and API contract should not represent the TUI as read-only.

## Impact

Operators may open Maestro TUI expecting safe inspection of task status and accidentally advance workflow tasks or alter orchestration state. This is especially risky for production task lists where a state transition can trigger follow-up automation, hide pending work, or record an irreversible completion decision.
