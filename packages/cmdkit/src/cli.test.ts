import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
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
  text: {
    heading: (value: string) => value,
    section: (value: string) => value,
    muted: (value: string) => value,
  },
  formatCommandList: (commands: Array<{ name: string; description: string }>) =>
    commands.map((command) => `  ${command.name}  ${command.description}`).join("\n"),
  formatOptionList: (options: Array<{ flags: string; description: string }>) =>
    options.map((option) => `  ${option.flags}  ${option.description}`).join("\n"),
  promptText: promptState.text,
  select: promptState.select,
  confirm: promptState.confirm,
  isCancel: promptState.isCancel,
  cancel: promptState.cancel,
  resetOutputFormatCache: promptState.resetOutputFormatCache,
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { runCLI } = await import("./cli.js");

const fixtureFilePath = fileURLToPath(new URL("./cli.test.fixture.json", import.meta.url));
const fixtureFileContents = `[
  {
    "name": "first scenario",
    "services": {
      "fetch": [
        {
          "request": {
            "method": "GET",
            "url": "https://example.com/items"
          },
          "response": {
            "status": 200,
            "body": {
              "scenario": "one"
            }
          }
        }
      ],
      "fs": {
        "readFile": {
          "/config.json": "scenario one"
        }
      }
    }
  },
  {
    "name": "named scenario",
    "services": {
      "fetch": [
        {
          "request": {
            "method": "GET",
            "url": "https://example.com/items"
          },
          "response": {
            "status": 200,
            "body": {
              "scenario": "named"
            }
          }
        }
      ],
      "fs": {
        "exists": {
          "/config.json": true
        },
        "readFile": {
          "/config.json": "named file"
        }
      }
    }
  },
  {
    "name": "no-op fallback",
    "services": {}
  }
]`;

type FixtureStoreService = {
  readValue(key: string): Promise<string | null>;
  writeValue(key: string, value: string): Promise<void>;
};

const fixtureCommand = defineCommand<{ store: FixtureStoreService }>({
  name: "fixture-demo",
  params: S.Object({}),
  secrets: {
    apiKey: {
      env: "API_KEY",
    },
  },
  handler: async ({ fetch, fs, secrets, store }) => {
    const matched = await fetch("https://example.com/items");
    const matchedBody = matched === null ? null : await matched.json();
    const unmatchedRead = await fetch("https://example.com/missing");
    const unmatchedWrite = await fetch("https://example.com/items", {
      method: "POST",
    });
    const file = await fs.readFile("/config.json");
    const missingFile = await fs.readFile("/missing.json");
    const exists = await fs.exists("/config.json");

    await fs.writeFile("/output.json", "ignored");
    const storeValue = await store.readValue("token");
    await store.writeValue("token", "updated");

    return {
      exists,
      file,
      matched: matchedBody,
      missingFile,
      secret: secrets.apiKey,
      storeValue,
      unmatchedReadStatus: unmatchedRead === null ? null : unmatchedRead.status,
      unmatchedWriteStatus: unmatchedWrite === null ? null : unmatchedWrite.status,
    };
  },
});

const fixtureRoot = defineGroup({
  name: "cmdkit",
  children: [fixtureCommand],
});

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
const originalFixtureSelector = process.env.CMDKIT_FIXTURE;

function setTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, value: boolean): void {
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value,
  });
}

function readStdout(stdoutWrite: ReturnType<typeof vi.spyOn>): string {
  return stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
}

describe("runCLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    vol.fromJSON({
      [fixtureFilePath]: fixtureFileContents,
    });
    resetLoggerState();
    promptState.isCancel.mockImplementation((value: unknown) => typeof value === "symbol");
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    process.env.OUTPUT_FORMAT = originalOutputFormat;
    delete process.env.CMDKIT_FIXTURE;
    setTTY(process.stdout, true);
    setTTY(process.stdin, true);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    process.env.OUTPUT_FORMAT = originalOutputFormat;
    process.env.CMDKIT_FIXTURE = originalFixtureSelector;

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

  it("merges preset values before CLI flags and only prompts for still-missing required params", async () => {
    const handler = vi.fn(async (ctx: {
      params: {
        service: string;
        region: string;
        replicas: number;
        mode: "safe" | "fast";
      };
    }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String(),
        region: S.String(),
        replicas: S.Number(),
        mode: S.Enum(["safe", "fast"] as const),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    vol.fromJSON({
      "/presets/staging.json": JSON.stringify({
        service: "api",
        region: "us-east-1",
        replicas: 1,
      }),
    });

    promptState.select.mockResolvedValueOnce("fast");
    process.argv = [
      "node",
      "cmdkit",
      "deploy",
      "--preset",
      "/presets/staging.json",
      "--replicas",
      "5",
    ];

    await runCLI(root);

    expect(promptState.text).not.toHaveBeenCalled();
    expect(promptState.select).toHaveBeenCalledWith({
      message: "mode",
      options: [
        { label: "safe", value: "safe" },
        { label: "fast", value: "fast" },
      ],
      initialValue: undefined,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      service: "api",
      region: "us-east-1",
      replicas: 5,
      mode: "fast",
    });
  });

  it("rejects preset files with unknown param keys", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String(),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    vol.fromJSON({
      "/presets/invalid.json": JSON.stringify({
        service: "api",
        unknown: "value",
      }),
    });

    process.argv = [
      "node",
      "cmdkit",
      "deploy",
      "--preset",
      "/presets/invalid.json",
      "--yes",
    ];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      'Preset file "/presets/invalid.json" contains unknown parameter "unknown".',
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports a clear error when the preset file does not exist", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String(),
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
      "--preset",
      "/presets/missing.json",
      "--yes",
    ];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      'Preset file "/presets/missing.json" was not found.',
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports a clear error when the preset file is not valid JSON", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String(),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    vol.fromJSON({
      "/presets/invalid-json.json": "{",
    });

    process.argv = [
      "node",
      "cmdkit",
      "deploy",
      "--preset",
      "/presets/invalid-json.json",
      "--yes",
    ];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      'Preset file "/presets/invalid-json.json" is not valid JSON.',
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports read errors other than file-not-found without masking them", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String(),
      }),
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    vol.mkdirSync("/presets/directory", {
      recursive: true,
    });

    process.argv = [
      "node",
      "cmdkit",
      "deploy",
      "--preset",
      "/presets/directory",
      "--yes",
    ];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toHaveLength(1);
    expect(loggerState.error[0]).toContain('Preset file "/presets/directory" could not be read:');
    expect(process.exitCode).toBe(1);
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
    expect(promptState.text).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      "Error: Missing required secret API_KEY\n  Set it in the environment before running this command.",
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("checks requirements before prompting for params", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String(),
      }),
      requires: {
        auth: true,
      },
      handler,
    });

    const root = defineGroup({
      name: "cmdkit",
      children: [deploy],
    });

    delete process.env.POE_API_KEY;
    process.argv = ["node", "cmdkit", "deploy"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(promptState.text).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      `Error: Command "deploy" requires authentication.\n  Run 'poe-code login' first.`,
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

  it("selects fixture scenarios by 1-based index", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const realStore = {
      readValue: vi.fn(async () => {
        throw new Error("real store read should not be used in fixture mode");
      }),
      writeValue: vi.fn(async () => {
        throw new Error("real store write should not be used in fixture mode");
      }),
    };

    process.env.CMDKIT_FIXTURE = "2";
    process.argv = ["node", "cmdkit", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: realStore,
      },
    });

    const payload = JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(""));
    expect(payload).toEqual({
      exists: true,
      file: "named file",
      matched: {
        scenario: "named",
      },
      missingFile: null,
      secret: "fixture-secret",
      storeValue: null,
      unmatchedReadStatus: null,
      unmatchedWriteStatus: 204,
    });
    expect(realStore.readValue).not.toHaveBeenCalled();
    expect(realStore.writeValue).not.toHaveBeenCalled();
  });

  it("selects fixture scenarios by name and matches fetch by method plus url", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.env.CMDKIT_FIXTURE = "named scenario";
    process.argv = ["node", "cmdkit", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: {
          readValue: async () => "live value",
          writeValue: async () => undefined,
        },
      },
    });

    const payload = JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(""));
    expect(payload.matched).toEqual({
      scenario: "named",
    });
    expect(payload.file).toBe("named file");
    expect(payload.unmatchedReadStatus).toBeNull();
    expect(payload.unmatchedWriteStatus).toBe(204);
  });

  it("falls back to safe no-ops for services omitted from the fixture scenario", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const realStore = {
      readValue: vi.fn(async () => "live value"),
      writeValue: vi.fn(async () => undefined),
    };

    process.env.CMDKIT_FIXTURE = "no-op fallback";
    process.argv = ["node", "cmdkit", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: realStore,
      },
    });

    const payload = JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(""));
    expect(payload).toEqual({
      exists: false,
      file: null,
      matched: null,
      missingFile: null,
      secret: "fixture-secret",
      storeValue: null,
      unmatchedReadStatus: null,
      unmatchedWriteStatus: 204,
    });
    expect(realStore.readValue).not.toHaveBeenCalled();
    expect(realStore.writeValue).not.toHaveBeenCalled();
  });

  it("renders root help with breadcrumb path", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => null,
    });

    const generate = defineGroup({
      name: "generate",
      children: [deploy],
    });

    const root = defineGroup({
      name: "poe-code",
      children: [generate],
    });

    process.argv = ["node", "poe-code", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, {
      version: "1.2.3",
    });

    expect(readStdout(stdoutWrite)).toContain("poe-code\n");
    expect(process.exitCode).toBeUndefined();
  });

  it("passes positional arguments to a nested group's default command", async () => {
    const handler = vi.fn(async ({ params }: { params: { name: string } }) => params);

    const run = defineCommand({
      name: "run",
      positional: ["name"],
      params: S.Object({
        name: S.String(),
      }),
      handler,
    });

    const githubWorkflows = defineGroup({
      name: "github-workflows",
      children: [run],
      default: run,
    });

    const root = defineGroup({
      name: "poe-code",
      children: [githubWorkflows],
    });

    process.argv = ["node", "poe-code", "github-workflows", "demo", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          name: "demo",
        },
      })
    );
  });

  it("renders leaf help with inherited secrets", async () => {
    const textCommand = defineCommand({
      name: "text",
      description: "Generate text.",
      params: S.Object({
        prompt: S.String({
          description: "Generation prompt",
        }),
        model: S.String({
          description: "Model identifier",
          default: "GPT-4.1",
        }),
      }),
      handler: async () => null,
    });

    const generate = defineGroup({
      name: "generate",
      description: "Generate content via Poe API.",
      secrets: {
        apiKey: {
          env: "POE_API_KEY",
          description: "Inherited from generate group",
        },
      },
      children: [textCommand],
    });

    const root = defineGroup({
      name: "poe-code",
      children: [generate],
    });

    process.argv = ["node", "poe-code", "generate", "text", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("poe-code generate text");
    expect(output).toContain("Options:");
    expect(output).toContain("--prompt <string>");
    expect(output).toContain("Generation prompt (required)");
    expect(output).toContain("--model <string>");
    expect(output).toContain("Model identifier (default: GPT-4.1)");
    expect(output).toContain("Global options:");
    expect(output).toContain("--preset");
    expect(output).toContain("--yes");
    expect(output).toContain("Secrets (via environment):");
    expect(output).toContain("POE_API_KEY");
    expect(output).toContain("Inherited from generate group");
  });

  it("filters help command listings to the cli scope", async () => {
    const visibleCommand = defineCommand({
      name: "text",
      description: "Generate text",
      params: S.Object({}),
      handler: async () => null,
    });
    const hiddenCommand = defineCommand({
      name: "invoke",
      description: "Internal SDK helper",
      params: S.Object({}),
      scope: ["sdk"],
      handler: async () => null,
    });

    const generate = defineGroup({
      name: "generate",
      description: "Generate content via Poe API.",
      children: [visibleCommand, hiddenCommand],
    });

    const root = defineGroup({
      name: "poe-code",
      children: [generate],
    });

    process.argv = ["node", "poe-code", "generate", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("Commands:");
    expect(output).toContain("text");
    expect(output).not.toContain("invoke");
  });
});
