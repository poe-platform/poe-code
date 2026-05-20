import {
  isCancel,
  select,
  type Action
} from "@poe-code/design-system";
import {
  InvalidTransitionError,
  type Task,
  type TaskList
} from "@poe-code/task-list";

export interface BuildMoveStateActionOptions {
  taskList: TaskList;
  taskByRowId: () => ReadonlyMap<string, Task>;
  eventsByRowId: () => ReadonlyMap<string, readonly string[]>;
}

interface MoveStateChoice {
  event: string;
  targetState: string;
}

export function buildMoveStateAction(options: BuildMoveStateActionOptions): Action<void> {
  return {
    id: "move-state",
    key: "f",
    label: "Move to state…",
    primary: true,
    predicate: (ctx) => (options.eventsByRowId().get(ctx.row.id)?.length ?? 0) > 0,
    handler: async (ctx) => {
      const task = getTask(options.taskByRowId(), ctx.row.id);
      const tasks = options.taskList.list(task.list);
      const events = await tasks.events(task.id);

      if (events.length === 0) {
        ctx.toast("No state moves available.", "info");
        return;
      }

      const choices = events.map((event) => {
        const targetState = tasks.stateMachine.events[event]?.to;
        if (targetState === undefined) {
          throw new Error(`Task event "${event}" does not declare a target state.`);
        }

        return {
          event,
          targetState
        };
      });

      const selected = await ctx.suspendAnd(() =>
        select<MoveStateChoice>({
          message: "Move task to state",
          options: choices.map((choice) => ({
            value: choice,
            label: `${choice.event}    → ${choice.targetState}`
          }))
        })
      );

      if (isCancel(selected)) {
        return;
      }

      try {
        await tasks.fire(task.id, selected.event);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          ctx.toast(err.reason, "error");
          return;
        }

        throw err;
      }

      await ctx.refresh();
      ctx.toast(`Moved to ${selected.targetState}`, "info");
    }
  };
}

function getTask(taskByRowId: ReadonlyMap<string, Task>, rowId: string): Task {
  const task = taskByRowId.get(rowId);
  if (task === undefined) {
    throw new Error(`Task row is no longer available: ${rowId}`);
  }
  return task;
}
