import { openTaskList, TaskNotFoundError } from "@poe-code/task-list";
import type { TaskList, TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "../index.js";
import { enqueueApproval } from "./approval-tasks.js";
import { approvalStateMachine } from "./state-machine.js";
import { approvalsGroup, mergeApprovalsGroup } from "./approvals-commands.js";

const loggerState = {
  error: [] as string[]
};

vi.mock("toolcraft-design", () => ({
  configureTheme: vi.fn(),
  createLogger: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: (message: string) => loggerState.error.push(message),
    resolved: vi.fn(),
    errorResolved: vi.fn(),
    message: vi.fn()
  }),
  renderTable: vi.fn(() => "table"),
  getTheme: vi.fn(() => ({
    header: (value: string) => value,
    muted: (value: string) => value
  })),
  text: {
    heading: (value: string) => value,
    section: (value: string) => value,
    sectionHeader: (value: string) => value,
    muted: (value: string) => value,
    usageCommand: (value: string) => value
  },
  formatCommandList: (commands: Array<{ name: string; description: string }>) =>
    commands.map((command) => `  ${command.name}  ${command.description}`).join("\n"),
  formatOptionList: (options: Array<{ flags: string; description: string }>) =>
    options.map((option) => `  ${option.flags}  ${option.description}`).join("\n"),
  promptText: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  resetOutputFormatCache: vi.fn(),
  note: vi.fn()
}));

const { runCLI } = await import("../cli.js");
const { createMCPServer, runMCP } = await import("../mcp.js");
const { createSDK } = await import("../sdk.js");
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
    stateMachine: approvalStateMachine
  });
}

function getApprovalCommand(name: "list" | "show" | "run") {
  const command = approvalsGroup.children.find(
    (child) => child.kind === "command" && child.name === name
  );

  if (command === undefined || command.kind !== "command") {
    throw new Error(`Expected approvals.${name} command.`);
  }

  return command;
}

async function enqueueDemoApproval(
  taskList: TaskList,
  payload: {
    commandPath?: string;
    params?: Record<string, unknown>;
    message?: string;
  } = {}
): Promise<string> {
  const { approvalId } = await enqueueApproval({
    tasks: taskList.list("approvals"),
    payload: {
      commandPath: payload.commandPath ?? "deploy",
      params: payload.params ?? {},
      message: payload.message ?? "Deploy?"
    }
  });

  return approvalId;
}

const originalArgv = [...process.argv];
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, value: boolean): void {
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value
  });
}

describe("approvals built-in commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggerState.error.length = 0;
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    setTTY(process.stdout, true);
    setTTY(process.stdin, true);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;

    if (stdoutTTY) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    }

    if (stdinTTY) {
      Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    }
  });

  it("composes approval commands without mutating a frozen root group", () => {
    const root = Object.freeze(
      defineGroup({
        name: "root",
        children: []
      })
    );

    const merged = mergeApprovalsGroup(root);

    expect(merged).not.toBe(root);
    expect(merged.children.map((child) => child.name)).toContain("approvals");
    expect(root.children).toEqual([]);
  });

  it("lists approvals and applies single and multiple state filters", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const tasks = taskList.list("approvals");
    const listCommand = getApprovalCommand("list");
    const pendingId = await enqueueDemoApproval(taskList, {
      message: "pending"
    });
    const runningId = await enqueueDemoApproval(taskList, {
      message: "running"
    });
    const declinedId = await enqueueDemoApproval(taskList, {
      message: "declined"
    });

    await tasks.fire(runningId, "claim", {
      metadataPatch: {
        pid: 123
      }
    });
    await tasks.fire(runningId, "start");
    await tasks.fire(declinedId, "claim");
    await tasks.fire(declinedId, "decline", {
      metadataPatch: {
        error: {
          reason: "No"
        }
      }
    });

    const baseContext = {
      runtimeOptions: {
        taskList
      },
      root: defineGroup({
        name: "root",
        children: []
      }),
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
      progress: vi.fn()
    };

    await expect(
      listCommand.handler({
        ...baseContext,
        params: {}
      } as Parameters<typeof listCommand.handler>[0])
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pendingId, state: "pending" }),
        expect.objectContaining({ id: runningId, state: "approved-running" }),
        expect.objectContaining({ id: declinedId, state: "declined" })
      ])
    );

    await expect(
      listCommand.handler({
        ...baseContext,
        params: {
          state: "pending"
        }
      } as Parameters<typeof listCommand.handler>[0])
    ).resolves.toEqual([expect.objectContaining({ id: pendingId, state: "pending" })]);

    await expect(
      listCommand.handler({
        ...baseContext,
        params: {
          state: "pending, declined"
        }
      } as Parameters<typeof listCommand.handler>[0])
    ).resolves.toEqual([
      expect.objectContaining({ id: pendingId, state: "pending" }),
      expect.objectContaining({ id: declinedId, state: "declined" })
    ]);
  });

  it("shows a single approval and throws TaskNotFoundError for an unknown id", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const showCommand = getApprovalCommand("show");
    const approvalId = await enqueueDemoApproval(taskList, {
      message: "show me"
    });
    const baseContext = {
      runtimeOptions: {
        taskList
      },
      root: defineGroup({
        name: "root",
        children: []
      }),
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
      progress: vi.fn()
    };

    await expect(
      showCommand.handler({
        ...baseContext,
        params: {
          approvalId
        }
      } as Parameters<typeof showCommand.handler>[0])
    ).resolves.toMatchObject({
      id: approvalId,
      state: "pending"
    });

    await expect(
      showCommand.handler({
        ...baseContext,
        params: {
          approvalId: "missing"
        }
      } as Parameters<typeof showCommand.handler>[0])
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("reaches approvals.run from the CLI but hides it from MCP and SDK", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const provider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" as const }))
    };
    const handler = vi.fn(async () => ({
      ok: true
    }));
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler
        })
      ]
    });
    const approvalId = await enqueueDemoApproval(taskList, {
      commandPath: "deploy"
    });

    process.argv = ["node", "toolcraft", "approvals", "run", "--approval-id", approvalId];
    await runCLI(root, {
      approvals: true,
      humanInLoop: {
        taskList,
        provider
      }
    });

    const cliTask = await taskList.list("approvals").get(approvalId);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cliTask.state).toBe("approved-done");

    const mcpServer = createMCPServer(
      defineGroup({
        name: "root",
        children: []
      }),
      {
        approvals: true,
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        humanInLoop: {
          taskList
        }
      }
    );
    const { client, cleanup } = await createSdkTestPair(
      mcpServer,
      () =>
        new McpClient({
          clientInfo: {
            name: "test-client",
            version: "1.0.0"
          }
        })
    );

    try {
      const { tools } = await client.listTools();
      const toolNames = tools.map((tool) => tool.name);

      expect(toolNames).toContain("approvals__list");
      expect(toolNames).toContain("approvals__show");
      expect(toolNames).not.toContain("approvals__run");
    } finally {
      await cleanup();
    }

    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: []
      }),
      {
        approvals: true,
        humanInLoop: {
          taskList
        }
      }
    ) as Record<string, unknown>;

    expect(sdk.approvals).toEqual({
      list: expect.any(Function),
      show: expect.any(Function)
    });
    expect("run" in (sdk.approvals as Record<string, unknown>)).toBe(false);
  });

  it("omits approval-management commands across CLI, MCP, and SDK by default", async () => {
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => ({ ok: true })
        })
      ]
    });

    process.argv = ["node", "toolcraft", "--help"];
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCLI(root);
    expect(write.mock.calls.flat().join("")).not.toContain("approvals");

    const mcpServer = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0"
    });
    const { client, cleanup } = await createSdkTestPair(
      mcpServer,
      () =>
        new McpClient({
          clientInfo: {
            name: "test-client",
            version: "1.0.0"
          }
        })
    );

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain("toolcraft__approvals__list");
      expect(tools.map((tool) => tool.name)).not.toContain("toolcraft__approvals__show");
    } finally {
      await cleanup();
    }

    const sdk = createSDK(root) as Record<string, unknown>;
    expect(sdk).not.toHaveProperty("approvals");
    expect(sdk).toHaveProperty("deploy");
  });

  it("keeps human-in-loop execution enabled when approval-management commands are omitted", async () => {
    const provider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" as const }))
    };
    const handler = vi.fn(async () => ({ ok: true }));
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            params: S.Object({}),
            humanInLoop: {
              mode: "sync",
              message: () => "Deploy?"
            },
            handler
          })
        ]
      }),
      {
        approvals: false,
        humanInLoop: { provider }
      }
    ) as { deploy(params: Record<string, never>): Promise<{ ok: boolean }> };

    await expect(sdk.deploy({})).resolves.toEqual({ ok: true });
    expect(provider.requestApproval).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("previews approvals.run without prompting or transitioning state during dry run", async () => {
    const taskList = await openApprovalTaskList("/repo/approvals.yaml");
    const provider = {
      id: "provider",
      requestApproval: vi.fn(async () => ({ outcome: "approved" as const }))
    };
    const handler = vi.fn(async () => ({ ok: true }));
    const root = defineGroup({
      name: "toolcraft",
      children: [defineCommand({ name: "deploy", params: S.Object({}), handler })]
    });
    const approvalId = await enqueueDemoApproval(taskList, { commandPath: "deploy" });
    const runCommand = getApprovalCommand("run");

    const result = await runCommand.handler({
      runtimeOptions: { taskList, provider },
      root,
      params: { approvalId, dryRun: true },
      secrets: {},
      fetch: globalThis.fetch,
      fs: { readFile: vi.fn(), writeFile: vi.fn(), exists: vi.fn() },
      env: { get: vi.fn() },
      progress: vi.fn()
    } as unknown as Parameters<typeof runCommand.handler>[0]);

    expect(provider.requestApproval).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: approvalId, state: "pending" });
    await expect(taskList.list("approvals").get(approvalId)).resolves.toMatchObject({
      state: "pending"
    });
  });

  it("throws from approvals.run when the runtime task list is unset", async () => {
    const runCommand = getApprovalCommand("run");
    const root = defineGroup({
      name: "root",
      children: []
    });

    await expect(
      runCommand.handler({
        runtimeOptions: {},
        root,
        params: {
          approvalId: "approval-1"
        },
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
        progress: vi.fn()
      } as Parameters<typeof runCommand.handler>[0])
    ).rejects.toThrowError("humanInLoop.taskList required for async-mode commands");
  });

  it("throws a startup error when the user defines an approvals group", async () => {
    const rootFactory = () =>
      defineGroup({
        name: "root",
        children: [
          defineGroup({
            name: "approvals",
            children: []
          })
        ]
      });

    process.argv = ["node", "toolcraft", "--help"];

    await expect(runCLI(rootFactory(), { approvals: true })).rejects.toThrowError(
      "'approvals' is reserved for human-in-loop built-ins"
    );
    expect(() =>
      createMCPServer(rootFactory(), {
        approvals: true,
        name: "toolcraft-test",
        version: "1.0.0"
      })
    ).toThrowError("'approvals' is reserved for human-in-loop built-ins");
    await expect(
      runMCP(rootFactory(), {
        approvals: true,
        name: "toolcraft-test",
        version: "1.0.0"
      })
    ).rejects.toThrowError("'approvals' is reserved for human-in-loop built-ins");
    expect(() => createSDK(rootFactory(), { approvals: true })).toThrowError(
      "'approvals' is reserved for human-in-loop built-ins"
    );
  });
});
