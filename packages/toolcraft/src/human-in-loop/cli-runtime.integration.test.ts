import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import { openTaskList } from "@poe-code/task-list";
import type { TaskList, TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { defineCommand, defineGroup } from "../index.js";
import { createHumanInLoop } from "./runtime.js";
import { approvalStateMachine } from "./state-machine.js";

const spawnApprovalRunnerMock = vi.hoisted(() => vi.fn());

vi.mock("./spawn.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./spawn.js")>()),
  spawnApprovalRunner: spawnApprovalRunnerMock
}));

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
  renderHelpTokens: (tokens: Array<{ text: string }>) => tokens.map((token) => token.text).join(""),
  promptText: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  resetOutputFormatCache: vi.fn(),
  note: vi.fn()
}));

const { runCLI } = await import("../cli.js");

const originalArgv = [...process.argv];
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, value: boolean): void {
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value
  });
}

function readStdout(stdoutWrite: ReturnType<typeof vi.spyOn>): string {
  return stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
}

async function openApprovalTaskList(): Promise<TaskList> {
  return openTaskList({
    type: "yaml-file",
    path: "/repo/approvals.yaml",
    create: true,
    fs: createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as TaskListFs,
    stateMachine: approvalStateMachine
  });
}

function createAsyncApprovalRoot(): ReturnType<typeof defineGroup> {
  return defineGroup({
    name: "toolcraft",
    children: [
      defineGroup({
        name: "deploy",
        children: [
          defineCommand({
            name: "prod",
            params: S.Object({}),
            humanInLoop: {
              mode: "async",
              message: ({ commandPath }) => `Queue ${commandPath}?`
            },
            handler: vi.fn(async () => "should not run")
          })
        ]
      })
    ]
  });
}

describe("human-in-loop CLI runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnApprovalRunnerMock.mockReset();
    loggerState.error.length = 0;
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    setTTY(process.stdout, true);
    setTTY(process.stdin, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
    process.exitCode = undefined;

    if (stdoutTTY) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    }

    if (stdinTTY) {
      Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    }
  });

  it("runs a sync human-in-loop command after approval", async () => {
    const provider: HumanInLoopProvider = {
      id: "fake",
      requestApproval: vi.fn(async () => ({ outcome: "approved" }))
    };
    const handler = vi.fn(async () => "approved result");
    const command = defineCommand({
      name: "prod",
      params: S.Object({}),
      humanInLoop: {
        mode: "sync",
        message: ({ commandPath }) => `Run ${commandPath}?`
      },
      handler
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineGroup({
          name: "deploy",
          children: [command]
        })
      ]
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "prod", "--yes"];
    await runCLI(root, {
      controls: { yes: true },
      humanInLoop: createHumanInLoop({
        provider
      })
    });

    expect(provider.requestApproval).toHaveBeenCalledWith({
      message: "Run deploy.prod?",
      declineInputPrompt: undefined
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(readStdout(stdoutWrite)).toBe("approved result\n");
    expect(process.exitCode).toBeUndefined();
  });

  it("renders declined approvals as a CLI error and exits non-zero", async () => {
    const provider: HumanInLoopProvider = {
      id: "fake",
      requestApproval: vi.fn(async () => ({ outcome: "declined", reason: "Need ticket" }))
    };
    const handler = vi.fn(async () => "approved result");
    const command = defineCommand({
      name: "prod",
      params: S.Object({}),
      humanInLoop: {
        mode: "sync",
        message: ({ commandPath }) => `Run ${commandPath}?`
      },
      handler
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineGroup({
          name: "deploy",
          children: [command]
        })
      ]
    });

    process.argv = ["node", "toolcraft", "deploy", "prod", "--yes"];
    await runCLI(root, {
      controls: { yes: true },
      humanInLoop: createHumanInLoop({
        provider
      })
    });

    expect(loggerState.error).toContain("Declined: Need ticket");
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders declined approvals without a reason as Declined.", async () => {
    const provider: HumanInLoopProvider = {
      id: "fake",
      requestApproval: vi.fn(async () => ({ outcome: "declined" }))
    };
    const handler = vi.fn(async () => "approved result");
    const command = defineCommand({
      name: "prod",
      params: S.Object({}),
      humanInLoop: {
        mode: "sync",
        message: ({ commandPath }) => `Run ${commandPath}?`
      },
      handler
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineGroup({
          name: "deploy",
          children: [command]
        })
      ]
    });

    process.argv = ["node", "toolcraft", "deploy", "prod", "--yes"];
    await runCLI(root, {
      controls: { yes: true },
      humanInLoop: createHumanInLoop({
        provider
      })
    });

    expect(loggerState.error).toContain("Declined.");
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks queued approvals with the host usage name provided by the caller", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "prod", "--yes"];
    await runCLI(createAsyncApprovalRoot(), {
      controls: { yes: true },
      rootUsageName: "poe-code",
      humanInLoop: createHumanInLoop({
        provider: { id: "fake", requestApproval: vi.fn(async () => ({ outcome: "approved" })) },
        taskList: await openApprovalTaskList()
      })
    });

    const stdout = readStdout(stdoutWrite);
    expect(stdout).toContain("Queued for human approval");
    expect(stdout).toMatch(/Track: {3}poe-code approvals show --approval-id \S+/);
    expect(stdout).not.toContain("toolcraft approvals show");
  });

  it("tracks queued approvals with the program name inferred from argv", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.argv = ["node", "/usr/local/bin/my-cli", "deploy", "prod", "--yes"];
    await runCLI(createAsyncApprovalRoot(), {
      controls: { yes: true },
      humanInLoop: createHumanInLoop({
        provider: { id: "fake", requestApproval: vi.fn(async () => ({ outcome: "approved" })) },
        taskList: await openApprovalTaskList()
      })
    });

    expect(readStdout(stdoutWrite)).toMatch(/Track: {3}my-cli approvals show --approval-id \S+/);
  });
});
