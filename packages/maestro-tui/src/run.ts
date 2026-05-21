import path from "node:path";
import {
  loadWorkflow,
  resolveConfig,
  resolveConfiguredTaskListOptions
} from "@poe-code/agent-maestro";
import { runExplorer } from "@poe-code/design-system";
import { openTaskList, type TaskList } from "@poe-code/task-list";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

export interface RunMaestroTuiOptions {
  workflowPath?: string;
  taskList?: TaskList;
  variables?: Record<string, string | undefined>;
}

export async function runMaestroTui(options: RunMaestroTuiOptions = {}): Promise<void> {
  const taskList = options.taskList ?? (await openWorkflowTaskList(options.workflowPath));
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

async function openWorkflowTaskList(workflowPath = "./WORKFLOW.md"): Promise<TaskList> {
  const workflow = await loadWorkflow(workflowPath);
  const cfg = resolveConfig(workflow.config, path.dirname(workflow.sourcePath));
  return openTaskList(resolveConfiguredTaskListOptions(cfg));
}
