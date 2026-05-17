import type { Task } from "@poe-code/task-list";

export function resolveWorkflowKind(task: Task): string {
  const kind = task.metadata.kind;

  return kind === undefined ? "pipeline" : String(kind);
}
