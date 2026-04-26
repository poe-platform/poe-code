import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateMachineDef } from "./state-machine.js";
import { backendFactories, openTaskList } from "./open.js";
import { defaultStateMachine } from "./state.js";
import { createFs } from "./backends/test-helpers.js";
import type { OpenTaskListOptions, TaskList } from "./types.js";

const BACKENDS = [
  {
    name: "markdown-dir",
    type: "markdown-dir",
    path: "/repo/tasks"
  },
  {
    name: "yaml-file",
    type: "yaml-file",
    path: "/repo/tasks.yaml"
  }
] as const satisfies ReadonlyArray<{
  name: string;
  type: OpenTaskListOptions["type"];
  path: string;
}>;

type ApprovalState = "pending" | "running" | "done";
type ApprovalEvent = "start" | "finish";

function createApprovalMachine(): StateMachineDef<ApprovalState, ApprovalEvent> {
  return {
    initial: "pending",
    states: ["pending", "running", "done"],
    events: {
      start: { from: ["pending"], to: "running" },
      finish: { from: ["running"], to: "done" }
    }
  };
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
  it('routes "markdown-dir" to the markdown backend factory', async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
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
      fs,
      stateMachine: defaultStateMachine
    });
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

    expect(spy).toHaveBeenCalledWith({
      path: "/repo/tasks.yaml",
      defaults: {
        state: "draft",
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs: expect.any(Object),
      stateMachine: defaultStateMachine
    });
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
    const { fs } = createFs();
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
    const { fs } = createFs();
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
    const { fs } = createFs();
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

  for (const backend of BACKENDS) {
    it(`uses the default state machine for ${backend.name} when none is passed`, async () => {
      const { fs } = createFs();
      const taskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs
      });
      const tasks = taskList.list("planning");

      expect(tasks.stateMachine).toBe(defaultStateMachine);

      await expect(
        tasks.create({
          id: "ship",
          name: "Ship",
          state: "draft"
        })
      ).resolves.toMatchObject({
        state: "draft"
      });

      await expect(tasks.fire("ship", "plan")).resolves.toMatchObject({
        state: "planned"
      });
      await expect(tasks.fire("ship", "start")).resolves.toMatchObject({
        state: "in-progress"
      });
      await expect(tasks.fire("ship", "complete")).resolves.toMatchObject({
        state: "done"
      });
      await expect(tasks.events("ship")).resolves.toEqual(["archive"]);
      await expect(tasks.fire("ship", "archive")).resolves.toMatchObject({
        state: "archived"
      });
    });

    it(`uses the provided state machine for ${backend.name} and exposes it by reference`, async () => {
      const { fs } = createFs();
      const stateMachine = createApprovalMachine();
      const taskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs,
        stateMachine
      });
      const tasks = taskList.list("approvals");

      expect(tasks.stateMachine).toBe(stateMachine);

      await expect(
        tasks.create({
          id: "approval",
          name: "Approval",
          state: "pending"
        })
      ).resolves.toMatchObject({
        state: "pending"
      });

      await expect(tasks.events("approval")).resolves.toEqual(["start"]);
      await expect(tasks.fire("approval", "start")).resolves.toMatchObject({
        state: "running"
      });
      await expect(tasks.fire("approval", "finish")).resolves.toMatchObject({
        state: "done"
      });
    });

    it(`validates task.state against the configured machine for ${backend.name}`, async () => {
      const defaultFs = createFs();
      const defaultTaskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs: defaultFs.fs
      });

      await expect(
        defaultTaskList.list("planning").create({
          id: "invalid-default",
          name: "Invalid default",
          state: "pending"
        })
      ).rejects.toThrow('Invalid task state "pending".');

      const customFs = createFs();
      const customMachine = createApprovalMachine();
      const customTaskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs: customFs.fs,
        stateMachine: customMachine
      });

      await expect(
        customTaskList.list("approvals").create({
          id: "valid-custom",
          name: "Valid custom",
          state: "pending"
        })
      ).resolves.toMatchObject({
        state: "pending"
      });
    });

    it(`uses the configured machine states for transition() in ${backend.name}`, async () => {
      const { fs } = createFs();
      const stateMachine = createApprovalMachine();
      const taskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs,
        defaults: {
          state: "pending"
        },
        stateMachine
      });
      const tasks = taskList.list("approvals");

      await expect(
        tasks.create({
          id: "approval",
          name: "Approval"
        })
      ).resolves.toMatchObject({
        state: "pending"
      });

      await expect(tasks.transition("approval", "running")).resolves.toMatchObject({
        state: "running"
      });
      await expect(tasks.transition("approval", "archived")).rejects.toThrow(
        'Invalid task state "archived".'
      );
    });
  }
});
