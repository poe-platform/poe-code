import type { OpenTaskListOptions } from "@poe-code/task-list";
import type { ResolvedConfig } from "./schema.js";

export function resolveConfiguredTaskListOptions(
  cfg: Pick<ResolvedConfig, "tasks" | "stateOrder">
): OpenTaskListOptions {
  if (cfg.tasks === undefined) {
    throw new Error("Maestro workflow is missing tasks config.");
  }

  if (!("path" in cfg.tasks)) {
    return cfg.tasks;
  }

  return {
    ...cfg.tasks,
    stateMachine: {
      initial: cfg.stateOrder[0],
      states: cfg.stateOrder,
      events: Object.fromEntries(cfg.stateOrder.map((state) => [state, { from: "*", to: state }]))
    }
  } as OpenTaskListOptions;
}
