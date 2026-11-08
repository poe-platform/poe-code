import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import { openTaskList } from "@poe-code/task-list";
import type { Task, TaskList, TaskListFs, Tasks } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "../index.js";
import { enqueueApproval } from "./approval-tasks.js";
import { createApprovalPlan, formatApprovalMessage } from "./plan-hash.js";
import { runApproval } from "./runner.js";
import { approvalStateMachine } from "./state-machine.js";
import type { HumanInLoopRuntimeOptions } from "./runtime-options.js";

function createMemFs(): TaskListFs {
  return createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as TaskListFs;
}

async function openApprovalTaskList(path: string): Promise<TaskList> {
  return openTaskList({
    type: "yaml-file",
    path,
    create: true,
    fs: createMemFs(),
    stateMachine: approvalStateMachine,
  });
}

async function createApprovalTask(
  tasks: Tasks,
  payload: {
    commandPath: string;
    params: Record<string, unknown>;
    message: string;
    declineInputPrompt?: string;
    plan?: Record<string, unknown>;
    planHash?: string;
  }
): Promise<{ approvalId: string }> {
  const { approvalId } = await enqueueApproval({
    tasks,
    payload,
  });

  return { approvalId };
}

function createRuntimeOptions(taskList: TaskList, provider: HumanInLoopProvider): HumanInLoopRuntimeOptions {
  return {
    taskList,
    provider,
  };
}

function readTaskError(task: Task): Record<string, unknown> | undefined {
  const metadata = task.metadata;

  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }

  const error = metadata.error;
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>) : undefined;
}

describe("runApproval", () => {
  const originalDeployToken = process.env.DEPLOY_TOKEN;

  afterEach(() => {
    if (originalDeployToken === undefined) {
      delete process.env.DEPLOY_TOKEN;
    } else {
      process.env.DEPLOY_TOKEN = originalDeployToken;
    }
  });

  it("exits silently when the approval task is no longer pending", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" })),
    };
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => "unused",
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy",
      params: {},
      message: "Deploy?",
    });

    await tasks.fire(approvalId, "decline", {
      metadataPatch: {
        error: {
          reason: "already declined",
        },
      },
    });

    await expect(runApproval(approvalId, createRuntimeOptions(taskList, provider), root)).resolves.toBeUndefined();

    expect(provider.requestApproval).not.toHaveBeenCalled();
  });

  it("prompts only once when concurrent runners contend for one pending approval", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    let releasePrompt: (() => void) | undefined;
    let reportDuplicatePrompt: (() => void) | undefined;
    const promptRelease = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const duplicatePrompt = new Promise<void>((resolve) => {
      reportDuplicatePrompt = resolve;
    });
    const requestApproval = vi.fn(async () => {
      if (requestApproval.mock.calls.length === 2) {
        reportDuplicatePrompt?.();
      }
      await promptRelease;
      return { outcome: "approved" as const };
    });
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval,
    };
    const handler = vi.fn(async () => "done");
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler,
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy",
      params: {},
      message: "Deploy?",
    });

    const first = runApproval(approvalId, createRuntimeOptions(taskList, provider), root);
    const second = runApproval(approvalId, createRuntimeOptions(taskList, provider), root);
    const secondExitedWithoutPrompting = await Promise.race([
      second.then(() => true),
      duplicatePrompt.then(() => false),
    ]);

    releasePrompt?.();
    await Promise.allSettled([first, second]);

    expect(secondExitedWithoutPrompting).toBe(true);
    expect(provider.requestApproval).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires start, runs the handler, and stores the result after approval", async () => {
    process.env.DEPLOY_TOKEN = "secret-token";

    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" })),
    };
    const handler = vi.fn(async ({ params, secrets, fetch, fs, env, progress }) => {
      expect(params).toEqual({
        target: "prod",
      });
      expect(secrets).toEqual({
        token: "secret-token",
      });
      expect(fetch).toBe(globalThis.fetch);
      expect(typeof fs.readFile).toBe("function");
      expect(typeof fs.writeFile).toBe("function");
      expect(typeof fs.exists).toBe("function");
      expect(env.get("DEPLOY_TOKEN")).toBe("secret-token");
      expect(progress("ignored")).toBeUndefined();

      return {
        ok: true,
      };
    });
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "deploy",
          children: [
            defineCommand({
              name: "prod",
              params: S.Object({
                target: S.String(),
              }),
              secrets: {
                token: {
                  env: "DEPLOY_TOKEN",
                },
              },
              handler,
            }),
          ],
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy.prod",
      params: {
        target: "prod",
      },
      message: "Deploy to prod?",
      declineInputPrompt: "Why not?",
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);

    expect(provider.requestApproval).toHaveBeenCalledWith({
      message: "Deploy to prod?",
      declineInputPrompt: "Why not?",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(task.state).toBe("approved-done");
    expect(task.metadata).toMatchObject({
      pid: process.pid,
      result: {
        ok: true,
      },
    });
  });

  it("fires decline with the provider reason when approval is declined", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "declined", reason: "Need ticket" })),
    };
    const handler = vi.fn(async () => "unused");
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler,
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy",
      params: {},
      message: "Deploy?",
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);

    expect(task.state).toBe("declined");
    expect(task.metadata).toMatchObject({
      error: {
        reason: "Need ticket",
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses approved async execution when the persisted plan has drifted", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" }))
    };
    const handler = vi.fn(async () => "done");
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "sync",
          params: S.Object({}),
          humanInLoop: {
            mode: "async",
            message: () => "Sync?",
            plan: () => ({ revision: 2 })
          },
          handler
        })
      ]
    });
    const approvedPlan = createApprovalPlan({ revision: 1 });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "sync",
      params: {},
      message: formatApprovalMessage("Sync?", approvedPlan),
      plan: approvedPlan.value as Record<string, unknown>,
      planHash: approvedPlan.hash
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);
    expect(task.state).toBe("approved-failed");
    expect(provider.requestApproval).toHaveBeenCalledTimes(1);
    expect(readTaskError(task)?.message).toMatch(/Approval plan changed after approval/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a tampered queued plan before prompting", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" }))
    };
    const handler = vi.fn(async () => "done");
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "sync",
          params: S.Object({}),
          humanInLoop: {
            mode: "async",
            message: () => "Sync?",
            plan: () => ({ revision: 1 })
          },
          handler
        })
      ]
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "sync",
      params: {},
      message: "Sync?\n\nPlan:\n{\n  \"revision\": 1\n}\n\nPlan hash: sha256:tampered",
      plan: { revision: 1 },
      planHash: "sha256:tampered"
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);
    expect(task.state).toBe("approved-failed");
    expect(provider.requestApproval).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires fail with the thrown error details when the handler throws", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" })),
    };
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => {
            throw new Error("handler exploded");
          },
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy",
      params: {},
      message: "Deploy?",
    });

    await expect(runApproval(approvalId, createRuntimeOptions(taskList, provider), root)).resolves.toBeUndefined();

    const task = await tasks.get(approvalId);
    const error = readTaskError(task);

    expect(task.state).toBe("approved-failed");
    expect(error).toMatchObject({
      name: "Error",
      message: "handler exploded",
    });
    expect(typeof error?.stack).toBe("string");
  });

  it("fires fail with available command paths when approval command path is unknown", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" })),
    };
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "deploy",
          children: [
            defineCommand({
              name: "prod",
              params: S.Object({}),
              handler: async () => "unused",
            }),
          ],
        }),
        defineCommand({
          name: "inspect",
          params: S.Object({}),
          handler: async () => "unused",
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy.missing",
      params: {},
      message: "Deploy?",
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);
    const error = readTaskError(task);

    expect(task.state).toBe("approved-failed");
    expect(error?.message).toBe(
      'Unknown approval command path "deploy.missing". Available: deploy.prod, inspect.'
    );
  });

  it("lists only CLI-visible approval command paths", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" })),
    };
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "inspect",
          params: S.Object({}),
          handler: async () => "unused",
        }),
        defineCommand({
          name: "sdk-only",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "unused",
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "missing",
      params: {},
      message: "Run?",
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);
    const error = readTaskError(task);

    expect(error?.message).toBe(
      'Unknown approval command path "missing". Available: inspect.'
    );
  });

  it("caps available approval command paths at 20 entries", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" })),
    };
    const root = defineGroup({
      name: "root",
      children: Array.from({ length: 22 }, (_, index) =>
        defineCommand({
          name: `cmd-${String(index + 1).padStart(2, "0")}`,
          params: S.Object({}),
          handler: async () => "unused",
        })
      ),
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "missing",
      params: {},
      message: "Run?",
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);
    const error = readTaskError(task);

    expect(error?.message).toContain("cmd-01, cmd-02");
    expect(error?.message).toContain("cmd-20, … and 2 more.");
    expect(error?.message).not.toContain("cmd-21");
  });

  it("fires fail when the handler result is not JSON-serializable", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" })),
    };
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => ({
            result: 1n,
          }),
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy",
      params: {},
      message: "Deploy?",
    });

    await runApproval(approvalId, createRuntimeOptions(taskList, provider), root);

    const task = await tasks.get(approvalId);

    expect(task.state).toBe("approved-failed");
    expect(task.metadata).toMatchObject({
      error: {
        message: "result not JSON-serializable",
      },
    });
  });

  it("fires fail with the provider error message when the provider throws", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => "unused",
        }),
      ],
    });
    const { approvalId } = await createApprovalTask(tasks, {
      commandPath: "deploy",
      params: {},
      message: "Deploy?",
    });

    await expect(runApproval(approvalId, createRuntimeOptions(taskList, provider), root)).resolves.toBeUndefined();

    const task = await tasks.get(approvalId);

    expect(task.state).toBe("approved-failed");
    expect(task.metadata).toMatchObject({
      pid: process.pid,
      error: {
        message: "provider unavailable",
      },
    });
  });
});
