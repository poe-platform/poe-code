import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import { defineCommand, defineGroup } from "../index.js";

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

describe("human-in-loop CLI runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      humanInLoop: {
        provider
      }
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
      humanInLoop: {
        provider
      }
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
      humanInLoop: {
        provider
      }
    });

    expect(loggerState.error).toContain("Declined.");
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });
});
