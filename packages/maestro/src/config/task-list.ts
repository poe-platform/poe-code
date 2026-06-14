import type { OpenTaskListOptions } from "@poe-code/task-list";
import type { ResolvedConfig } from "./schema.js";

export function resolveConfiguredTaskListOptions(
  cfg: Pick<ResolvedConfig, "tasks" | "stateOrder" | "terminalStateNames">
): OpenTaskListOptions {
  const tasks = getOwnEntry(cfg as unknown as Record<string, unknown>, "tasks") as
    | OpenTaskListOptions
    | undefined;
  if (tasks === undefined) {
    throw new Error("Maestro workflow is missing tasks config.");
  }

  const tasksRecord = tasks as unknown as Record<string, unknown>;
  const taskType = getOwnEntry(tasksRecord, "type");
  const taskProject = getOwnEntry(tasksRecord, "project");
  if (
    !hasOwnEntry(tasksRecord, "path") &&
    !(taskType === "gh-issues" && taskProject === undefined)
  ) {
    return tasks;
  }

  return {
    ...tasks,
    stateMachine: {
      initial: cfg.stateOrder[0],
      states: cfg.stateOrder,
      events: deriveStateEvents(cfg.stateOrder, cfg.terminalStateNames)
    }
  } as OpenTaskListOptions;
}

function hasOwnEntry(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return hasOwnEntry(record, key) ? record[key] : undefined;
}

function deriveStateEvents(
  stateOrder: readonly string[],
  terminalStateNames: readonly string[]
): Record<string, { from: readonly string[]; to: string }> {
  const terminalStates = new Set(terminalStateNames);
  const activeStates = stateOrder.filter((state) => !terminalStates.has(state));

  return Object.fromEntries(
    stateOrder.map((state) => [
      state,
      {
        from: activeStates.filter((source) => source !== state),
        to: state
      }
    ])
  );
}
