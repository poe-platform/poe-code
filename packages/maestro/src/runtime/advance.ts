import type { Task, TaskList } from "@poe-code/task-list";

const DEFAULT_RUNNING_EVENT = "agent-running";

export interface AdvanceTaskToRunningOptions {
  events?: readonly string[];
  requireSupported?: boolean;
}

export function advanceTaskToRunning(
  tasks: Pick<TaskList, "list">,
  task: Task,
  options: AdvanceTaskToRunningOptions & { requireSupported: true }
): Promise<Task>;
export function advanceTaskToRunning(
  tasks: Pick<TaskList, "list">,
  task: Pick<Task, "list" | "id">,
  options?: AdvanceTaskToRunningOptions & { requireSupported?: false }
): Promise<Task>;
export async function advanceTaskToRunning(
  tasks: Pick<TaskList, "list">,
  task: Task | Pick<Task, "list" | "id">,
  options: AdvanceTaskToRunningOptions = {}
): Promise<Task> {
  const list = tasks.list(task.list);
  const events = options.events ?? [DEFAULT_RUNNING_EVENT];

  if (options.requireSupported !== true) {
    return list.fire(task.id, events[0] ?? DEFAULT_RUNNING_EVENT);
  }

  for (const event of events) {
    if (await list.canFire(task.id, event)) {
      return list.fire(task.id, event);
    }
  }

  return task as Task;
}
