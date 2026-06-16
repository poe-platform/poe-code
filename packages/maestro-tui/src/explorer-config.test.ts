import { beforeEach, describe, expect, it, vi } from "vitest";
import { type StateMachineDef, type Task, type TaskList, type Tasks } from "@poe-code/task-list";
import { type Action, type ActionContext, type Row } from "toolcraft-design";
import {
  buildMaestroExplorerConfig as buildMaestroExplorerConfigBase,
  type BuildMaestroExplorerConfigOptions
} from "./explorer-config.js";

const { editFileMock, openExternalMock } = vi.hoisted(() => ({
  editFileMock: vi.fn(),
  openExternalMock: vi.fn()
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    openExternal: openExternalMock
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

function taskList(
  options: {
    events?: Record<string, Promise<readonly string[]> | readonly string[]>;
    eventErrors?: Record<string, unknown>;
    fireErrors?: Record<string, Error>;
    reorderErrors?: Record<string, Error>;
    allTasks?: readonly Task[];
    stateMachine?: StateMachineDef;
  } = {}
): TaskList {
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
    eventErrors?: Record<string, unknown>;
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

function openSourceAction(config: ReturnType<typeof buildMaestroExplorerConfig>): Action<void> {
  const action = config.actions.find((candidate) => candidate.id === "open-source");
  if (action === undefined) {
    throw new Error("Open source action was not registered.");
  }
  return action;
}

function openIssueAction(config: ReturnType<typeof buildMaestroExplorerConfig>): Action<void> {
  const action = config.actions.find((candidate) => candidate.id === "open-issue");
  if (action === undefined) {
    throw new Error("Open issue action was not registered.");
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
    editFileMock.mockReset();
    openExternalMock.mockReset();
    openExternalMock.mockResolvedValue(undefined);
  });

  it("exposes only read-only actions and no reorder mutation", () => {
    const config = buildMaestroExplorerConfig({
      tasks: [task()],
      taskList: taskList(),
      onRefresh: async () => []
    });

    expect(config.actions.map((action) => action.id)).toEqual(["open-source", "open-issue"]);
    expect(config.reorder).toBeUndefined();
  });

  it("rejects duplicate qualified task identities", () => {
    expect(() =>
      buildMaestroExplorerConfig({
        tasks: [
          task({ name: "first", qualifiedId: "tasks/collision" }),
          task({ name: "second", qualifiedId: "tasks/collision" })
        ],
        taskList: taskList(),
        onRefresh: async () => []
      })
    ).toThrow("Duplicate task qualifiedId: tasks/collision");
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
        id: "open-source",
        key: "o",
        label: "Open in $EDITOR"
      }),
      expect.objectContaining({
        id: "open-issue",
        key: "g",
        label: "Open issue in browser"
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

  it("renders non-Error event loading rejections in the detail pane", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [task({ qualifiedId: "tasks/boom", id: "boom" })],
      taskList: taskList({ eventErrors: { "tasks/boom": "offline" } }),
      onRefresh: async () => []
    });

    await expect(renderDetail(config)).resolves.toContain("_Could not load events: offline_");
  });

  it("uses a metadata fence that cannot be closed by metadata contents", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          metadata: {
            note: "before\n```\n# injected\n```\nafter"
          }
        })
      ],
      taskList: taskList(),
      onRefresh: async () => []
    });

    await expect(renderDetail(config)).resolves.toContain(
      [
        "## Metadata",
        "",
        "````yaml",
        "note: |-",
        "  before",
        "  ```",
        "  # injected",
        "  ```",
        "  after",
        "````"
      ].join("\n")
    );
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
        } as unknown as Partial<Task>),
        task({
          id: "empty",
          qualifiedId: "tasks/empty",
          sourcePath: ""
        }),
        task({
          id: "blank",
          qualifiedId: "tasks/blank",
          sourcePath: " \n "
        })
      ],
      taskList: taskList(),
      variables: {},
      onRefresh: async () => []
    });
    const rowsById = new Map((await config.rows()).map((row) => [row.id, row]));
    const action = openSourceAction(config);

    expect(action.predicate?.(actionCtx(rowsById.get("tasks/file")!))).toBe(true);
    expect(action.predicate?.(actionCtx(rowsById.get("tasks/empty")!))).toBe(false);
    expect(action.predicate?.(actionCtx(rowsById.get("tasks/blank")!))).toBe(false);
    expect(action.predicate?.(actionCtx(rowsById.get("tasks/remote")!))).toBe(false);
    expect(action.predicate?.(actionCtx(rowsById.get("tasks/null")!))).toBe(false);
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

  it("shows the open-issue action only when a cached task has an http metadata url", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          id: "issue",
          qualifiedId: "tasks/issue",
          metadata: { url: "https://github.example.test/octo/repo/issues/1" }
        }),
        task({
          id: "file",
          qualifiedId: "tasks/file",
          metadata: { url: "file:///repo/tasks/file.md" }
        }),
        task({
          id: "custom",
          qualifiedId: "tasks/custom",
          metadata: { url: "httpx:run-untrusted-handler" }
        }),
        task({
          id: "empty",
          qualifiedId: "tasks/empty",
          metadata: { url: "" }
        }),
        task({
          id: "object",
          qualifiedId: "tasks/object",
          metadata: { url: { href: "https://github.example.test/octo/repo/issues/2" } }
        }),
        task({
          id: "missing",
          qualifiedId: "tasks/missing",
          metadata: {}
        })
      ],
      taskList: taskList(),
      onRefresh: async () => []
    });
    const [issueRow, fileRow, customRow, emptyRow, objectRow, missingRow] = await config.rows();
    const action = openIssueAction(config);

    expect(action.predicate?.(actionCtx(issueRow!))).toBe(true);
    expect(action.predicate?.(actionCtx(fileRow!))).toBe(false);
    expect(action.predicate?.(actionCtx(customRow!))).toBe(false);
    expect(action.predicate?.(actionCtx(emptyRow!))).toBe(false);
    expect(action.predicate?.(actionCtx(objectRow!))).toBe(false);
    expect(action.predicate?.(actionCtx(missingRow!))).toBe(false);
  });

  it("opens the issue url through suspendAnd and shows an info toast", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          id: "issue",
          qualifiedId: "tasks/issue",
          metadata: { url: "https://github.example.test/octo/repo/issues/1" }
        })
      ],
      taskList: taskList(),
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const ctx = actionCtx(row!);

    await openIssueAction(config).handler(ctx);

    expect(ctx.suspendAnd).toHaveBeenCalledOnce();
    expect(openExternalMock).toHaveBeenCalledWith("https://github.example.test/octo/repo/issues/1");
    expect(ctx.refresh).not.toHaveBeenCalled();
    expect(ctx.toast).toHaveBeenCalledWith("Opened tasks/issue", "info");
  });

  it("opens the trimmed issue url used by the action predicate", async () => {
    const config = buildMaestroExplorerConfig({
      tasks: [
        task({
          id: "issue",
          qualifiedId: "tasks/issue",
          metadata: { url: " https://github.example.test/octo/repo/issues/1\n" }
        })
      ],
      taskList: taskList(),
      onRefresh: async () => []
    });
    const [row] = await config.rows();
    const action = openIssueAction(config);
    const ctx = actionCtx(row!);

    expect(action.predicate?.(ctx)).toBe(true);

    await action.handler(ctx);

    expect(openExternalMock).toHaveBeenCalledWith("https://github.example.test/octo/repo/issues/1");
  });
});
