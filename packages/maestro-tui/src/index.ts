import {
  runExplorer,
  type DetailItem,
  type ExplorerConfig,
  type Row
} from "@poe-code/design-system";
import type {
  ResolvedConfig,
  WorkflowDefinition
} from "@poe-code/agent-maestro";
import type {
  OpenTaskListOptions,
  Task,
  TaskList
} from "@poe-code/task-list";

type RunExplorerImpl = (config: ExplorerConfig<void>) => Promise<void | null>;

export interface BuildMaestroExplorerConfigOptions {
  tasks?: readonly Task[];
  taskList?: Pick<TaskList, "allTasks">;
  workflow?: WorkflowDefinition;
  workflowConfig?: ResolvedConfig;
  taskListOptions?: OpenTaskListOptions;
}

export interface RunMaestroTuiOptions extends BuildMaestroExplorerConfigOptions {
  runExplorerImpl?: RunExplorerImpl;
}

export function buildMaestroExplorerConfig(
  options: BuildMaestroExplorerConfigOptions = {}
): ExplorerConfig<void> {
  const tasks = options.tasks ?? [];
  const rows = tasks.map(toRow);
  const taskByRowId = new Map(tasks.map((task) => [task.qualifiedId, task]));

  return {
    title: "Maestro Tasks",
    rows: async () => rows,
    detail: {
      items: async (row) => [toDetailItem(row, taskByRowId)]
    },
    actions: [],
    multiSelect: false,
    emptyHint: "No maestro tasks found"
  };
}

export async function runMaestroTui(options: RunMaestroTuiOptions = {}): Promise<void> {
  const config = buildMaestroExplorerConfig(options);
  await (options.runExplorerImpl ?? runExplorer)(config);
}

function toRow(task: Task): Row {
  return {
    id: task.qualifiedId,
    title: task.name,
    subtitle: task.qualifiedId,
    badge: { text: task.state },
    group: task.list
  };
}

function toDetailItem(row: Row, taskByRowId: ReadonlyMap<string, Task>): DetailItem {
  const task = taskByRowId.get(row.id);

  return {
    id: row.id,
    render: () => task?.description ?? ""
  };
}
