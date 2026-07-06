import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockProvider, osascriptProvider } from "@poe-code/agent-human-in-loop";
import type { TaskList, Tasks } from "@poe-code/task-list";
import { S } from "toolcraft-schema";
import type { HandlerContext } from "../index.js";
import { UserError, defineCommand } from "../index.js";
import { approvalStateMachine } from "./state-machine.js";
import { invokeWithHumanInLoop } from "./gate.js";
import { ApprovalDeclinedError } from "./types.js";

const defaultProviderForPlatformMock = vi.hoisted(() => vi.fn());
const osascriptProviderMock = vi.hoisted(() => vi.fn());
const spawnApprovalRunnerMock = vi.hoisted(() => vi.fn());

vi.mock("./default-provider.js", () => ({
  defaultProviderForPlatform: defaultProviderForPlatformMock
}));

vi.mock("./spawn.js", () => ({
  spawnApprovalRunner: spawnApprovalRunnerMock
}));

vi.mock("@poe-code/agent-human-in-loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-human-in-loop")>();

  return {
    ...actual,
    osascriptProvider: osascriptProviderMock
  };
});

function createContext(params: { name: string } = { name: "production" }): HandlerContext {
  return {
    params,
    secrets: {},
    fetch: globalThis.fetch,
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn()
    },
    env: {
      get: vi.fn()
    },
    diagnostics: { level: "silent", emit: vi.fn() },
    progress: vi.fn()
  };
}

function createSyncCommand(handler: ReturnType<typeof vi.fn>) {
  return defineCommand({
    name: "deploy",
    params: S.Object({
      name: S.String()
    }),
    humanInLoop: {
      mode: "sync",
      message: ({ params, commandPath }) => `Run ${commandPath} for ${params.name}?`,
      declineInputPrompt: "Why not?"
    },
    handler
  });
}

function createAsyncCommand(handler: ReturnType<typeof vi.fn>) {
  return defineCommand({
    name: "deploy",
    params: S.Object({
      name: S.String()
    }),
    humanInLoop: {
      mode: "async",
      message: ({ params, commandPath }) => `Queue ${commandPath} for ${params.name}?`,
      declineInputPrompt: "Why not?"
    },
    handler
  });
}

describe("invokeWithHumanInLoop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    defaultProviderForPlatformMock.mockReset();
    osascriptProviderMock.mockReset();
    spawnApprovalRunnerMock.mockReset();
  });

  it("runs the handler directly when the command has no human-in-loop config", async () => {
    const handler = vi.fn(async () => "done");
    const command = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String()
      }),
      handler
    });

    await expect(
      invokeWithHumanInLoop(command, createContext(), undefined, "deploy")
    ).resolves.toBe("done");

    expect(defaultProviderForPlatformMock).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("runs the handler after sync approval and passes the formatted message to the provider", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);
    const provider = mockProvider({ outcome: "approved" });
    const requestApprovalSpy = vi.spyOn(provider, "requestApproval");

    await expect(
      invokeWithHumanInLoop(command, createContext(), { provider }, "root.deploy")
    ).resolves.toBe("done");

    expect(requestApprovalSpy).toHaveBeenCalledWith({
      message: "Run root.deploy for production?",
      declineInputPrompt: "Why not?"
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("prints and re-verifies a deterministic sync approval plan hash", async () => {
    let revision = 1;
    const handler = vi.fn(async () => "done");
    const command = defineCommand({
      name: "sync",
      params: S.Object({ name: S.String() }),
      humanInLoop: {
        mode: "sync",
        message: () => "Apply file changes?",
        plan: () => ({ revision, files: ["flows/morning.json"] })
      },
      handler
    });
    const provider = mockProvider({ outcome: "approved" });
    const requestApprovalSpy = vi.spyOn(provider, "requestApproval").mockImplementation(async () => {
      revision = 2;
      return { outcome: "approved" };
    });

    await expect(
      invokeWithHumanInLoop(command, createContext(), { provider }, "sync")
    ).rejects.toThrowError(/Approval plan changed after approval/);

    expect(requestApprovalSpy).toHaveBeenCalledWith({
      message: expect.stringMatching(/^Apply file changes\?\n\nPlan:\n\{\n[\s\S]+\n\}\n\nPlan hash: sha256:[0-9a-f]{64}$/),
      declineInputPrompt: undefined
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws ApprovalDeclinedError without a reason when sync approval is declined", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);

    await expect(
      invokeWithHumanInLoop(
        command,
        createContext(),
        { provider: mockProvider({ outcome: "declined" }) },
        "deploy"
      )
    ).rejects.toBeInstanceOf(ApprovalDeclinedError);

    await invokeWithHumanInLoop(
      command,
      createContext(),
      { provider: mockProvider({ outcome: "declined" }) },
      "deploy"
    ).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApprovalDeclinedError);
      expect(error).toMatchObject({
        commandPath: "deploy",
        reason: undefined,
        message: "Declined."
      });
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws ApprovalDeclinedError carrying the decline reason", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);

    await invokeWithHumanInLoop(
      command,
      createContext(),
      { provider: mockProvider({ outcome: "declined", reason: "Need ticket" }) },
      "deploy.production"
    ).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApprovalDeclinedError);
      expect(error).toMatchObject({
        commandPath: "deploy.production",
        reason: "Need ticket",
        message: "Declined: Need ticket"
      });
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("uses the lazy darwin default provider and memoizes it per runtime options object", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);
    const runtimeOptions = {};

    osascriptProviderMock.mockReturnValue(mockProvider({ outcome: "approved" }));
    defaultProviderForPlatformMock.mockImplementation(() =>
      osascriptProvider({
        title: "Approval needed",
        binary: "/fake/osascript"
      })
    );

    expect(defaultProviderForPlatformMock).not.toHaveBeenCalled();

    await expect(
      invokeWithHumanInLoop(command, createContext(), runtimeOptions, "deploy")
    ).resolves.toBe("done");
    await expect(
      invokeWithHumanInLoop(command, createContext({ name: "staging" }), runtimeOptions, "deploy")
    ).resolves.toBe("done");

    expect(defaultProviderForPlatformMock).toHaveBeenCalledTimes(1);
    expect(osascriptProviderMock).toHaveBeenCalledWith({
      title: "Approval needed",
      binary: "/fake/osascript"
    });
  });

  it("surfaces the documented UserError when no provider is configured", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);

    defaultProviderForPlatformMock.mockReturnValue({
      id: "noProviderConfigured",
      async requestApproval() {
        throw new UserError(
          "No human-in-loop provider is configured. Pass {humanInLoop: {provider: ...}} to runCLI / createMCPServer / createSDK, or run on macOS to use the default osascript provider."
        );
      }
    });

    await expect(
      invokeWithHumanInLoop(command, createContext(), {}, "deploy")
    ).rejects.toThrowError(
      new UserError(
        "No human-in-loop provider is configured. Pass {humanInLoop: {provider: ...}} to runCLI / createMCPServer / createSDK, or run on macOS to use the default osascript provider."
      )
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws when async mode is used without a configured task list", async () => {
    const handler = vi.fn(async () => "done");
    const command = createAsyncCommand(handler);

    await expect(
      invokeWithHumanInLoop(command, createContext(), undefined, "deploy")
    ).rejects.toThrowError("humanInLoop.taskList required for async-mode commands");

    expect(defaultProviderForPlatformMock).not.toHaveBeenCalled();
    expect(spawnApprovalRunnerMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("enqueues async approvals, spawns the runner, and returns the pending marker", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T13:22:09.000Z"));

    const createdTasks: Array<{
      id: string;
      name: string;
      metadata?: Record<string, unknown>;
    }> = [];
    const tasks: Tasks = {
      name: "approvals",
      stateMachine: approvalStateMachine,
      all: vi.fn(async () => []),
      get: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      create: vi.fn(async (input) => {
        createdTasks.push(input);
        return {
          list: "approvals",
          qualifiedId: `approvals/${input.id}`,
          id: input.id,
          name: input.name,
          description: input.description ?? "",
          state: "pending",
          metadata: input.metadata ?? {}
        };
      }),
      update: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      fire: vi.fn(async () => {
        throw new Error("unused in test");
      }),
      canFire: vi.fn(async () => false),
      events: vi.fn(async () => []),
      delete: vi.fn(async () => undefined)
    };
    const taskList: TaskList = {
      list: vi.fn(() => tasks),
      lists: vi.fn(async () => ["approvals"]),
      allTasks: vi.fn(async () => []),
      get: vi.fn(async () => {
        throw new Error("unused in test");
      })
    };
    const handler = vi.fn(async () => "done");
    const command = createAsyncCommand(handler);

    const result = await invokeWithHumanInLoop(
      command,
      createContext(),
      { taskList },
      "root.deploy"
    );

    expect(result).toMatchObject({
      status: "pending-approval",
      message: "Queue root.deploy for production?",
      enqueuedAt: "2026-04-26T13:22:09.000Z"
    });
    expect(result.approvalId).toMatch(/^2026-04-26T13-22-09-[0-9a-f]{6}$/);

    expect(createdTasks).toHaveLength(1);
    expect(createdTasks[0]).toEqual({
      id: result.approvalId,
      name: "root.deploy (2026-04-26T13:22:09.000Z)",
      metadata: {
        schemaVersion: 1,
        approvalId: result.approvalId,
        commandPath: "root.deploy",
        params: { name: "production" },
        message: "Queue root.deploy for production?",
        declineInputPrompt: "Why not?",
        enqueuedAt: "2026-04-26T13:22:09.000Z",
        pid: null,
        result: null,
        error: null
      }
    });
    expect(spawnApprovalRunnerMock).toHaveBeenCalledWith(result.approvalId, { taskList });
    expect(defaultProviderForPlatformMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("includes the deterministic plan hash in async structured output and records", async () => {
    const tasks = {
      name: "approvals",
      stateMachine: approvalStateMachine,
      all: vi.fn(async () => []),
      get: vi.fn(async () => { throw new Error("unused in test"); }),
      create: vi.fn(async (input) => ({
        list: "approvals",
        qualifiedId: `approvals/${input.id}`,
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        state: "pending" as const,
        metadata: input.metadata ?? {}
      })),
      update: vi.fn(async () => { throw new Error("unused in test"); }),
      fire: vi.fn(async () => { throw new Error("unused in test"); }),
      canFire: vi.fn(async () => false),
      events: vi.fn(async () => []),
      delete: vi.fn(async () => undefined)
    } satisfies Tasks;
    const taskList: TaskList = {
      list: vi.fn(() => tasks),
      lists: vi.fn(async () => ["approvals"]),
      allTasks: vi.fn(async () => []),
      get: vi.fn(async () => { throw new Error("unused in test"); })
    };
    const command = defineCommand({
      name: "sync",
      params: S.Object({ name: S.String() }),
      humanInLoop: {
        mode: "async",
        message: () => "Apply file changes?",
        plan: () => ({ updated: ["flows/morning.json"] })
      },
      handler: async () => "done"
    });

    const result = await invokeWithHumanInLoop(command, createContext(), { taskList }, "sync");

    expect(result).toMatchObject({
      status: "pending-approval",
      planHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
    });
    expect(tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        plan: { updated: ["flows/morning.json"] },
        planHash: result.planHash
      })
    }));
  });
});
