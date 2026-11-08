import path from "node:path";
import { openTaskList, type OpenTaskListOptions, type TaskList } from "@poe-code/task-list";

import { loadWorkflow } from "./config/load.js";
import { resolveConfig, type ResolvedConfig } from "./config/schema.js";
import { resolveConfiguredTaskListOptions } from "./config/task-list.js";
import type { MaestroEvent } from "./index.js";
import { advanceTaskToRunning } from "./runtime/advance.js";
import { maestroTaskStateMachine } from "./state-machine.js";
import { resolveWorkflowPath } from "./workflow-path.js";

export interface RunMaestroTickOptions {
  configPath?: string;
  name?: string;
  task: string;
  transition: string;
  list?: string;
  onEvent?: (event: MaestroEvent) => void;
  now?: () => Date;
  dryRun?: boolean;
  openTaskList?: (options: OpenTaskListOptions) => Promise<TaskList>;
}

export async function runMaestroTick(options: RunMaestroTickOptions): Promise<void> {
  if (options.configPath !== undefined && options.name !== undefined) {
    throw new Error("Cannot specify both configPath and name for Maestro.");
  }

  const workflow = await loadWorkflow(
    options.configPath ?? resolveWorkflowPath(options.name, process.cwd())
  );
  const cfg = applyTickOptionOverrides(
    resolveConfig(workflow.config, path.dirname(workflow.sourcePath)),
    options
  );

  const transition = parseTransition(options.transition);
  assertValidTransition(options.transition, transition);

  options.onEvent?.({
    type: "tick_started",
    at: (options.now?.() ?? new Date()).toISOString()
  });

  if (options.dryRun === true) {
    return;
  }

  if (isQueuedTriggerTransition(transition)) {
    const openTaskListFn = options.openTaskList ?? openTaskList;
    const taskList = await openTaskListFn(resolveConfiguredTaskListOptions(cfg));
    await advanceTaskToRunning(taskList, resolveTickTaskRef(cfg, options.task));
  }
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

function assertValidTransition(transition: string, parsed: { from: string; to: string }): void {
  if (isQueuedTriggerTransition(parsed)) {
    return;
  }

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

function isQueuedTriggerTransition(transition: { from: string; to: string }): boolean {
  return transition.from === "*" && transition.to === "queued";
}

function resolveTickTaskRef(
  cfg: Pick<ResolvedConfig, "agent">,
  qualifiedId: string
): { list: string; id: string } {
  const list = cfg.agent.list;

  if (list === undefined || list.length === 0) {
    throw new Error("Maestro tick requires agent.list to resolve task ids.");
  }

  const hashPrefix = `${list}#`;
  if (qualifiedId.startsWith(hashPrefix) && qualifiedId.length > hashPrefix.length) {
    return { list, id: qualifiedId.slice(hashPrefix.length) };
  }

  const slashPrefix = `${list}/`;
  if (qualifiedId.startsWith(slashPrefix) && qualifiedId.length > slashPrefix.length) {
    return { list, id: qualifiedId.slice(slashPrefix.length) };
  }

  if (!qualifiedId.includes("#") && !qualifiedId.includes("/")) {
    return { list, id: qualifiedId };
  }

  throw new Error(`Invalid qualified task id "${qualifiedId}" for list "${list}".`);
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
