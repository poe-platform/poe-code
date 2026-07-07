import { mockProvider } from "@poe-code/agent-human-in-loop";
import { openTaskList } from "@poe-code/task-list";
import type { TaskList, TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "../index.js";
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

const { createMCPServer } = await import("../mcp.js");
const { McpClient, createSdkTestPair } = await import("tiny-mcp-client");

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

async function createClient(server: ReturnType<typeof createMCPServer>) {
  return createSdkTestPair(server, () =>
    new McpClient({
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    })
  );
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
            scope: ["mcp"],
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

describe("human-in-loop MCP runtime", () => {
  beforeEach(() => {
    spawnFnMock.mockClear();
    spawnUnrefMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the handler result after sync approval", async () => {
    const provider = mockProvider({ outcome: "approved" });
    const requestApprovalSpy = vi.spyOn(provider, "requestApproval");
    const handler = vi.fn(async ({ params }: { params: { target: string } }) => ({
      deployed: params.target,
    }));
    const server = createMCPServer(createRoot("sync", handler), {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true,
      humanInLoop: createHumanInLoop({
        provider,
      }),
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.callTool({
        name: "deploy__prod",
        arguments: {
          target: "prod",
        },
      });

      expect(requestApprovalSpy).toHaveBeenCalledWith({
        message: "Deploy prod with deploy.prod?",
        declineInputPrompt: "Why not?",
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              deployed: "prod",
            }),
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns structured declined content for sync approvals", async () => {
    const provider = mockProvider({ outcome: "declined", reason: "Need ticket" });
    const handler = vi.fn(async () => "should not run");
    const server = createMCPServer(createRoot("sync", handler), {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true,
      humanInLoop: createHumanInLoop({
        provider,
      }),
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.callTool({
        name: "deploy__prod",
        arguments: {
          target: "prod",
        },
      });

      expect(handler).not.toHaveBeenCalled();
      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: "Declined: Need ticket",
          },
          {
            type: "text",
            text: JSON.stringify({
              outcome: "declined",
              reason: "Need ticket",
              commandPath: "deploy.prod",
            }),
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns the pending marker for async approvals and leaves the approval pending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T13:22:09.000Z"));

    const provider = mockProvider({ outcome: "approved" });
    const requestApprovalSpy = vi.spyOn(provider, "requestApproval");
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const handler = vi.fn(async () => "should not run");
    const server = createMCPServer(createRoot("async", handler), {
      approvals: true,
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true,
      humanInLoop: createHumanInLoop({
        provider,
        taskList,
        binPath: {
          execPath: "node",
          entryArgs: ["toolcraft.js"],
        },
      }),
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.callTool({
        name: "deploy__prod",
        arguments: {
          target: "prod",
        },
      });

      expect(handler).not.toHaveBeenCalled();
      expect(requestApprovalSpy).not.toHaveBeenCalled();
      expect(result.content).toHaveLength(2);
      expect(result.isError).not.toBe(true);

      const pending = JSON.parse(result.content[1]!.text) as {
        approvalId: string;
        enqueuedAt: string;
        message: string;
        status: string;
      };

      expect(result.content[0]).toEqual({
        type: "text",
        text: `Queued for human approval (id: ${pending.approvalId}). Track with \`toolcraft approvals show ${pending.approvalId}\`.`,
      });
      expect(pending).toEqual({
        status: "pending-approval",
        approvalId: pending.approvalId,
        message: "Deploy prod with deploy.prod?",
        enqueuedAt: "2026-04-26T13:22:09.000Z",
      });

      const approvalResult = await client.callTool({
        name: "approvals__show",
        arguments: {
          approval_id: pending.approvalId,
        },
      });
      const approval = JSON.parse(approvalResult.content[0]!.text) as {
        state: string;
        metadata: {
          commandPath: string;
          message: string;
        };
      };

      expect(approval.state).toBe("pending");
      expect(approval.metadata).toMatchObject({
        commandPath: "deploy.prod",
        message: "Deploy prod with deploy.prod?",
      });
      expect(spawnFnMock).toHaveBeenCalledTimes(1);
      expect(spawnUnrefMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      await cleanup();
    }
  });
});
