import { InvalidTransitionError, type TaskState } from "./types.js";

export const LEGAL_TRANSITIONS: Readonly<Record<TaskState, ReadonlySet<TaskState>>> = {
  draft: new Set(["planned", "archived"]),
  planned: new Set(["in-progress", "draft", "archived"]),
  "in-progress": new Set(["done", "planned", "archived"]),
  done: new Set(["archived", "in-progress"]),
  archived: new Set()
};

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!LEGAL_TRANSITIONS[from].has(to)) {
    throw new InvalidTransitionError(`Cannot transition task from "${from}" to "${to}".`);
  }
}
