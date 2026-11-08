import path from "node:path";
import {
  loadWorkflow,
  resolveConfig,
  resolveConfiguredTaskListOptions,
  resolveWorkflowPath
} from "@poe-code/maestro";
import { runExplorer } from "toolcraft-design";
import { openTaskList, type TaskList } from "@poe-code/task-list";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

export interface RunMaestroTuiOptions {
  workflowPath?: string;
  name?: string;
  taskList?: TaskList;
  variables?: Record<string, string | undefined>;
}

export async function runMaestroTui(options: RunMaestroTuiOptions = {}): Promise<void> {
  if (options.workflowPath !== undefined && options.name !== undefined) {
    throw new Error("Cannot specify both workflowPath and name for Maestro.");
  }

  const workflowPath = options.workflowPath ?? resolveWorkflowPath(options.name, process.cwd());
  const taskList = options.taskList ?? (await openWorkflowTaskList(workflowPath));
  const loadTasks = () => taskList.allTasks();
  const tasks = await loadTasks();
  const config = buildMaestroExplorerConfig({
    tasks,
    taskList,
    variables: options.variables ?? process.env,
    onRefresh: loadTasks
  });

  await runExplorer(config);
}

async function openWorkflowTaskList(workflowPath: string): Promise<TaskList> {
  const workflow = await loadWorkflow(workflowPath);
  const cfg = resolveConfig(workflow.config, path.dirname(workflow.sourcePath));
  return openTaskList(resolveConfiguredTaskListOptions(cfg));
}
