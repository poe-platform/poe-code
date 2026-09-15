import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup, UserError } from "./index.js";
import { runCLI } from "./cli.js";
import { ApprovalDeclinedError, createHumanInLoop } from "./human-in-loop/index.js";
import type { HumanInLoopPending } from "./human-in-loop/index.js";

const previousExitCode = process.exitCode;
const pending: HumanInLoopPending = {
  status: "pending-approval",
  approvalId: "approval-123",
  message: "Deploy the sample?",
  enqueuedAt: "2026-09-05T06:00:00.000Z",
  planHash: "sample-plan"
};

beforeEach(() => { process.exitCode = 0; });
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
});

describe.each([false, true])("approval output with capture=%s", (capture) => {
  it.each(["rich", "json", "markdown", "audit"])('renders pending approval as %s without invoking the success renderer', async (format) => {
    const handler = vi.fn(() => ({ deployed: true }));
    const successRenderer = vi.fn(() => { throw new Error("Only deployed results belong here"); });
    const customRenderer = vi.fn(({ result }: { result: unknown }) => `CUSTOM:${JSON.stringify(result)}\n`);
    const command = defineCommand({
      name: "deploy",
      params: S.Object({}),
      humanInLoop: { mode: "async", message: () => "Deploy the sample?" },
      render: { json: successRenderer, markdown: successRenderer, rich: successRenderer },
      handler
    });
    const runtime = createHumanInLoop({ provider: { id: "test", requestApproval: vi.fn() } });
    vi.spyOn(runtime, "invoke").mockResolvedValue(pending);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const output: string[] = [];

    await runCLI(defineGroup({ name: "audit", children: [command] }), {
      argv: ["node", "audit", "deploy", "--output", format],
      controls: { output: { formats: { audit: customRenderer } } },
      humanInLoop: runtime,
      errorReports: false,
      ...(capture ? { outputEmitter: (entry: string) => output.push(entry) } : {})
    });

    const text = capture ? output.join("\n") : stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(process.exitCode).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect(successRenderer).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    if (capture) expect(stdout).not.toHaveBeenCalled();
    if (format === "json") expect(JSON.parse(text)).toEqual(pending);
    else if (format === "audit") {
      expect(text).toBe(`CUSTOM:${JSON.stringify(pending)}\n`);
      expect(customRenderer).toHaveBeenCalledWith(expect.objectContaining({ result: pending, commandPath: "deploy" }));
    } else if (format === "rich") {
      expect(text).toContain("Queued for human approval");
      expect(text).toContain("audit approvals show --approval-id approval-123");
    } else {
      expect(text).toContain("pending-approval");
      expect(text).toContain("approval-123");
      expect(text).toContain("sample-plan");
    }
  });

  it.each(["rich", "json", "markdown"])('routes declined approvals like user errors in %s mode', async (format) => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const observed: string[] = [];
    for (const failure of [new UserError("Declined: not now"), new ApprovalDeclinedError({ commandPath: "deploy", reason: "not now" })]) {
      stdout.mockClear();
      stderr.mockClear();
      const output: string[] = [];
      const command = defineCommand({ name: "deploy", params: S.Object({}), handler() { throw failure; } });
      await runCLI(defineGroup({ name: "audit", children: [command] }), {
        argv: ["node", "audit", "deploy", "--output", format],
        controls: { output: true },
        errorReports: false,
        ...(capture ? { outputEmitter: (entry: string) => output.push(entry) } : {})
      });
      expect(process.exitCode).toBe(1);
      const text = capture ? output.join("\n") : stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(text).toContain("Declined: not now");
      expect(text).not.toContain("--help");
      if (capture) expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      observed.push(text);
    }
    expect(observed[1]).toBe(observed[0]);
  });
});

describe.each([false, true])("early CLI errors with capture=%s", (capture) => {
  it.each([
    { format: "rich", nested: false }, { format: "json", nested: false }, { format: "markdown", nested: false },
    { format: "rich", nested: true }, { format: "json", nested: true }, { format: "markdown", nested: true }
  ])("routes unknown commands in $format mode, nested=$nested", async ({ format, nested }) => {
    const handler = vi.fn();
    const command = defineCommand({ name: "hello", params: S.Object({}), handler });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const output: string[] = [];
    await runCLI(defineGroup({ name: "audit", children: [nested ? defineGroup({ name: "group", children: [command] }) : command] }), {
      argv: ["node", "audit", ...(nested ? ["group"] : []), "helo", "--output", format],
      controls: { output: true },
      errorReports: false,
      ...(capture ? { outputEmitter: (entry: string) => output.push(entry) } : {})
    });
    expect(process.exitCode).toBe(1);
    const text = capture ? output.join("\n") : stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(text).toContain("Unknown command");
    expect(text).toContain("hello");
    expect(text).toContain(nested ? "audit group --help" : "audit --help");
    if (!capture && format === "json") expect(JSON.parse(text)).toMatchObject({ level: "error", message: expect.stringContaining("Unknown command") });
    expect(handler).not.toHaveBeenCalled();
    if (capture) expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("real synchronous approval controls", () => {
  it.each(["rich", "json", "markdown"])("retains successful command renderers in %s mode", async (format) => {
    const handler = vi.fn(() => ({ deployed: true }));
    const renderer = vi.fn(() => "Approved and deployed");
    const provider = { id: "test", requestApproval: vi.fn(async () => ({ outcome: "approved" as const })) };
    const command = defineCommand({
      name: "deploy", params: S.Object({}), handler,
      humanInLoop: { mode: "sync", message: () => "Deploy?" },
      render: { rich: renderer, json: renderer, markdown: renderer }
    });
    await runCLI(defineGroup({ name: "audit", children: [command] }), {
      argv: ["node", "audit", "deploy", "--output", format],
      controls: { output: true }, humanInLoop: createHumanInLoop({ provider }),
      errorReports: false, outputEmitter: () => {}
    });
    expect(process.exitCode).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
    expect(provider.requestApproval).toHaveBeenCalledOnce();
    expect(renderer).toHaveBeenCalledWith({ deployed: true }, expect.any(Object));
  });

  it.each(["rich", "json", "markdown"])("captures provider declines without executing the command in %s mode", async (format) => {
    const handler = vi.fn();
    const provider = { id: "test", requestApproval: vi.fn(async () => ({ outcome: "declined" as const, reason: "not now" })) };
    const command = defineCommand({
      name: "deploy", params: S.Object({}), handler,
      humanInLoop: { mode: "sync", message: () => "Deploy?" }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const output: string[] = [];
    await runCLI(defineGroup({ name: "audit", children: [command] }), {
      argv: ["node", "audit", "deploy", "--output", format],
      controls: { output: true }, humanInLoop: createHumanInLoop({ provider }),
      errorReports: false, outputEmitter: (entry) => output.push(entry)
    });
    expect(process.exitCode).toBe(1);
    expect(output).toEqual(["Declined: not now"]);
    expect(stdout).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(provider.requestApproval).toHaveBeenCalledOnce();
  });
});
