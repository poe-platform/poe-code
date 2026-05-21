import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvalidTransitionError,
  OrderMismatchError,
  type StateMachineDef,
  type Task,
  type TaskList,
  type Tasks
} from "@poe-code/task-list";
import {
  select,
  type Action,
  type ActionContext,
  type Row
} from "@poe-code/design-system";
import {
  buildMaestroExplorerConfig as buildMaestroExplorerConfigBase,
  type BuildMaestroExplorerConfigOptions
} from "./explorer-config.js";

const { cancelSelection, editFileMock } = vi.hoisted(() => ({
  cancelSelection: Symbol("cancel"),
  editFileMock: vi.fn()
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    select: vi.fn(),
    isCancel: vi.fn((value: unknown) => value === cancelSelection)
  };
});

vi.mock("@poe-code/plan-browser", () => ({
  editFile: editFileMock
}));

function buildMaestroExplorerConfig(
  options: Omit<BuildMaestroExplorerConfigOptions, "variables"> &
    Partial<Pick<BuildMaestroExplorerConfigOptions, "variables">>
): ReturnType<typeof buildMaestroExplorerConfigBase> {
  return buildMaestroExplorerConfigBase({ variables: {}, ...options });
}

const workflowMachine = {
  initial: "planned",
  states: ["planned", "in-progress", "done", "archived"],
  events: {
    start: { from: ["planned"], to: "in-progress" },
    complete: { from: ["in-progress"], to: "done" },
    archive: { from: "*", to: "archived" }
  }
} as const satisfies StateMachineDef;

function task(overrides: Partial<Task> = {}): Task {
  const list = overrides.list ?? "tasks";
  const id = overrides.id ?? "ship";
  const name = overrides.name ?? id;

  return {
    list,
    id,
    qualifiedId: overrides.qualifiedId ?? `${list}/${id}`,
    name,
    state: overrides.state ?? "planned",
    description: overrides.description ?? "Build the thing.",
    metadata: overrides.metadata ?? { priority: "high" },
    ...overrides
  };
}

function taskList(options: {
  events?: Record<string, Promise<readonly string[]> | readonly string[]>;
  eventErrors?: Record<string, Error>;
  fireErrors?: Record<string, Error>;
  reorderErrors?: Record<string, Error>;
  allTasks?: readonly Task[];
  stateMachine?: StateMachineDef;
} = {}): TaskList {
  const lists = new Map<string, Tasks>();

  return {
    list: (name) => {
      let existing = lists.get(name);
      if (existing === undefined) {
        existing = tasks(name, options);
        lists.set(name, existing);
      }
      return existing;
    },
    lists: vi.fn(async () => ["tasks"]),
    allTasks: vi.fn(async () => [...(options.allTasks ?? [])]),
    get: vi.fn(async (qualifiedId) => task({ qualifiedId })),
    moveBetweenLists: vi.fn(async (qualifiedId, targetList) =>
      task({ qualifiedId, list: targetList })
    )
  };
}

function tasks(
  name: string,
  options: {
    events?: Record<string, Promise<readonly string[]> | readonly string[]>;
    eventErrors?: Record<string, Error>;
    fireErrors?: Record<string, Error>;
    reorderErrors?: Record<string, Error>;
    stateMachine?: StateMachineDef;
  }
): Tasks {
  const stateMachine = options.stateMachine ?? workflowMachine;

  return {
    name,
    stateMachine,
    all: vi.fn(async () => []),
    get: vi.fn(async (id) => task({ list: name, id })),
    create: vi.fn(async (input) => task({ list: name, name: input.name })),
    update: vi.fn(async (id, patch) => task({ list: name, id, ...patch })),
    fire: vi.fn(async (id, event) => {
      const error = options.fireErrors?.[`${name}/${id}:${event}`];
      if (error !== undefined) {
        throw error;
      }
      return task({ list: name, id, state: stateMachine.events[event]?.to ?? "planned" });
    }),
    canFire: vi.fn(async () => true),
    events: vi.fn(async (id) => {
      const error = options.eventErrors?.[`${name}/${id}`];
      if (error !== undefined) {
        throw error;
      }
      return options.events?.[`${name}/${id}`] ?? [];
    }),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async (id) => task({ list: name, id })),
    reorder: vi.fn(async (ids) => {
      const error = options.reorderErrors?.[name];
      if (error !== undefined) {
        throw error;
      }
      return ids.map((id) => task({ list: name, id }));
    })
  };
}

function actionCtx(row: Row, overrides: Partial<ActionContext<void>> = {}): ActionContext<void> {
  return {
    row,
    rows: [row],
    filter: "",
    refresh: vi.fn(async () => undefined),
    suspendAnd: vi.fn(async (fn) => fn()),
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    exit: vi.fn(),
    ...overrides
  };
}

function moveStateAction(config: ReturnType<typeof buildMaestroExplorerConfig>): Action<void> {
  const action = config.actions.find((candidate) => candidate.id === "move-state");
  if (action === undefined) {
    throw new Error("Move state action was not registered.");
  }
  return action;
}

function openSourceAction(config: ReturnType<typeof buildMaestroExplorerConfig>): Action<void> {
  const action = config.actions.find((candidate) => candidate.id === "open-source");
  if (action === undefined) {
    throw new Error("Open source action was not registered.");
  }
  return action;
}

async function renderDetail(config: ReturnType<typeof buildMaestroExplorerConfig>, rowIndex = 0) {
  const rows = await config.rows();
  const row = rows[rowIndex]!;
  const items = await config.detail.items(row, {
    width: 80,
    height: 20,
    signal: new AbortController().signal,
    row
  });

  return items[0]!.render({
    width: 80,
    height: 20,
    signal: new AbortController().signal,
    row
  });
}

describe("buildMaestroExplorerConfig", () => {
  beforeEach(() => {
    vi.mocked(select).mockReset();
    editFileMock.mockReset();
  });

  it("maps and orders task rows by state while preserving order within state", async () => {
    const tasks = [
      task({ id: "archived", qualifiedId: "tasks/archived", state: "archived" }),
      task({ id: "planned-a", qualifiedId: "tasks/planned-a", state: "planned" }),
      task({ id: "review", qualifiedId: "tasks/review", state: "review" }),
      task({ id: "running", qualifiedId: "tasks/running", state: "in-progress" }),
      task({ id: "planned-b", qualifiedId: "tasks/planned-b", state: "planned" }),
      task({ id: "done", qualifiedId: "tasks/done", state: "done" }),
      task({ id: "blocked", qualifiedId: "tasks/blocked", state: "blocked" }),
      task({ id: "draft", qualifiedId: "tasks/draft", state: "draft" })
    ];
    const config = buildMaestroExplorerConfig({
      tasks,
      taskList: taskList(),
      onRefresh: async () => []
    });

    await expect(config.rows()).resolves.toEqual([
      {
        id: "tasks/running",
        title: "running",
        subtitle: "tasks · tasks/running",
        badge: { text: "in-progress", tone: "warning" },
        group: "in-progress"
      },
      {
        id: "tasks/planned-a",
        title: "planned-a",
        subtitle: "tasks · tasks/planned-a",
        badge: { text: "planned", tone: "info" },
        group: "planned"
      },
      {
        id: "tasks/planned-b",
        title: "planned-b",
        subtitle: "tasks · tasks/planned-b",
        badge: { text: "planned", tone: "info" },
        group: "planned"
      },
      {
        id: "tasks/draft",
        title: "draft",
        subtitle: "tasks · tasks/draft",
        badge: { text: "draft", tone: "muted" },
        group: "draft"
      },
      {
        id: "tasks/done",
        title: "done",
        subtitle: "tasks · tasks/done",
        badge: { text: "done", tone: "success" },
        group: "done"
      },
      {
        id: "tasks/archived",
        title: "archived",
        subtitle: "tasks · tasks/archived",
        badge: { text: "archived", tone: "muted" },
        group: "archived"
      },
      {
        id: "tasks/blocked",
        title: "blocked",
        subtitle: "tasks · tasks/blocked",
        badge: { text: "blocked", tone: "info" },
        group: "blocked"
      },
      {
        id: "tasks/review",
        title: "review",
        subtitle: "tasks · tasks/review",
        badge: { text: "review", tone: "info" },
        group: "review"
      }
    ]);
    expect(config.title).toBe("Maestro tasks");
    expect(config.emptyHint).toBe("No tasks found");
    expect(config.multiSelect).toBe(false);
    expect(config.actions).toEqual([
      expect.objectContaining({
        id: "move-state",
        key: "f",
        label: "Move to state…",
        primary: true
      }),
      expect.objectContaining({
        id: "open-source",
        key: "o",
        label: "Open in $EDITOR"
      })
    ]);
  });

  it("refreshes rows from onRefresh", async () => {
    const refreshed = task({ id: "fresh", qualifiedId: "tasks/fresh", state: "done" });
    const onRefresh = vi.fn(async () => [refreshed]);
    const config = buildMaestroExplorerConfig({
      tasks: [task({ id: "old", qualifiedId: "tasks/old" })],
      taskList: taskList(),
      onRefresh
    });

    await config.refresh!();

    await expect(config.rows()).resolves.toEqual([
      expect.objectContaining({ id: "tasks/fresh", group: "done" })
    ]);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("registers reorder and persists changed intra-list order with backend-local ids", async () => {
    const list = taskList();
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({ id: "a", qualifiedId: "work/a", list: "work", state: "planned" }),
        task({ id: "b", qualifiedId: "work/b", list: "work", state: "planned" }),
        task({ id: "c", qualifiedId: "bugs/c", list: "bugs", state: "planned" }),
        task({ id: "d", qualifiedId: "bugs/d", list: "bugs", state: "done" })
      ],
      taskList: list,
      onRefresh: async () => []
    });

    await config.reorder?.onReorder(["bugs/c", "work/b", "work/a", "bugs/d"], {
      refresh: vi.fn(async () => undefined),
      toast: vi.fn()
    });

    expect(list.list("work").reorder).toHaveBeenCalledWith(["b", "a"]);
    expect(list.list("bugs").reorder).not.toHaveBeenCalled();
  });

  it("reorders lists without changing task state when rows cross visual state groups", async () => {
    const list = taskList();
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({ id: "planned", qualifiedId: "work/planned", list: "work", state: "planned" }),
        task({ id: "draft", qualifiedId: "work/draft", list: "work", state: "draft" })
      ],
      taskList: list,
      onRefresh: async () => []
    });

    await config.reorder?.onReorder(["work/draft", "work/planned"], {
      refresh: vi.fn(async () => undefined),
      toast: vi.fn()
    });

    expect(list.list("work").reorder).toHaveBeenCalledWith(["draft", "planned"]);
    expect(list.list("work").fire).not.toHaveBeenCalled();
    expect(list.list("work").update).not.toHaveBeenCalled();
  });

  it("toasts and refreshes from taskList.allTasks when reorder rejects an order mismatch", async () => {
    const recovered = task({ id: "fresh", qualifiedId: "work/fresh", list: "work", state: "done" });
    const list = taskList({
      allTasks: [recovered],
      reorderErrors: {
        work: new OrderMismatchError({ missing: ["fresh"], extra: ["stale"] })
      }
    });
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({ id: "stale", qualifiedId: "work/stale", list: "work", state: "planned" }),
        task({ id: "other", qualifiedId: "work/other", list: "work", state: "planned" })
      ],
      taskList: list,
      onRefresh: async () => []
    });
    const refresh = vi.fn(async () => {
      await config.refresh?.();
    });
    const toast = vi.fn();

    await config.reorder?.onReorder(["work/other", "work/stale"], { refresh, toast });

    expect(toast).toHaveBeenCalledWith(
      'reorder requires the exact set of active task ids: missing "fresh"; extra "stale".',
      "error"
    );
    expect(list.allTasks).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    await expect(config.rows()).resolves.toEqual([
      expect.objectContaining({ id: "work/fresh", group: "done" })
    ]);
  });

  it("renders task details, metadata, and available next events", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          id: "ship",
          qualifiedId: "work/ship",
          list: "work",
          name: "Ship feature",
          state: "planned",
          description: "Use **markdown**.",
          metadata: { priority: "high", tags: ["ui"] }
        })
      ],
      taskList: taskList({ events: { "work/ship": ["start", "archive"] } }),
      onRefresh: async () => []
    });

    await expect(renderDetail(config)).resolves.toBe(
      [
        "# Ship feature",
        "",
        "**State:** planned",
        "",
        "Use **markdown**.",
        "",
        "## Metadata",
        "",
        "```yaml",
        "priority: high",
        "tags:",
        "  - ui",
        "```",
        "",
        "## Next",
        "",
        "- start",
        "- archive"
      ].join("\n")
    );
  });

  it("renders fallback detail text for empty descriptions and terminal states", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [task({ description: "", metadata: {} })],
      taskList: taskList(),
      onRefresh: async () => []
    });

    const markdown = await renderDetail(config);

    expect(markdown).toContain("_No description._");
    expect(markdown).toContain("_Terminal state — no events available._");
  });

  it("renders event loading errors in the detail pane", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [task({ qualifiedId: "tasks/boom", id: "boom" })],
      taskList: taskList({ eventErrors: { "tasks/boom": new Error("offline") } }),
      onRefresh: async () => []
    });

    await expect(renderDetail(config)).resolves.toContain("_Could not load events: offline_");
  });

  it("returns no detail items when detail loading is aborted", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [task()],
      taskList: taskList({ events: { "tasks/ship": ["start"] } }),
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const controller = new AbortController();
    controller.abort();

    await expect(
      config.detail.items(row!, {
        width: 80,
        height: 20,
        signal: controller.signal,
        row: row!
      })
    ).resolves.toEqual([]);
  });

  it("returns no detail items when detail loading is aborted while events are loading", async () => {
    let resolveEvents: (events: readonly string[]) => void = () => undefined;
    const pendingEvents = new Promise<readonly string[]>((resolve) => {
      resolveEvents = resolve;
    });
    const config = buildMaestroExplorerConfig({
      tasks: [task()],
      taskList: taskList({ events: { "tasks/ship": pendingEvents } }),
      onRefresh: async () => []
    });
    const row = {
      id: "tasks/ship",
      title: "ship",
      subtitle: "tasks · tasks/ship",
      badge: { text: "planned", tone: "info" },
      group: "planned"
    } as const satisfies Row;
    const controller = new AbortController();

    const pendingItems = config.detail.items(row, {
      width: 80,
      height: 20,
      signal: controller.signal,
      row
    });
    controller.abort();

    await expect(pendingItems).resolves.toEqual([]);
    resolveEvents(["start"]);
  });

  it("shows the move-state action only when cached row events are available", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({ id: "ship", qualifiedId: "tasks/ship" }),
        task({ id: "done", qualifiedId: "tasks/done", state: "done" })
      ],
      taskList: taskList({ events: { "tasks/ship": ["start"] } }),
      onRefresh: async () => []
    });
    const [shipRow, doneRow] = await config.rows();
    const action = moveStateAction(config);

    expect(action.predicate?.(actionCtx(shipRow!))).toBe(true);
    expect(action.predicate?.(actionCtx(doneRow!))).toBe(false);
  });

  it("updates the move-state predicate event cache after refresh", async () => {
    const refreshed = task({ id: "done", qualifiedId: "tasks/done", state: "done" });
    const config = buildMaestroExplorerConfig({
      tasks: [task({ id: "ship", qualifiedId: "tasks/ship" })],
      taskList: taskList({ events: { "tasks/ship": ["start"] } }),
      onRefresh: async () => [refreshed]
    });
    const [initialRow] = await config.rows();
    const action = moveStateAction(config);

    expect(action.predicate?.(actionCtx(initialRow!))).toBe(true);

    await config.refresh!();
    const [refreshedRow] = await config.rows();

    expect(action.predicate?.(actionCtx(refreshedRow!))).toBe(false);
  });

  it("shows the open-source action only when a cached task has sourcePath", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          id: "file",
          qualifiedId: "tasks/file",
          sourcePath: "/repo/tasks/file.md"
        }),
        task({ id: "remote", qualifiedId: "tasks/remote" }),
        task({
          id: "null",
          qualifiedId: "tasks/null",
          sourcePath: null
        } as unknown as Partial<Task>)
      ],
      taskList: taskList(),
      variables: {},
      onRefresh: async () => []
    });
    const [fileRow, remoteRow, nullRow] = await config.rows();
    const action = openSourceAction(config);

    expect(action.predicate?.(actionCtx(fileRow!))).toBe(true);
    expect(action.predicate?.(actionCtx(nullRow!))).toBe(false);
    expect(action.predicate?.(actionCtx(remoteRow!))).toBe(false);
  });

  it("opens the refreshed sourcePath from the cached row map", async () => {
    const variables = { EDITOR: "code" };
    const refreshed = task({
      id: "file",
      qualifiedId: "tasks/file",
      sourcePath: "/repo/tasks/refreshed.md"
    });
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          id: "file",
          qualifiedId: "tasks/file",
          sourcePath: "/repo/tasks/original.md"
        })
      ],
      taskList: taskList(),
      variables,
      onRefresh: async () => [refreshed]
    });

    await config.refresh!();
    const [row] = await config.rows();
    const ctx = actionCtx(row!);

    await openSourceAction(config).handler(ctx);

    expect(editFileMock).toHaveBeenCalledWith("/repo/tasks/refreshed.md", { env: variables });
    expect(ctx.toast).toHaveBeenCalledWith("Edited tasks/file", "info");
  });

  it("opens a task source file through suspendAnd, refreshes, and shows an info toast", async () => {
    const variables = { EDITOR: "code" };
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          id: "file",
          qualifiedId: "tasks/file",
          sourcePath: "/repo/tasks/file.md"
        })
      ],
      taskList: taskList(),
      variables,
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const ctx = actionCtx(row!);

    await openSourceAction(config).handler(ctx);

    expect(ctx.suspendAnd).toHaveBeenCalledOnce();
    expect(editFileMock).toHaveBeenCalledWith("/repo/tasks/file.md", { env: variables });
    expect(ctx.refresh).toHaveBeenCalledOnce();
    expect(ctx.toast).toHaveBeenCalledWith("Edited tasks/file", "info");
  });

  it("moves a task by prompting for an event and firing it", async () => {
    vi.mocked(select).mockResolvedValue({ event: "archive", targetState: "archived" });
    const list = taskList({
      events: { "work/ship": ["start", "archive"] },
      stateMachine: workflowMachine
    });
    const config = buildMaestroExplorerConfig({
      tasks: [task({ id: "ship", qualifiedId: "work/ship", list: "work" })],
      taskList: list,
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const ctx = actionCtx(row!);

    await moveStateAction(config).handler(ctx);

    expect(select).toHaveBeenCalledWith({
      message: "Move task to state",
      options: [
        {
          value: { event: "start", targetState: "in-progress" },
          label: "start    → in-progress"
        },
        {
          value: { event: "archive", targetState: "archived" },
          label: "archive    → archived"
        }
      ]
    });
    expect(list.list("work").fire).toHaveBeenCalledWith("ship", "archive");
    expect(ctx.refresh).toHaveBeenCalledOnce();
    expect(ctx.toast).toHaveBeenCalledWith("Moved to archived", "info");
  });

  it("returns silently when move-state selection is cancelled", async () => {
    vi.mocked(select).mockResolvedValue(cancelSelection);
    const list = taskList({
      events: { "work/ship": ["archive"] },
      stateMachine: workflowMachine
    });
    const config = buildMaestroExplorerConfig({
      tasks: [task({ id: "ship", qualifiedId: "work/ship", list: "work" })],
      taskList: list,
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const ctx = actionCtx(row!);

    await moveStateAction(config).handler(ctx);

    expect(list.list("work").fire).not.toHaveBeenCalled();
    expect(ctx.refresh).not.toHaveBeenCalled();
    expect(ctx.toast).not.toHaveBeenCalled();
  });

  it("shows an info toast when move-state has no current events", async () => {
    const list = taskList({ stateMachine: workflowMachine });
    const config = buildMaestroExplorerConfig({
      tasks: [task({ id: "ship", qualifiedId: "work/ship", list: "work" })],
      taskList: list,
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const ctx = actionCtx(row!);

    await moveStateAction(config).handler(ctx);

    expect(select).not.toHaveBeenCalled();
    expect(list.list("work").fire).not.toHaveBeenCalled();
    expect(ctx.toast).toHaveBeenCalledWith("No state moves available.", "info");
  });

  it("shows invalid transition reasons without refreshing", async () => {
    vi.mocked(select).mockResolvedValue({ event: "archive", targetState: "archived" });
    const list = taskList({
      events: { "work/ship": ["archive"] },
      fireErrors: {
        "work/ship:archive": new InvalidTransitionError({ reason: "Cannot archive yet." })
      },
      stateMachine: workflowMachine
    });
    const config = buildMaestroExplorerConfig({
      tasks: [task({ id: "ship", qualifiedId: "work/ship", list: "work" })],
      taskList: list,
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const ctx = actionCtx(row!);

    await moveStateAction(config).handler(ctx);

    expect(ctx.toast).toHaveBeenCalledWith("Cannot archive yet.", "error");
    expect(ctx.refresh).not.toHaveBeenCalled();
  });
});
