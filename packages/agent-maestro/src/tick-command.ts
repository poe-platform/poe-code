import path from "node:path";
import { openTaskList, type OpenTaskListOptions, type TaskList } from "@poe-code/task-list";

import { loadWorkflow } from "./config/load.js";
import { resolveConfig, type ResolvedConfig } from "./config/schema.js";
import { resolveConfiguredTaskListOptions } from "./config/task-list.js";
import type { MaestroEvent } from "./index.js";
import { maestroTaskStateMachine } from "./state-machine.js";

export interface RunMaestroTickOptions {
  configPath?: string;
  task: string;
  transition: string;
  list?: string;
  onEvent?: (event: MaestroEvent) => void;
  now?: () => Date;
  openTaskList?: (options: OpenTaskListOptions) => Promise<TaskList>;
}

export async function runMaestroTick(options: RunMaestroTickOptions): Promise<void> {
  const workflow = await loadWorkflow(options.configPath ?? "./WORKFLOW.md");
  const cfg = applyTickOptionOverrides(
    resolveConfig(workflow.config, path.dirname(workflow.sourcePath)),
    options
  );
  const openTaskListFn = options.openTaskList ?? openTaskList;
  const taskList = await openTaskListFn(resolveConfiguredTaskListOptions(cfg));

  await taskList.get(options.task);
  assertValidTransition(options.transition);

  options.onEvent?.({
    type: "tick_started",
    at: (options.now?.() ?? new Date()).toISOString()
  });
}

function applyTickOptionOverrides(
  cfg: ResolvedConfig,
  options: Pick<RunMaestroTickOptions, "list">
): ResolvedConfig {
  if (options.list === undefined) {
    return cfg;
  }

  return {
    ...cfg,
    agent: {
      ...cfg.agent,
      list: options.list
    }
  };
}

function assertValidTransition(transition: string): void {
  const parsed = parseTransition(transition);

  for (const event of Object.values(maestroTaskStateMachine.events)) {
    if (event.to !== parsed.to) {
      continue;
    }

    if (event.from === "*" || event.from.some((source) => source === parsed.from)) {
      return;
    }
  }

  throw new Error(`Invalid maestro transition "${transition}".`);
}

function parseTransition(transition: string): { from: string; to: string } {
  const separator = transition.indexOf(":");

  if (
    separator <= 0 ||
    separator !== transition.lastIndexOf(":") ||
    separator === transition.length - 1
  ) {
    throw new Error(`Invalid maestro transition "${transition}". Expected <fromState>:<toState>.`);
  }

  return {
    from: transition.slice(0, separator),
    to: transition.slice(separator + 1)
  };
}
