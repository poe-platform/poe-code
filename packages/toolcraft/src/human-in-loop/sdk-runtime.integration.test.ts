import { mockProvider } from "@poe-code/agent-human-in-loop";
import { openTaskList } from "@poe-code/task-list";
import type { TaskList, TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { ApprovalDeclinedError, defineCommand, defineGroup } from "../index.js";
import { createHumanInLoop } from "./runtime.js";
import { approvalStateMachine } from "./state-machine.js";

const spawnUnrefMock = vi.hoisted(() => vi.fn());
const spawnFnMock = vi.hoisted(() =>
  vi.fn(() => ({
    unref: spawnUnrefMock,
  }))
);

vi.mock("./spawn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spawn.js")>();

  return {
    ...actual,
    spawnApprovalRunner: (approvalId: string, runtimeOptions: Parameters<typeof actual.spawnApprovalRunner>[1]) =>
      actual.spawnApprovalRunner(approvalId, runtimeOptions, spawnFnMock),
  };
});

const { createSDK } = await import("../sdk.js");

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

function createRoot(mode: "sync" | "async", handler: ReturnType<typeof vi.fn>) {
  return defineGroup({
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
            humanInLoop: {
              mode,
              message: ({ params, commandPath }) => `Deploy ${params.target} with ${commandPath}?`,
              declineInputPrompt: "Why not?",
            },
            handler,
          }),
        ],
      }),
    ],
  });
}

describe("human-in-loop SDK runtime", () => {
  beforeEach(() => {
    spawnFnMock.mockClear();
    spawnUnrefMock.mockClear();
  });

  it("returns the handler result after sync approval", async () => {
    const provider = mockProvider({ outcome: "approved" });
    const requestApprovalSpy = vi.spyOn(provider, "requestApproval");
    const handler = vi.fn(async ({ params }: { params: { target: string } }) => ({
      deployed: params.target,
    }));
    const sdk = createSDK(createRoot("sync", handler), {
      humanInLoop: createHumanInLoop({
        provider,
      }),
    }) as {
      deploy: {
        prod(params: { target: string }): Promise<{ deployed: string }>;
      };
    };

    await expect(sdk.deploy.prod({ target: "prod" })).resolves.toEqual({
      deployed: "prod",
    });
    expect(requestApprovalSpy).toHaveBeenCalledWith({
      message: "Deploy prod with deploy.prod?",
      declineInputPrompt: "Why not?",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("throws ApprovalDeclinedError when sync approval is declined", async () => {
    const handler = vi.fn(async () => "should not run");
    const sdk = createSDK(createRoot("sync", handler), {
      humanInLoop: createHumanInLoop({
        provider: mockProvider({ outcome: "declined", reason: "Need ticket" }),
      }),
    }) as {
      deploy: {
        prod(params: { target: string }): Promise<string>;
      };
    };

    await expect(sdk.deploy.prod({ target: "prod" })).rejects.toMatchObject({
      name: "ApprovalDeclinedError",
      message: "Declined: Need ticket",
      reason: "Need ticket",
      commandPath: "deploy.prod",
    } satisfies Partial<ApprovalDeclinedError>);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the pending marker for async approvals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T13:22:09.000Z"));

    const provider = mockProvider({ outcome: "approved" });
    const requestApprovalSpy = vi.spyOn(provider, "requestApproval");
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const handler = vi.fn(async () => "should not run");
    const sdk = createSDK(createRoot("async", handler), {
      humanInLoop: createHumanInLoop({
        provider,
        taskList,
        binPath: {
          execPath: "node",
          entryArgs: ["toolcraft.js"],
        },
      }),
    }) as {
      deploy: {
        prod(params: { target: string }): Promise<{
          approvalId: string;
          enqueuedAt: string;
          message: string;
          status: string;
        }>;
      };
    };

    try {
      const result = await sdk.deploy.prod({ target: "prod" });

      expect(result).toEqual({
        status: "pending-approval",
        approvalId: result.approvalId,
        message: "Deploy prod with deploy.prod?",
        enqueuedAt: "2026-04-26T13:22:09.000Z",
      });
      expect(requestApprovalSpy).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();

      const approval = await taskList.list("approvals").get(result.approvalId);
      expect(approval.state).toBe("pending");
      expect(approval.metadata).toMatchObject({
        commandPath: "deploy.prod",
        message: "Deploy prod with deploy.prod?",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("spawns the detached approval runner with the expected args for async approvals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T13:22:09.000Z"));

    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const sdk = createSDK(createRoot("async", vi.fn(async () => "should not run")), {
      humanInLoop: createHumanInLoop({
        provider: mockProvider({ outcome: "approved" }),
        taskList,
        binPath: {
          execPath: "node",
          entryArgs: ["toolcraft.js"],
        },
      }),
    }) as {
      deploy: {
        prod(params: { target: string }): Promise<{
          approvalId: string;
        }>;
      };
    };

    try {
      const result = await sdk.deploy.prod({ target: "prod" });

      expect(spawnFnMock).toHaveBeenCalledWith(
        "node",
        ["toolcraft.js", "approvals", "run", result.approvalId],
        {
          detached: true,
          stdio: "ignore",
          env: process.env,
          cwd: process.cwd(),
        }
      );
      expect(spawnUnrefMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
