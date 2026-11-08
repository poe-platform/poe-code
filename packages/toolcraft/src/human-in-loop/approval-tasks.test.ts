import type {
  OpenTaskListOptions,
  StateMachineDef,
  TaskList,
  TaskListFs,
  Tasks
} from "@poe-code/task-list";
import { openTaskList, TaskAlreadyExistsError } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserError } from "../user-error.js";
import { ensureApprovalList, enqueueApproval, loadApproval } from "./approval-tasks.js";
import { approvalStateMachine } from "./state-machine.js";

type OtherState = "draft" | "done";
type OtherEvent = "finish";

function createMemFs(): TaskListFs {
  return createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as TaskListFs;
}

function createDifferentStateMachine(): StateMachineDef<OtherState, OtherEvent> {
  return {
    initial: "draft",
    states: ["draft", "done"],
    events: {
      finish: { from: ["draft"], to: "done" }
    }
  };
}

async function openApprovalTaskList(path: string, fs: TaskListFs): Promise<TaskList> {
  return openTaskList({
    type: "yaml-file",
    path,
    create: true,
    fs,
    stateMachine: approvalStateMachine
  });
}

describe("approval tasks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when async approvals are configured without a task list", async () => {
    await expect(ensureApprovalList(undefined)).rejects.toThrowError(
      new UserError("humanInLoop.taskList required for async-mode commands")
    );
  });

  it("uses a provided task-list instance directly", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml", createMemFs());

    const resolved = await ensureApprovalList({
      taskList,
      listName: "review-approvals"
    });

    expect(resolved.taskList).toBe(taskList);
    expect(resolved.listName).toBe("review-approvals");
    expect(resolved.tasks.name).toBe("review-approvals");
  });

  it("opens configured task-list directories once and memoizes the instance on runtime options", async () => {
    const fs = createMemFs();
    const runtimeOptions: Parameters<typeof ensureApprovalList>[0] = {
      taskList: {
        dir: "/repo/approvals.yaml",
        format: "yaml-file"
      }
    };
    const openTaskListMock = vi.fn(async (options: OpenTaskListOptions) =>
      openTaskList({
        ...options,
        create: true,
        fs
      })
    );

    const first = await ensureApprovalList(runtimeOptions, { openTaskList: openTaskListMock });
    const second = await ensureApprovalList(runtimeOptions, { openTaskList: openTaskListMock });

    expect(openTaskListMock).toHaveBeenCalledTimes(1);
    expect(openTaskListMock).toHaveBeenCalledWith({
      create: true,
      type: "yaml-file",
      path: "/repo/approvals.yaml",
      stateMachine: approvalStateMachine
    });
    expect(first.taskList).toBe(second.taskList);
    expect(first.listName).toBe("approvals");
    expect(first.tasks.stateMachine).toBe(approvalStateMachine);
  });

  it("opens configured task-list storage read-only without creating it", async () => {
    const runtimeOptions: Parameters<typeof ensureApprovalList>[0] = {
      taskList: {
        dir: "/repo/approvals.yaml",
        format: "yaml-file"
      }
    };
    const openTaskListMock = vi.fn(async (options: OpenTaskListOptions) => {
      throw Object.assign(new Error("missing"), { code: "ENOENT", options });
    });

    await expect(
      ensureApprovalList(runtimeOptions, { create: false, openTaskList: openTaskListMock })
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(openTaskListMock).toHaveBeenCalledWith({
      create: false,
      type: "yaml-file",
      path: "/repo/approvals.yaml",
      stateMachine: approvalStateMachine
    });
  });

  it("accepts task lists opened with a structurally equal approval state machine", async () => {
    const taskList = await openTaskList({
      type: "yaml-file",
      path: "/repo/approvals.yaml",
      create: true,
      fs: createMemFs(),
      stateMachine: {
        initial: approvalStateMachine.initial,
        states: [...approvalStateMachine.states],
        events: Object.fromEntries(
          Object.entries(approvalStateMachine.events).map(([eventName, eventDef]) => [
            eventName,
            {
              from: eventDef.from === "*" ? "*" : [...eventDef.from],
              to: eventDef.to
            }
          ])
        )
      }
    });

    const resolved = await ensureApprovalList({ taskList });

    expect(resolved.taskList).toBe(taskList);
    expect(resolved.tasks.stateMachine).not.toBe(approvalStateMachine);
  });

  it("throws when the configured task list uses a different state machine", async () => {
    const taskList = await openTaskList({
      type: "yaml-file",
      path: "/repo/approvals.yaml",
      create: true,
      fs: createMemFs(),
      stateMachine: createDifferentStateMachine()
    });

    await expect(
      ensureApprovalList(
        { taskList: { dir: "/repo/approvals.yaml", format: "yaml-file" } },
        {
          openTaskList: async () => taskList
        }
      )
    ).rejects.toThrowError(
      new UserError(
        "Approvals task list was created with a different version of toolcraft. Delete the task list directory (/repo/approvals.yaml) or pass a matching approvalStateMachine."
      )
    );
  });

  it("enqueues approvals and reloads the stored payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T13:22:09.000Z"));

    const taskList = await openApprovalTaskList("/repo/approvals.yaml", createMemFs());
    const tasks = taskList.list("approvals");

    const enqueued = await enqueueApproval({
      tasks,
      payload: {
        commandPath: "deploy.prod",
        params: { target: "prod" },
        message: "Deploy build to prod?",
        declineInputPrompt: "Why not?"
      }
    });

    expect(enqueued.approvalId).toMatch(/^2026-04-26T13-22-09-[0-9a-f]{6}$/);
    expect(enqueued.pending).toEqual({
      status: "pending-approval",
      approvalId: enqueued.approvalId,
      message: "Deploy build to prod?",
      enqueuedAt: "2026-04-26T13:22:09.000Z"
    });

    await expect(loadApproval({ tasks, approvalId: enqueued.approvalId })).resolves.toEqual({
      approvalId: enqueued.approvalId,
      commandPath: "deploy.prod",
      params: { target: "prod" },
      message: "Deploy build to prod?",
      declineInputPrompt: "Why not?",
      enqueuedAt: "2026-04-26T13:22:09.000Z",
      pid: null,
      result: null,
      error: null
    });
  });

  it("retries once when approval id creation collides", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T13:22:09.000Z"));

    const createMock = vi
      .fn<Tasks["create"]>()
      .mockRejectedValueOnce(new TaskAlreadyExistsError("Task already exists."))
      .mockImplementation(async (input) => ({
        list: "approvals",
        qualifiedId: `approvals/${input.id}`,
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        state: "pending",
        metadata: input.metadata ?? {}
      }));
    const tasks = {
      name: "approvals",
      stateMachine: approvalStateMachine,
      all: vi.fn(async () => []),
      get: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      create: createMock,
      update: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      fire: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      canFire: vi.fn(async () => false),
      events: vi.fn(async () => []),
      delete: vi.fn(async () => undefined)
    } satisfies Tasks;

    const enqueued = await enqueueApproval({
      tasks,
      payload: {
        commandPath: "deploy.prod",
        params: { target: "prod" },
        message: "Deploy build to prod?"
      }
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(enqueued.approvalId).toMatch(/^2026-04-26T13-22-09-[0-9a-f]{6}$/);
    expect(enqueued.pending.approvalId).toBe(enqueued.approvalId);
  });

  it("surfaces the collision error after a second approval id clash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T13:22:09.000Z"));

    const tasks = {
      name: "approvals",
      stateMachine: approvalStateMachine,
      all: vi.fn(async () => []),
      get: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      create: vi
        .fn<Tasks["create"]>()
        .mockRejectedValue(new TaskAlreadyExistsError("Task already exists.")),
      update: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      fire: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      canFire: vi.fn(async () => false),
      events: vi.fn(async () => []),
      delete: vi.fn(async () => undefined)
    } satisfies Tasks;

    await expect(
      enqueueApproval({
        tasks,
        payload: {
          commandPath: "deploy.prod",
          params: { target: "prod" },
          message: "Deploy build to prod?"
        }
      })
    ).rejects.toBeInstanceOf(TaskAlreadyExistsError);

    expect(tasks.create).toHaveBeenCalledTimes(2);
  });

  it("returns undefined when loading an approval that does not exist", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml", createMemFs());
    const tasks = taskList.list("approvals");

    await expect(loadApproval({ tasks, approvalId: "missing" })).resolves.toBeUndefined();
  });
});
