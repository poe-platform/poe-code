import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "@poe-code/cmdkit-schema";
import { UserError, defineCommand, defineGroup } from "./index.js";

const loggerState = {
  info: [] as string[],
  success: [] as string[],
  warn: [] as string[],
  error: [] as string[],
  resolved: [] as Array<{ label: string; value: string }>,
  errorResolved: [] as Array<{ label: string; value: string }>,
  message: [] as string[],
};

const promptState = {
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
  cancel: vi.fn(),
  resetOutputFormatCache: vi.fn(),
};

vi.mock("@poe-code/design-system", () => ({
  createLogger: () => ({
    info: (message: string) => loggerState.info.push(message),
    success: (message: string) => loggerState.success.push(message),
    warn: (message: string) => loggerState.warn.push(message),
    error: (message: string) => loggerState.error.push(message),
    resolved: (label: string, value: string) => loggerState.resolved.push({ label, value }),
    errorResolved: (label: string, value: string) =>
      loggerState.errorResolved.push({ label, value }),
    message: (message: string) => loggerState.message.push(message),
  }),
  renderTable: vi.fn(() => "table"),
  getTheme: vi.fn(() => ({
    header: (value: string) => value,
    muted: (value: string) => value,
  })),
  promptText: promptState.text,
  select: promptState.select,
  confirm: promptState.confirm,
  isCancel: promptState.isCancel,
  cancel: promptState.cancel,
  resetOutputFormatCache: promptState.resetOutputFormatCache,
}));

const { runCLI } = await import("./cli.js");

function resetLoggerState(): void {
  loggerState.info.length = 0;
  loggerState.success.length = 0;
  loggerState.warn.length = 0;
  loggerState.error.length = 0;
  loggerState.resolved.length = 0;
  loggerState.errorResolved.length = 0;
  loggerState.message.length = 0;
}

const originalArgv = [...process.argv];
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const originalOutputFormat = process.env.OUTPUT_FORMAT;

function setTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, value: boolean): void {
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value,
  });
}

describe("runCLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLoggerState();
    promptState.isCancel.mockImplementation((value: unknown) => typeof value === "symbol");
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    process.env.OUTPUT_FORMAT = originalOutputFormat;
    setTTY(process.stdout, true);
    setTTY(process.stdin, true);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    process.env.OUTPUT_FORMAT = originalOutputFormat;

    if (stdoutTTY) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    }
    if (stdinTTY) {
      Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    }
  });

  it("parses nested params, arrays, booleans, enums, and positionals with kebab casing", async () => {
    const handler = vi.fn(async (ctx: {
      params: {
        name: string;
        dryRun?: boolean;
        retryCount: number;
        mode: "safe" | "fast";
        tags: string[];
        database: { host: string };
      };
      marker: string;
    }) => {
      expect(ctx.marker).toBe("service");
      return ctx.params;
    });

    const renderJson = vi.fn((result: unknown) => result);

    const deploy = defineCommand({
      name: "deploy",
      positional: ["name"],
      params: S.Object({
        name: S.String(),
        dryRun: S.Optional(S.Boolean()),
        retryCount: S.Number(),
        mode: S.Enum(["safe", "fast"] as const),
        tags: S.Array(S.String()),
        database: S.Object({
          host: S.String(),
        }),
      }),
      handler,
      render: {
        json: renderJson,
      },
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    process.argv = [
      "node",
      "cmdkit",
      "deploy",
      "demo-app",
      "--dry-run",
      "--retry-count",
      "3",
      "--mode",
      "safe",
      "--tags",
      "alpha,beta",
      "gamma",
      "--database.host",
      "db.internal",
      "--output",
      "json",
      "--yes",
    ];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, {
      services: {
        marker: "service",
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-app",
      dryRun: true,
      retryCount: 3,
      mode: "safe",
      tags: ["alpha", "beta", "gamma"],
      database: {
        host: "db.internal",
      },
    });
    expect(renderJson).toHaveBeenCalledWith(
      {
        name: "demo-app",
        dryRun: true,
        retryCount: 3,
        mode: "safe",
        tags: ["alpha", "beta", "gamma"],
        database: {
          host: "db.internal",
        },
      },
      expect.objectContaining({
        logger: expect.any(Object),
        renderTable: expect.any(Function),
        getTheme: expect.any(Function),
      })
    );
    expect(stdoutWrite).toHaveBeenCalledWith(
      `${JSON.stringify(handler.mock.results[0]?.value ? await handler.mock.results[0]?.value : {}, null, 2)}\n`
    );
  });

  it("supports snake casing for generated option names", async () => {
    const handler = vi.fn(async (ctx: { params: { dryRun: boolean; retryCount: number } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        dryRun: S.Boolean(),
        retryCount: S.Number(),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    process.argv = [
      "node",
      "cmdkit",
      "deploy",
      "--dry_run",
      "--retry_count",
      "5",
      "--yes",
    ];

    await runCLI(root, {
      casing: "snake",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      dryRun: true,
      retryCount: 5,
    });
  });

  it("prompts for missing required params, uses select for enums, and confirms resolved values", async () => {
    const handler = vi.fn(async (ctx: { params: { name: string; mode: "safe" | "fast" } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      confirm: true,
      params: S.Object({
        name: S.String({
          default: "demo-service",
        }),
        mode: S.Enum(["safe", "fast"] as const),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    promptState.text.mockResolvedValueOnce("demo-service");
    promptState.select.mockResolvedValueOnce("fast");
    promptState.confirm.mockResolvedValueOnce(true);

    process.argv = ["node", "cmdkit", "deploy"];

    await runCLI(root);

    expect(promptState.text).toHaveBeenCalledWith({
      message: "name",
      initialValue: "demo-service",
    });
    expect(promptState.select).toHaveBeenCalledWith({
      message: "mode",
      options: [
        { label: "safe", value: "safe" },
        { label: "fast", value: "fast" },
      ],
      initialValue: undefined,
    });
    expect(loggerState.resolved).toEqual([
      { label: "name", value: "demo-service" },
      { label: "mode", value: "fast" },
    ]);
    expect(promptState.confirm).toHaveBeenCalledWith({
      message: "Proceed?",
      initialValue: true,
    });
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-service",
      mode: "fast",
    });
  });

  it("accepts the default when prompt text returns an empty string", async () => {
    const handler = vi.fn(async (ctx: { params: { name: string } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String({
          default: "demo-service",
        }),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    promptState.text.mockResolvedValueOnce("");
    process.argv = ["node", "cmdkit", "deploy"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-service",
    });
  });

  it("skips prompts when stdin is not a TTY and uses defaults", async () => {
    const handler = vi.fn(async (ctx: { params: { name: string; optional?: string } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String({
          default: "demo-service",
        }),
        optional: S.Optional(S.String()),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    setTTY(process.stdin, false);
    process.argv = ["node", "cmdkit", "deploy", "--yes"];

    await runCLI(root);

    expect(promptState.text).not.toHaveBeenCalled();
    expect(promptState.select).not.toHaveBeenCalled();
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-service",
    });
  });

  it("auto-switches output to json when stdout is not a TTY", async () => {
    const renderRich = vi.fn();
    const renderJson = vi.fn((result: unknown) => result);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => ({
        ok: true,
      }),
      render: {
        rich: renderRich,
        json: renderJson,
      },
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    setTTY(process.stdout, false);
    process.argv = ["node", "cmdkit", "deploy", "--yes"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(renderRich).not.toHaveBeenCalled();
    expect(renderJson).toHaveBeenCalledWith(
      {
        ok: true,
      },
      expect.objectContaining({
        logger: expect.any(Object),
        renderTable: expect.any(Function),
        getTheme: expect.any(Function),
      })
    );
    expect(stdoutWrite).toHaveBeenCalledWith('{\n  "ok": true\n}\n');
  });

  it("reports validation errors when prompts are skipped and required params are missing", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String(),
      }),
      handler: async () => null,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    setTTY(process.stdin, false);
    process.argv = ["node", "cmdkit", "deploy"];

    await runCLI(root);

    expect(promptState.text).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual(['Missing required parameter "name".']);
    expect(process.exitCode).toBe(1);
  });

  it("prints UserError messages without the verbose hint", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw new UserError("Invalid input.");
      },
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    process.argv = ["node", "cmdkit", "deploy", "--yes"];

    await runCLI(root);

    expect(loggerState.error).toEqual(["Invalid input."]);
    expect(process.exitCode).toBe(1);
  });

  it("reports missing required secrets before running the handler", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      secrets: {
        apiKey: {
          env: "API_KEY",
          description: "Set it in the environment before running this command.",
        },
      },
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    delete process.env.API_KEY;
    process.argv = ["node", "cmdkit", "deploy", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      "Missing required secret API_KEY.\nSet it in the environment before running this command.",
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("prints unexpected errors with a verbose hint and stack trace in verbose mode", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw new Error("Boom.");
      },
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "cmdkit", "deploy", "--yes"];
    await runCLI(root);

    expect(loggerState.error).toEqual(["Boom. Use --verbose for a stack trace."]);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    resetLoggerState();
    stderrWrite.mockClear();
    process.exitCode = undefined;
    process.argv = ["node", "cmdkit", "deploy", "--yes", "--verbose"];

    await runCLI(root);

    expect(loggerState.error).toEqual(["Boom."]);
    expect(stderrWrite).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("throws on reserved service name collisions", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => null,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    await expect(
      runCLI(root, {
        services: {
          params: "bad",
        },
      })
    ).rejects.toThrow('Service name "params" is reserved. Choose a different name.');
  });
});
