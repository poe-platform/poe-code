import type {
  Action,
  DetailItem,
  ExplorerConfig,
  Row,
  Tone
} from "toolcraft-design";
import type { Task, TaskList } from "@poe-code/task-list";
import { stringify } from "yaml";
import { buildOpenIssueAction, buildOpenSourceAction } from "./actions.js";

export interface BuildMaestroExplorerConfigOptions {
  tasks: readonly Task[];
  taskList: TaskList;
  variables: Record<string, string | undefined>;
  onRefresh: () => Promise<Task[]>;
}

const KNOWN_STATES = [
  { state: "in-progress", tone: "warning" },
  { state: "planned", tone: "info" },
  { state: "draft", tone: "muted" },
  { state: "done", tone: "success" },
  { state: "archived", tone: "muted" }
] as const satisfies readonly { state: string; tone: Tone }[];
const STATE_ORDER = KNOWN_STATES.map(({ state }) => state);
const STATE_ORDER_INDEX = new Map<string, number>(
  STATE_ORDER.map((state, index) => [state, index])
);
const STATE_TONES = new Map<string, Tone>(
  KNOWN_STATES.map(({ state, tone }) => [state, tone])
);

export function buildMaestroExplorerConfig(
  options: BuildMaestroExplorerConfigOptions
): ExplorerConfig<void> {
  let tasks = [...options.tasks];
  let rows = toRows(tasks);
  let taskByRowId = toTaskMap(tasks);

  async function refresh(): Promise<void> {
    tasks = await options.onRefresh();
    rows = toRows(tasks);
    taskByRowId = toTaskMap(tasks);
  }

  const actions: Action<void>[] = [
    buildOpenSourceAction({
      taskByRowId: () => taskByRowId,
      variables: options.variables
    }),
    buildOpenIssueAction({
      taskByRowId: () => taskByRowId
    })
  ];

  return {
    title: "Maestro tasks",
    rows: async () => rows,
    refresh,
    detail: {
      items: async (row, ctx) => {
        const task = getTask(taskByRowId, row.id);
        const markdown = await loadMarkdownUnlessAborted(ctx.signal, () =>
          renderTaskDetailMarkdown(task, options.taskList)
        );

        if (markdown === undefined || ctx.signal.aborted) {
          return [];
        }

        return [
          {
            id: task.qualifiedId,
            render: () => markdown
          } satisfies DetailItem
        ];
      }
    },
    actions,
    multiSelect: false,
    emptyHint: "No tasks found"
  };
}

function toRows(tasks: readonly Task[]): Row[] {
  return [...tasks].sort(compareTasksForExplorer).map(toRow);
}

function compareTasksForExplorer(left: Task, right: Task): number {
  const leftIndex = STATE_ORDER_INDEX.get(left.state);
  const rightIndex = STATE_ORDER_INDEX.get(right.state);

  if (leftIndex !== undefined && rightIndex !== undefined) {
    return leftIndex - rightIndex;
  }

  if (leftIndex !== undefined) {
    return -1;
  }

  if (rightIndex !== undefined) {
    return 1;
  }

  return left.state.localeCompare(right.state);
}

function toRow(task: Task): Row {
  return {
    id: task.qualifiedId,
    title: task.name,
    subtitle: `${task.list} · ${task.qualifiedId}`,
    badge: { text: task.state, tone: toneForState(task.state) },
    group: task.state
  };
}

function toneForState(state: string): Tone {
  return STATE_TONES.get(state) ?? "info";
}

async function renderTaskDetailMarkdown(task: Task, taskList: TaskList): Promise<string> {
  const eventsMarkdown = await renderEventsMarkdown(task, taskList);
  const description = task.description.length > 0 ? task.description : "_No description._";
  const metadata = stringify(task.metadata).trimEnd();

  return [
    `# ${task.name}`,
    "",
    `**State:** ${task.state}`,
    "",
    description,
    "",
    "## Metadata",
    "",
    "```yaml",
    metadata,
    "```",
    "",
    "## Next",
    "",
    eventsMarkdown
  ].join("\n");
}

async function renderEventsMarkdown(task: Task, taskList: TaskList): Promise<string> {
  try {
    const events = await taskList.list(task.list).events(task.id);
    if (events.length === 0) {
      return "_Terminal state — no events available._";
    }

    return events.map((event) => `- ${event}`).join("\n");
  } catch (err) {
    return `_Could not load events: ${(err as Error).message}_`;
  }
}

function toTaskMap(tasks: readonly Task[]): Map<string, Task> {
  const taskByRowId = new Map<string, Task>();
  for (const task of tasks) {
    if (taskByRowId.has(task.qualifiedId)) {
      throw new Error(`Duplicate task qualifiedId: ${task.qualifiedId}`);
    }
    taskByRowId.set(task.qualifiedId, task);
  }
  return taskByRowId;
}

function getTask(taskByRowId: ReadonlyMap<string, Task>, rowId: string): Task {
  const task = taskByRowId.get(rowId);
  if (task === undefined) {
    throw new Error(`Task row is no longer available: ${rowId}`);
  }
  return task;
}

async function loadMarkdownUnlessAborted(
  signal: AbortSignal,
  load: () => Promise<string>
): Promise<string | undefined> {
  if (signal.aborted) {
    return undefined;
  }

  return new Promise<string | undefined>((resolve, reject) => {
    const abort = () => {
      resolve(undefined);
    };

    signal.addEventListener("abort", abort, { once: true });
    load()
      .then((markdown) => {
        resolve(signal.aborted ? undefined : markdown);
      }, reject)
      .finally(() => {
        signal.removeEventListener("abort", abort);
      });
  });
}
