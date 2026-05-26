# Maestro TUI move-state refresh failure rejects after committing transition

## Summary

The `@poe-code/maestro-tui` `Move to state…` action commits a selected task transition through `tasks.fire()` before awaiting the dashboard refresh that displays the new state. If that refresh rejects, the action rejects without displaying its success toast even though the underlying task-state mutation already succeeded. The user receives failure behavior for an operation that has already changed persisted workflow state.

## Reproduction

Create a disposable Vitest probe that gives the action one valid transition, records a successful `fire()` call, and makes the subsequent UI refresh reject:

```sh
cat > packages/maestro-tui/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { select, type ActionContext, type Row } from "@poe-code/design-system";
import type { StateMachineDef, Task, TaskList, Tasks } from "@poe-code/task-list";
import { buildMoveStateAction } from "./actions.js";

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    select: vi.fn(),
    isCancel: vi.fn(() => false)
  };
});

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

describe("maestro move-state action refresh failure", () => {
  it("rejects after the selected state transition has succeeded", async () => {
    vi.mocked(select).mockResolvedValue({ event: "complete", targetState: "done" });
    const fire = vi.fn(async () => ({ ...task, state: "done" }));
    const tasks = {
      name: "work",
      stateMachine: machine,
      all: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      fire,
      canFire: vi.fn(),
      events: vi.fn(async () => ["complete"]),
      delete: vi.fn(),
      move: vi.fn(),
      reorder: vi.fn()
    } as unknown as Tasks;
    const taskList = { list: vi.fn(() => tasks) } as unknown as TaskList;
    const action = buildMoveStateAction({
      taskList,
      taskByRowId: () => new Map([[task.qualifiedId, task]]),
      eventsByRowId: () => new Map([[task.qualifiedId, ["complete"]]])
    });
    const row: Row = { id: task.qualifiedId, title: task.name };
    const refreshError = new Error("dashboard refresh unavailable");
    const ctx = {
      row,
      rows: [row],
      filter: "",
      refresh: vi.fn(async () => {
        throw refreshError;
      }),
      suspendAnd: vi.fn(async (fn) => fn()),
      toast: vi.fn(),
      confirm: vi.fn(async () => true),
      exit: vi.fn()
    } as ActionContext<void>;

    await expect(action.handler(ctx)).rejects.toThrow("dashboard refresh unavailable");

    expect(fire).toHaveBeenCalledWith("ship", "complete");
    expect(ctx.refresh).toHaveBeenCalledOnce();
    expect(ctx.toast).not.toHaveBeenCalled();
  });
});
EOF
trap 'rm -f packages/maestro-tui/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
nl -ba packages/maestro-tui/src/actions.ts | sed -n '77,90p'
```

The probe passes:

```text
✓ packages/maestro-tui/src/__probe__.test.ts > maestro move-state action refresh failure > rejects after the selected state transition has succeeded
```

## Observed Behavior

`buildMoveStateAction()` awaits `tasks.fire(task.id, selected.event)` at `packages/maestro-tui/src/actions.ts:78`, so the selected workflow transition has completed before the action attempts to reload displayed state. It then awaits `ctx.refresh()` at `packages/maestro-tui/src/actions.ts:88`, and only shows `Moved to ...` after that refresh resolves at `packages/maestro-tui/src/actions.ts:89`. In the probe, `fire("ship", "complete")` succeeds and records the committed transition, while a failed refresh causes `handler()` to reject and leaves the user without a success notification.

## Expected Behavior

Once the TUI successfully commits a task-state transition, a subsequent display refresh failure should not make the action appear unapplied. The action should either communicate that the transition succeeded but the view could not refresh, or preserve an explicit committed-result outcome separate from refresh failure.

## Impact

Users can retry a state change after seeing a rejected action or missing success feedback, even though the workflow task has already advanced. Depending on the task backend and downstream automation, that ambiguity can cause invalid retries, duplicate operational work, or incorrect assumptions about which tasks remain actionable.
