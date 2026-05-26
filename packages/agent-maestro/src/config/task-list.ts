import type { OpenTaskListOptions } from "@poe-code/task-list";
import type { ResolvedConfig } from "./schema.js";

export function resolveConfiguredTaskListOptions(
  cfg: Pick<ResolvedConfig, "tasks" | "stateOrder" | "terminalStateNames">
): OpenTaskListOptions {
  if (cfg.tasks === undefined) {
    throw new Error("Maestro workflow is missing tasks config.");
  }

  if (
    !("path" in cfg.tasks) &&
    !(cfg.tasks.type === "gh-issues" && cfg.tasks.project === undefined)
  ) {
    return cfg.tasks;
  }

  return {
    ...cfg.tasks,
    stateMachine: {
      initial: cfg.stateOrder[0],
      states: cfg.stateOrder,
      events: deriveStateEvents(cfg.stateOrder, cfg.terminalStateNames)
    }
  } as OpenTaskListOptions;
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
