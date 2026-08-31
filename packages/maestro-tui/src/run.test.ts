import { beforeEach, describe, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
import type { ExplorerConfig } from "toolcraft-design";
import type { OpenTaskListOptions, Task, TaskList } from "@poe-code/task-list";
import { runMaestroTui } from "./run.js";

const { editFileMock, openTaskListMock, runExplorerMock } = vi.hoisted(() => ({
  editFileMock: vi.fn(),
  openTaskListMock: vi.fn(),
  runExplorerMock: vi.fn()
}));

vi.mock("node:fs/promises", async () => ({
  ...fs.promises,
  default: fs.promises
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    runExplorer: runExplorerMock
  };
});

vi.mock("@poe-code/plan-browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/plan-browser")>();
  return {
    ...actual,
    editFile: editFileMock
  };
});

vi.mock("@poe-code/task-list", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/task-list")>();
  return {
    ...actual,
    openTaskList: openTaskListMock
  };
});

function task(overrides: Partial<Task> = {}): Task {
  return {
    list: "tasks",
    id: "ship",
    qualifiedId: "tasks/ship",
    name: "Ship feature",
    state: "planned",
    description: "Build the thing.",
    metadata: {},
    ...overrides
  };
}

function taskList(tasks: readonly Task[]): TaskList {
  return {
    list: () => ({
      name: "tasks",
      stateMachine: { states: ["planned"], initial: "planned", events: {} },
      all: vi.fn(async () => [...tasks]),
      get: vi.fn(async () => task()),
      create: vi.fn(async () => task()),
      update: vi.fn(async () => task()),
      fire: vi.fn(async () => task()),
      canFire: vi.fn(async () => true),
      events: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
      move: vi.fn(async () => task()),
      reorder: vi.fn(async () => [])
    }),
    lists: vi.fn(async () => ["tasks"]),
    allTasks: vi.fn(async () => [...tasks]),
    get: vi.fn(async () => task()),
    moveBetweenLists: vi.fn(async () => task())
  };
}

function workflowFrontmatter(lines: readonly string[]): string {
  return ["---", ...lines, "---", "", "Work on {{ task.name }}."].join("\n");
}

describe("runMaestroTui", () => {
  beforeEach(() => {
    vol.reset();
    editFileMock.mockReset();
    openTaskListMock.mockReset();
    runExplorerMock.mockReset();
    runExplorerMock.mockResolvedValue(null);
  });

  it("uses a prebuilt task list and passes the initial snapshot to the explorer", async () => {
    const initialTask = task();
    const tasks = taskList([initialTask]);
    const variables = { EDITOR: "code", EMPTY: undefined };

    await runMaestroTui({ taskList: tasks, variables });

    expect(openTaskListMock).not.toHaveBeenCalled();
    expect(tasks.allTasks).toHaveBeenCalledTimes(1);
    expect(runExplorerMock).toHaveBeenCalledOnce();

    const config = runExplorerMock.mock.calls[0]?.[0] as ExplorerConfig<void>;
    await expect(config.rows()).resolves.toEqual([
      expect.objectContaining({
        id: initialTask.qualifiedId,
        title: initialTask.name
      })
    ]);
  });

  it("uses the same task-list reader for refreshes", async () => {
    const first = task({ id: "first", qualifiedId: "tasks/first", name: "First" });
    const second = task({ id: "second", qualifiedId: "tasks/second", name: "Second" });
    const tasks = taskList([]);
    vi.mocked(tasks.allTasks).mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);

    await runMaestroTui({ taskList: tasks, variables: {} });

    const config = runExplorerMock.mock.calls[0]?.[0] as ExplorerConfig<void>;
    await expect(config.rows()).resolves.toEqual([
      expect.objectContaining({ id: "tasks/first", title: "First" })
    ]);
    expect(tasks.allTasks).toHaveBeenCalledTimes(1);

    await config.refresh?.();

    expect(tasks.allTasks).toHaveBeenCalledTimes(2);
    await expect(config.rows()).resolves.toEqual([
      expect.objectContaining({ id: "tasks/second", title: "Second" })
    ]);
  });

  it("defaults action variables to process.env", async () => {
    const previousEditor = process.env.EDITOR;
    process.env.EDITOR = "test-editor";
    const sourceTask = task({ sourcePath: "/repo/tasks/ship.md" });
    const tasks = taskList([sourceTask]);

    try {
      await runMaestroTui({ taskList: tasks });

      const config = runExplorerMock.mock.calls[0]?.[0] as ExplorerConfig<void>;
      const openSource = config.actions.find((action) => action.id === "open-source");
      expect(openSource).toBeDefined();
      await openSource?.handler({
        row: { id: sourceTask.qualifiedId, title: sourceTask.name },
        rows: [],
        filter: "",
        refresh: vi.fn(async () => undefined),
        suspendAnd: async (fn) => fn(),
        toast: vi.fn(),
        confirm: vi.fn(async () => true),
        promptText: vi.fn(async () => null),
        exit: vi.fn()
      });

      expect(editFileMock).toHaveBeenCalledWith("/repo/tasks/ship.md", {
        env: expect.objectContaining({ EDITOR: "test-editor" })
      });
    } finally {
      if (previousEditor === undefined) {
        delete process.env.EDITOR;
      } else {
        process.env.EDITOR = previousEditor;
      }
    }
  });

  it("loads the configured workflow task list when no task list is provided", async () => {
    const tasks = taskList([task({ id: "loaded", qualifiedId: "tasks/loaded" })]);
    openTaskListMock.mockResolvedValue(tasks);
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter([
        "tasks:",
        "  type: yaml-file",
        "  path: tasks.yaml",
        "states:",
        "  planned:",
        "    prompt: Start.",
        "  done:",
        "    terminal: true"
      ])
    });

    await runMaestroTui({ workflowPath: "/repo/WORKFLOW.md" });

    expect(openTaskListMock).toHaveBeenCalledWith({
      type: "yaml-file",
      path: "/repo/tasks.yaml",
      stateMachine: {
        initial: "planned",
        states: ["planned", "done"],
        events: {
          planned: { from: [], to: "planned" },
          done: { from: ["planned"], to: "done" }
        }
      }
    } satisfies OpenTaskListOptions);
    expect(tasks.allTasks).toHaveBeenCalledTimes(1);
    expect(runExplorerMock).toHaveBeenCalledOnce();
  });

  it("loads a named workflow from the repository root", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const tasks = taskList([task({ id: "loaded", qualifiedId: "tasks/loaded" })]);
    openTaskListMock.mockResolvedValue(tasks);
    vol.fromJSON({
      "/repo/BUGS.WORKFLOW.md": workflowFrontmatter([
        "tasks:",
        "  type: yaml-file",
        "  path: tasks.yaml",
        "states:",
        "  planned:",
        "    prompt: Start.",
        "  done:",
        "    terminal: true"
      ])
    });

    try {
      await runMaestroTui({ name: "bugs" });

      expect(openTaskListMock).toHaveBeenCalledOnce();
      expect(runExplorerMock).toHaveBeenCalledOnce();
    } finally {
      cwd.mockRestore();
    }
  });

  it("loads the default named workflow from the repository root", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const tasks = taskList([task({ id: "loaded", qualifiedId: "tasks/loaded" })]);
    openTaskListMock.mockResolvedValue(tasks);
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter([
        "tasks:",
        "  type: yaml-file",
        "  path: tasks.yaml",
        "states:",
        "  planned:",
        "    prompt: Start.",
        "  done:",
        "    terminal: true"
      ])
    });

    try {
      await runMaestroTui({ name: "default" });

      expect(openTaskListMock).toHaveBeenCalledOnce();
      expect(runExplorerMock).toHaveBeenCalledOnce();
    } finally {
      cwd.mockRestore();
    }
  });

  it("rejects both a workflow path and a workflow name", async () => {

    await expect(
      runMaestroTui({ workflowPath: "/repo/WORKFLOW.md", name: "bugs" })
    ).rejects.toThrow("Cannot specify both workflowPath and name for Maestro.");
  });

  it("reports a missing named workflow file", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/repo");

    try {
      await expect(runMaestroTui({ name: "bugs" })).rejects.toThrow(
        "Missing workflow file at /repo/BUGS.WORKFLOW.md."
      );
    } finally {
      cwd.mockRestore();
    }
  });

  it("rejects workflow configs without task-list settings before opening the explorer", async () => {
    vol.fromJSON({
      "/repo/WORKFLOW.md": workflowFrontmatter(["states:", "  planned:", "    prompt: Start."])
    });

    await expect(runMaestroTui({ workflowPath: "/repo/WORKFLOW.md" })).rejects.toThrow(
      "Maestro workflow is missing tasks config."
    );
    expect(openTaskListMock).not.toHaveBeenCalled();
    expect(runExplorerMock).not.toHaveBeenCalled();
  });
});
