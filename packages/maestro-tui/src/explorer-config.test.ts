import { describe, expect, it, vi } from "vitest";
import type { Task, TaskList, Tasks } from "@poe-code/task-list";
import { buildMaestroExplorerConfig } from "./explorer-config.js";

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
} = {}): TaskList {
  return {
    list: (name) => tasks(name, options),
    lists: vi.fn(async () => ["tasks"]),
    allTasks: vi.fn(async () => []),
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
  }
): Tasks {
  return {
    name,
    stateMachine: { states: ["draft"], initial: "draft", events: {} },
    all: vi.fn(async () => []),
    get: vi.fn(async (id) => task({ list: name, id })),
    create: vi.fn(async (input) => task({ list: name, name: input.name })),
    update: vi.fn(async (id, patch) => task({ list: name, id, ...patch })),
    fire: vi.fn(async (id) => task({ list: name, id })),
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
    reorder: vi.fn(async () => [])
  };
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
    expect(config.actions).toEqual([]);
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
    const [row] = await config.rows();
    const controller = new AbortController();

    const pendingItems = config.detail.items(row!, {
      width: 80,
      height: 20,
      signal: controller.signal,
      row: row!
    });
    controller.abort();

    await expect(pendingItems).resolves.toEqual([]);
    resolveEvents(["start"]);
  });
});
