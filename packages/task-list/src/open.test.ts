import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backendFactories, openTaskList } from "./open.js";
import type { TaskList, TaskListFs } from "./types.js";

function createFs(files: Record<string, string> = {}): TaskListFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as TaskListFs;
}

function createTaskList(): TaskList {
  return {
    list: () => {
      throw new Error("unused in test");
    },
    lists: async () => [],
    allTasks: async () => [],
    get: async () => {
      throw new Error("unused in test");
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openTaskList", () => {
  it('uses the "markdown-dir" placeholder backend by default', async () => {
    await expect(
      openTaskList({
        type: "markdown-dir",
        path: "/repo/tasks"
      })
    ).rejects.toThrow("not yet implemented");
  });

  it('routes "markdown-dir" to the markdown backend factory', async () => {
    const taskList = createTaskList();
    const fs = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await expect(
      openTaskList({
        type: "markdown-dir",
        path: "/repo/tasks",
        fs
      })
    ).resolves.toBe(taskList);

    expect(spy).toHaveBeenCalledWith({
      path: "/repo/tasks",
      defaults: {
        state: "draft",
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });
  });

  it('uses the "yaml-file" placeholder backend by default', async () => {
    await expect(
      openTaskList({
        type: "yaml-file",
        path: "/repo/tasks.yaml"
      })
    ).rejects.toThrow("not yet implemented");
  });

  it('routes "yaml-file" to the yaml backend factory', async () => {
    const taskList = createTaskList();
    const spy = vi.spyOn(backendFactories, "yaml-file").mockResolvedValue(taskList);

    await expect(
      openTaskList({
        type: "yaml-file",
        path: "/repo/tasks.yaml"
      })
    ).resolves.toBe(taskList);

    expect(spy).toHaveBeenCalledOnce();
  });

  it("throws for an unknown backend type", async () => {
    await expect(
      openTaskList({
        type: "sqlite" as never,
        path: "/repo/tasks.db"
      })
    ).rejects.toThrow('Unknown task list backend type "sqlite".');
  });

  it("normalizes missing defaults", async () => {
    const taskList = createTaskList();
    const fs = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      defaults: {},
      fs
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: {
          state: "draft",
          metadata: {}
        }
      })
    );
  });

  it("preserves provided defaults", async () => {
    const taskList = createTaskList();
    const fs = createFs();
    const spy = vi.spyOn(backendFactories, "yaml-file").mockResolvedValue(taskList);
    const metadata = {
      owner: "kj"
    };

    await openTaskList({
      type: "yaml-file",
      path: "/repo/tasks.yaml",
      defaults: {
        state: "planned",
        metadata
      },
      fs
    });

    metadata.owner = "changed";

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: {
          state: "planned",
          metadata: {
            owner: "kj"
          }
        }
      })
    );
  });

  it("passes through explicit create and lock overrides", async () => {
    const taskList = createTaskList();
    const fs = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      create: true,
      lockStaleMs: 90_000,
      lockRetries: 7,
      fs
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        create: true,
        lockStaleMs: 90_000,
        lockRetries: 7
      })
    );
  });
});
