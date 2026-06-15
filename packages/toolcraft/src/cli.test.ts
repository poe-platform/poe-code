import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { S } from "toolcraft-schema";
import {
  ApprovalDeclinedError,
  ToolcraftBugError,
  UserError,
  defineCommand,
  defineGroup
} from "./index.js";

const loggerState = {
  info: [] as string[],
  success: [] as string[],
  warn: [] as string[],
  error: [] as string[],
  resolved: [] as Array<{ label: string; value: string }>,
  errorResolved: [] as Array<{ label: string; value: string }>,
  message: [] as string[]
};

const promptState = {
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
  cancel: vi.fn(),
  resetOutputFormatCache: vi.fn()
};

const formatterState = {
  plainCommandListCalls: 0,
  plainOptionListCalls: 0
};

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(Object.prototype, key, descriptor);
      } else {
        delete (Object.prototype as Record<string, unknown>)[key];
      }
    }
  }
}

vi.mock("toolcraft-design", () => ({
  configureTheme: vi.fn(),
  createLogger: () => ({
    info: (message: string) => loggerState.info.push(message),
    success: (message: string) => loggerState.success.push(message),
    warn: (message: string) => loggerState.warn.push(message),
    error: (message: string) => loggerState.error.push(message),
    resolved: (label: string, value: string) => loggerState.resolved.push({ label, value }),
    errorResolved: (label: string, value: string) =>
      loggerState.errorResolved.push({ label, value }),
    message: (message: string) => loggerState.message.push(message)
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
    error: (value: string) => value,
    muted: (value: string) => value,
    usageCommand: (value: string) => value
  },
  formatCommandList: (commands: Array<{ name: string; description: string }>) =>
    formatMockColumns(
      commands.map((command) => ({ left: command.name, right: command.description }))
    ),
  formatOptionList: (options: Array<{ flags: string; description: string }>) =>
    formatMockColumns(options.map((option) => ({ left: option.flags, right: option.description }))),
  helpFormatterPlain: {
    formatCommandList: (commands: Array<{ name: string; description: string }>) => {
      formatterState.plainCommandListCalls += 1;
      return formatMockColumns(
        commands.map((command) => ({ left: command.name, right: command.description }))
      );
    },
    formatOptionList: (options: Array<{ flags: string; description: string }>) => {
      formatterState.plainOptionListCalls += 1;
      return formatMockColumns(
        options.map((option) => ({ left: option.flags, right: option.description }))
      );
    }
  },
  promptText: promptState.text,
  select: promptState.select,
  confirm: promptState.confirm,
  isCancel: promptState.isCancel,
  cancel: promptState.cancel,
  resetOutputFormatCache: promptState.resetOutputFormatCache,
  note: vi.fn()
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { runCLI: runCLIWithoutControls } = await import("./cli.js");
const runCLI: typeof runCLIWithoutControls = (roots, options = {}) =>
  runCLIWithoutControls(roots, {
    approvals: true,
    controls: {
      debug: true,
      output: true,
      verbose: true,
      yes: true
    },
    ...options
  });

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
      env: "API_KEY"
    }
  },
  handler: async ({ fetch, fs, secrets, store }) => {
    const matched = await fetch("https://example.com/items");
    const matchedBody = matched === null ? null : await matched.json();
    const unmatchedRead = await fetch("https://example.com/missing");
    const unmatchedWrite = await fetch("https://example.com/items", {
      method: "POST"
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
      unmatchedWriteStatus: unmatchedWrite === null ? null : unmatchedWrite.status
    };
  }
});

const fixtureRoot = defineGroup({
  name: "toolcraft",
  children: [fixtureCommand]
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
const stdoutColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const originalOutputFormat = process.env.OUTPUT_FORMAT;
const originalFixtureSelector = process.env.TOOLCRAFT_FIXTURE;

function formatMockColumns(rows: Array<{ left: string; right: string }>): string {
  if (typeof process.stdout.columns !== "number") {
    return rows
      .map((row) => (row.right.length === 0 ? `  ${row.left}` : `  ${row.left}  ${row.right}`))
      .join("\n");
  }

  const maxLeftContentWidth = Math.max(...rows.map((row) => row.left.length), 0);
  const leftWidth = Math.min(Math.max(maxLeftContentWidth + 3, 12), 32);
  const rightWidth = Math.max(20, process.stdout.columns - leftWidth - 2);
  const continuationIndent = " ".repeat(2 + leftWidth);

  return rows
    .flatMap((row) => {
      if (row.right.length === 0) {
        return [`  ${row.left}`];
      }

      const words = row.right.split(" ").filter((word) => word.length > 0);
      const rightLines: string[] = [];
      let line = "";

      for (const word of words) {
        if (line.length === 0) {
          line = word;
          continue;
        }

        if (line.length + 1 + word.length <= rightWidth) {
          line = `${line} ${word}`;
          continue;
        }

        rightLines.push(line);
        line = word;
      }

      rightLines.push(line);

      if (row.left.length > leftWidth) {
        return [
          `  ${row.left}`,
          ...rightLines.map((rightLine) => `${continuationIndent}${rightLine}`)
        ];
      }

      return [
        `  ${row.left}${" ".repeat(leftWidth - row.left.length)}${rightLines[0] ?? ""}`,
        ...rightLines.slice(1).map((rightLine) => `${continuationIndent}${rightLine}`)
      ];
    })
    .join("\n");
}

function setTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, value: boolean): void {
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value
  });
}

function setStdoutColumns(value: number): void {
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value
  });
}

function restoreOutputFormat(): void {
  if (originalOutputFormat === undefined) {
    delete process.env.OUTPUT_FORMAT;
  } else {
    process.env.OUTPUT_FORMAT = originalOutputFormat;
  }
}

function readStdout(stdoutWrite: ReturnType<typeof vi.spyOn>): string {
  return stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
}

function readStderr(stderrWrite: ReturnType<typeof vi.spyOn>): string {
  return stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
}

function withUsagePointer(message: string, commandPath: string): string {
  return `${message}\nRun toolcraft ${commandPath} --help for usage.`;
}

function createHttpErrorLike(
  overrides: {
    request?: {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    response?: {
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    stack?: string;
  } = {}
): Error & {
  name: "HttpError";
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
} {
  const error = new Error(
    "GET https://api.example.com/v1/widgets/42 -> 500 Internal Server Error"
  ) as Error & {
    name: "HttpError";
    request: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: unknown;
    };
    response: {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: unknown;
    };
  };

  error.name = "HttpError";
  error.request = {
    method: overrides.request?.method ?? "GET",
    url: overrides.request?.url ?? "https://api.example.com/v1/widgets/42",
    headers: overrides.request?.headers ?? {
      authorization: "Bearer ****"
    },
    body: overrides.request?.body
  };
  error.response = {
    status: overrides.response?.status ?? 500,
    statusText: overrides.response?.statusText ?? "Internal Server Error",
    headers: overrides.response?.headers ?? {
      "content-type": "application/json",
      "x-request-id": "8f3c"
    },
    body: overrides.response?.body ?? {
      error: "internal_panic",
      trace_id: "8f3c-123"
    }
  };
  error.stack = overrides.stack ?? "HttpError: request failed\n    at fake-handler";
  return error;
}

describe("runCLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    vol.fromJSON({
      [fixtureFilePath]: fixtureFileContents
    });
    resetLoggerState();
    formatterState.plainCommandListCalls = 0;
    formatterState.plainOptionListCalls = 0;
    promptState.isCancel.mockImplementation((value: unknown) => typeof value === "symbol");
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    restoreOutputFormat();
    delete process.env.TOOLCRAFT_FIXTURE;
    setTTY(process.stdout, true);
    setTTY(process.stdin, true);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    restoreOutputFormat();
    process.env.TOOLCRAFT_FIXTURE = originalFixtureSelector;

    if (stdoutTTY) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    }
    if (stdoutColumns) {
      Object.defineProperty(process.stdout, "columns", stdoutColumns);
    } else {
      Reflect.deleteProperty(process.stdout, "columns");
    }
    if (stdinTTY) {
      Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    }
  });

  it("parses nested params, arrays, booleans, enums, and positionals with kebab casing", async () => {
    const handler = vi.fn(
      async (ctx: {
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
      }
    );

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
          host: S.String()
        })
      }),
      handler,
      render: {
        json: renderJson
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = [
      "node",
      "toolcraft",
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
      "--yes"
    ];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, {
      services: {
        marker: "service"
      }
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-app",
      dryRun: true,
      retryCount: 3,
      mode: "safe",
      tags: ["alpha", "beta", "gamma"],
      database: {
        host: "db.internal"
      }
    });
    expect(renderJson).toHaveBeenCalledWith(
      {
        name: "demo-app",
        dryRun: true,
        retryCount: 3,
        mode: "safe",
        tags: ["alpha", "beta", "gamma"],
        database: {
          host: "db.internal"
        }
      },
      expect.objectContaining({
        logger: expect.any(Object),
        renderTable: expect.any(Function),
        getTheme: expect.any(Function)
      })
    );
    expect(stdoutWrite).toHaveBeenCalledWith(
      `${JSON.stringify(handler.mock.results[0]?.value ? await handler.mock.results[0]?.value : {}, null, 2)}\n`
    );
  });

  it("supports snake casing for generated option names", async () => {
    const handler = vi.fn(
      async (ctx: { params: { dryRun: boolean; retryCount: number } }) => ctx.params
    );

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        dryRun: S.Boolean(),
        retryCount: S.Number()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--dry_run", "--retry_count", "5", "--yes"];

    await runCLI(root, {
      casing: "snake"
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      dryRun: true,
      retryCount: 5
    });
  });

  it("accepts --flag true and --flag false as explicit boolean values", async () => {
    const handler = vi.fn(
      async (ctx: { params: { enabled: boolean; disabled: boolean } }) => ctx.params
    );

    const toggle = defineCommand({
      name: "toggle",
      params: S.Object({
        enabled: S.Boolean(),
        disabled: S.Boolean()
      }),
      handler
    });

    const root = defineGroup({ name: "toolcraft", children: [toggle] });

    process.argv = [
      "node",
      "toolcraft",
      "toggle",
      "--enabled",
      "true",
      "--disabled",
      "false",
      "--yes"
    ];
    await runCLI(root);

    expect(handler.mock.calls[0]?.[0].params).toEqual({ enabled: true, disabled: false });
  });

  it("accepts --flag (no value) as true and --no-flag as false for boolean params", async () => {
    const handler = vi.fn(
      async (ctx: { params: { enabled: boolean; disabled: boolean } }) => ctx.params
    );

    const toggle = defineCommand({
      name: "toggle",
      params: S.Object({
        enabled: S.Boolean(),
        disabled: S.Boolean()
      }),
      handler
    });

    const root = defineGroup({ name: "toolcraft", children: [toggle] });

    process.argv = ["node", "toolcraft", "toggle", "--enabled", "--no-disabled", "--yes"];
    await runCLI(root);

    expect(handler.mock.calls[0]?.[0].params).toEqual({ enabled: true, disabled: false });
  });

  it("rejects invalid boolean values for --flag <value>", async () => {
    const handler = vi.fn(async (ctx: { params: { enabled: boolean } }) => ctx.params);

    const toggle = defineCommand({
      name: "toggle",
      params: S.Object({ enabled: S.Boolean() }),
      handler
    });

    const root = defineGroup({ name: "toolcraft", children: [toggle] });

    process.argv = ["node", "toolcraft", "toggle", "--enabled", "yes"];

    await runCLI(root);

    expect(loggerState.error.join("\n")).toContain(
      'Invalid value for "enabled". Expected true or false, got "yes".'
    );
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("suggests close unknown commands without Commander's default unknown command text", async () => {
    const widgets = defineCommand({
      name: "widgets",
      params: S.Object({}),
      handler: async () => "ok"
    });
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => "ok"
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [deploy, widgets]
    });
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "widgts", "list"];
    await runCLI(root);

    expect(loggerState.error).toEqual([
      [
        'Unknown command "widgts".',
        "Did you mean: widgets?",
        "Run toolcraft --help for usage."
      ].join("\n")
    ]);
    const stderr = readStderr(stderrWrite);
    expect(stderr).not.toContain("error: unknown command");
    expect(stderr).not.toContain("Usage:");
  });

  it("adds a usage pointer for unknown commands inside a group context", async () => {
    const production = defineCommand({
      name: "production",
      params: S.Object({}),
      handler: async () => "ok"
    });
    const deploy = defineGroup({
      name: "deploy",
      children: [production]
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "prodction"];
    await runCLI(root);

    expect(loggerState.error).toEqual([
      [
        'Unknown command "prodction".',
        "Did you mean: production?",
        "Run toolcraft deploy --help for usage."
      ].join("\n")
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("does not suggest distant unknown commands for short inputs", async () => {
    const xyz = defineCommand({
      name: "xyz",
      params: S.Object({}),
      handler: async () => "ok"
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [xyz]
    });

    process.argv = ["node", "toolcraft", "abc"];
    await runCLI(root);

    expect(loggerState.error).toEqual([
      ['Unknown command "abc".', "Run toolcraft --help for usage."].join("\n")
    ]);
  });

  it("suggests close unknown options from the current command", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.Optional(S.String()),
        namespace: S.Optional(S.String())
      }),
      handler: async () => "ok"
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--namee", "Ada"];
    await runCLI(root);

    expect(loggerState.error).toEqual([
      [
        'Unknown option "--namee".',
        "Did you mean: --name?",
        "Run toolcraft deploy --help for usage."
      ].join("\n")
    ]);
    expect(readStderr(stderrWrite)).not.toContain("error: unknown option");
  });

  it("does not suggest distant unknown options for short inputs", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        xyz: S.Optional(S.String())
      }),
      handler: async () => "ok"
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--abc", "Ada"];
    await runCLI(root);

    expect(loggerState.error).toEqual([
      ['Unknown option "--abc".', "Run toolcraft deploy --help for usage."].join("\n")
    ]);
  });

  it("rejects fractional values for integer-flavored number params", async () => {
    const handler = vi.fn(async (ctx: { params: { count: number } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        count: S.Number({
          jsonType: "integer"
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--count", "1.5"];

    await runCLI(root);

    expect(loggerState.error.join("\n")).toContain(
      'Invalid value for "count". Expected an integer, got "1.5".'
    );
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("prepends enum suggestions without replacing the expected values list", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        mode: S.Enum(["safe", "fast"] as const)
      }),
      handler: async () => "ok"
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--mode", "fats"];
    await runCLI(root);

    expect(loggerState.error.join("\n")).toContain(
      "Did you mean: fast?\nExpected one of: safe, fast"
    );
  });

  it("does not suggest distant enum values for short inputs", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        mode: S.Enum(["xyz"] as const)
      }),
      handler: async () => "ok"
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--mode", "abc"];
    await runCLI(root);

    const renderedError = loggerState.error.join("\n");
    expect(renderedError).not.toContain("Did you mean");
    expect(renderedError).toContain('Expected one of: xyz, got "abc".');
  });

  it("prompts for missing required params, uses select for enums, and confirms resolved values", async () => {
    const handler = vi.fn(
      async (ctx: { params: { name: string; mode: "safe" | "fast" } }) => ctx.params
    );

    const deploy = defineCommand({
      name: "deploy",
      confirm: true,
      params: S.Object({
        name: S.String({
          default: "demo-service"
        }),
        mode: S.Enum(["safe", "fast"] as const)
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    promptState.text.mockResolvedValueOnce("demo-service");
    promptState.select.mockResolvedValueOnce("fast");
    promptState.confirm.mockResolvedValueOnce(true);

    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(promptState.text).toHaveBeenCalledWith({
      message: "--name",
      initialValue: "demo-service"
    });
    expect(promptState.select).toHaveBeenCalledWith({
      message: "--mode",
      options: [
        { label: "safe", value: "safe" },
        { label: "fast", value: "fast" }
      ],
      initialValue: undefined
    });
    expect(loggerState.resolved).toEqual([
      { label: "name", value: "demo-service" },
      { label: "mode", value: "fast" }
    ]);
    expect(promptState.confirm).toHaveBeenCalledWith({
      message: "Proceed?",
      initialValue: true
    });
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-service",
      mode: "fast"
    });
  });

  it("labels option prompts with the kebab-case flag the user must actually type", async () => {
    const handler = vi.fn(
      async (ctx: { params: { botHandle: string; isOfficial: boolean } }) => ctx.params
    );

    const view = defineCommand({
      name: "view",
      params: S.Object({
        botHandle: S.String(),
        isOfficial: S.Boolean()
      }),
      handler
    });

    const root = defineGroup({
      name: "poe-agent-tools",
      children: [view]
    });

    promptState.text.mockResolvedValueOnce("sage-bot");
    promptState.confirm.mockResolvedValueOnce(true);

    process.argv = ["node", "poe-agent-tools", "view"];

    await runCLI(root);

    expect(promptState.text).toHaveBeenCalledWith({
      message: "--bot-handle",
      initialValue: undefined
    });
    expect(promptState.confirm).toHaveBeenCalledWith({
      message: "--is-official",
      initialValue: undefined
    });
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      botHandle: "sage-bot",
      isOfficial: true
    });
  });

  it("wraps positional prompt labels in angle brackets to mirror usage syntax", async () => {
    const handler = vi.fn(async (ctx: { params: { botHandle: string } }) => ctx.params);

    const view = defineCommand({
      name: "view",
      positional: ["botHandle"],
      params: S.Object({
        botHandle: S.String({ default: "default-bot" })
      }),
      handler
    });

    const root = defineGroup({
      name: "poe-agent-tools",
      children: [view]
    });

    promptState.text.mockResolvedValueOnce("sage-bot");

    process.argv = ["node", "poe-agent-tools", "view"];

    await runCLI(root);

    expect(promptState.text).toHaveBeenCalledWith({
      message: "<botHandle>",
      initialValue: "default-bot"
    });
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      botHandle: "sage-bot"
    });
  });

  it("calls loadOptions to populate the select when provided (supports async and sync)", async () => {
    const handler = vi.fn(async (ctx: { params: { mode: "safe" | "fast" } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        mode: S.Enum(["safe", "fast"] as const, {
          loadOptions: async () => [
            { label: "Safe (slow)", value: "safe" },
            { label: "Fast (risky)", value: "fast" }
          ]
        })
      }),
      handler
    });

    const root = defineGroup({ name: "toolcraft", children: [deploy] });

    promptState.select.mockResolvedValueOnce("safe");

    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(promptState.select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: "Safe (slow)", value: "safe" },
          { label: "Fast (risky)", value: "fast" }
        ]
      })
    );
    expect(handler.mock.calls[0]?.[0].params).toEqual({ mode: "safe" });
  });

  it("uses enum labels and schema description for the select prompt when provided", async () => {
    const handler = vi.fn(async (ctx: { params: { mode: "safe" | "fast" } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        mode: S.Enum(["safe", "fast"] as const, {
          description: "Pick a deployment mode",
          labels: { safe: "Safe (slow)", fast: "Fast (risky)" }
        })
      }),
      handler
    });

    const root = defineGroup({ name: "toolcraft", children: [deploy] });

    promptState.select.mockResolvedValueOnce("fast");

    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(promptState.select).toHaveBeenCalledWith({
      message: "Pick a deployment mode",
      options: [
        { label: "Safe (slow)", value: "safe" },
        { label: "Fast (risky)", value: "fast" }
      ],
      initialValue: undefined
    });
  });

  it("does not inherit enum option labels for prototype-named values", async () => {
    const handler = vi.fn(async (ctx: { params: { mode: "constructor" | "safe" } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        mode: S.Enum(["constructor", "safe"] as const, {
          labels: { safe: "Safe" }
        })
      }),
      handler
    });

    const root = defineGroup({ name: "toolcraft", children: [deploy] });

    promptState.select.mockResolvedValueOnce("constructor");

    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(promptState.select).toHaveBeenCalledWith({
      message: "--mode",
      options: [
        { label: "constructor", value: "constructor" },
        { label: "Safe", value: "safe" }
      ],
      initialValue: undefined
    });
    expect(handler.mock.calls[0]?.[0].params).toEqual({ mode: "constructor" });
  });

  it("merges preset values before CLI flags and only prompts for still-missing required params", async () => {
    const handler = vi.fn(
      async (ctx: {
        params: {
          service: string;
          region: string;
          replicas: number;
          mode: "safe" | "fast";
        };
      }) => ctx.params
    );

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String(),
        region: S.String(),
        replicas: S.Number(),
        mode: S.Enum(["safe", "fast"] as const)
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    vol.fromJSON({
      "/presets/staging.json": JSON.stringify({
        service: "api",
        region: "us-east-1",
        replicas: 1
      })
    });

    promptState.select.mockResolvedValueOnce("fast");
    process.argv = [
      "node",
      "toolcraft",
      "deploy",
      "--preset",
      "/presets/staging.json",
      "--replicas",
      "5"
    ];

    await runCLI(root, { presets: true });

    expect(promptState.text).not.toHaveBeenCalled();
    expect(promptState.select).toHaveBeenCalledWith({
      message: "--mode",
      options: [
        { label: "safe", value: "safe" },
        { label: "fast", value: "fast" }
      ],
      initialValue: undefined
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      service: "api",
      region: "us-east-1",
      replicas: 5,
      mode: "fast"
    });
  });

  it("renders only always-on global options when presets and version are disabled", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler: vi.fn()
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toMatchInlineSnapshot(`
      "toolcraft

      Usage: toolcraft [command] [OPTIONS]

      Commands
        deploy --service <value>
        approvals  Inspect and execute queued approvals.

      Options: --yes  --output <format>
      "
    `);
    expect(output).toContain("Options");
    expect(output).not.toContain("Global options");
    expect(output).not.toContain("--preset");
    expect(output).toContain("--yes");
    expect(output).toContain("--output <format>");
    expect(output).not.toContain("--version");
    expect(output).not.toContain("-h, --help");
  });

  it("keeps approvals and built-in CLI controls disabled by default", async () => {
    const handler = vi.fn(async (ctx: { params: { yes: boolean; output: string } }) => ctx.params);
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        yes: S.Boolean(),
        output: S.String()
      }),
      handler
    });
    const root = defineGroup({ name: "toolcraft", children: [deploy] });

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--output", "custom"];

    await runCLIWithoutControls(root);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({ yes: true, output: "custom" });

    process.argv = ["node", "toolcraft", "--help"];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLIWithoutControls(root);

    const output = readStdout(stdoutWrite);
    expect(output).not.toContain("Options:");
    expect(output).not.toContain("approvals");
  });

  it("renders preset and version global options when presets and version are enabled", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler: vi.fn()
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, { presets: true, version: "1.2.3" });

    const output = readStdout(stdoutWrite);
    expect(output).toMatchInlineSnapshot(`
      "toolcraft

      Usage: toolcraft [command] [OPTIONS]

      Commands
        deploy --service <value>
        approvals  Inspect and execute queued approvals.

      Options: --preset <path>  --yes  --output <format>  --version
      "
    `);
    expect(output).toContain("Options");
    expect(output).not.toContain("Global options");
    expect(output).toContain("--preset <path>");
    expect(output).toContain("--version");
    expect(output).not.toContain("-h, --help");
  });

  it("rejects a version parameter when program version output reserves --version", async () => {
    const submit = defineCommand({
      name: "submit",
      params: S.Object({
        version: S.String()
      }),
      handler: vi.fn()
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [submit]
    });

    process.argv = ["node", "toolcraft", "submit", "--version", "release", "--yes"];

    await expect(runCLI(root, { version: "1.2.3" })).rejects.toThrow(
      'Parameter "version" uses reserved CLI flag "--version". Add a short flag or rename the parameter.'
    );
  });

  it("never renders commander help in generated global option tables", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler: vi.fn()
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);
    const withoutPresetOrVersion = readStdout(stdoutWrite);

    stdoutWrite.mockClear();
    await runCLI(root, { presets: true, version: "1.2.3" });
    const withPresetAndVersion = readStdout(stdoutWrite);

    expect({
      withPresetAndVersion: withPresetAndVersion.includes("-h, --help"),
      withoutPresetOrVersion: withoutPresetOrVersion.includes("-h, --help")
    }).toMatchInlineSnapshot(`
      {
        "withPresetAndVersion": false,
        "withoutPresetOrVersion": false,
      }
    `);
  });

  it("allows a command parameter named preset when presets are not enabled", async () => {
    const handler = vi.fn(async (ctx: { params: { preset: string } }) => ctx.params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        preset: S.String()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--preset", "custom", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      preset: "custom"
    });
  });

  it("rejects preset files with unknown param keys", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    vol.fromJSON({
      "/presets/invalid.json": JSON.stringify({
        service: "api",
        unknown: "value"
      })
    });

    process.argv = ["node", "toolcraft", "deploy", "--preset", "/presets/invalid.json", "--yes"];

    await runCLI(root, { presets: true });

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Preset file "/presets/invalid.json" contains unknown parameter "unknown".',
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("rejects preset values that violate string patterns", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        slug: S.String({
          pattern: "^[a-z]+$"
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    vol.fromJSON({
      "/presets/invalid-pattern.json": JSON.stringify({
        slug: "bad-value"
      })
    });

    process.argv = [
      "node",
      "toolcraft",
      "deploy",
      "--preset",
      "/presets/invalid-pattern.json",
      "--yes"
    ];

    await runCLI(root, { presets: true });

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Preset file "/presets/invalid-pattern.json" has an invalid value for "slug": "bad-value" does not match pattern "^[a-z]+$".',
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("rejects preset values that violate numeric and array bounds", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        count: S.Number({ minimum: 1, maximum: 3 }),
        tags: S.Array(S.String(), { minItems: 2, maxItems: 2 })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    vol.fromJSON({
      "/presets/invalid-bounds.json": JSON.stringify({
        count: 99,
        tags: ["only-one"]
      })
    });

    process.argv = [
      "node",
      "toolcraft",
      "deploy",
      "--preset",
      "/presets/invalid-bounds.json",
      "--yes"
    ];

    await runCLI(root, { presets: true });

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Preset file "/presets/invalid-bounds.json" has an invalid value for "count". Expected a number greater than or equal to 1 and less than or equal to 3, got 99.',
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports a clear error when the preset file does not exist", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--preset", "/presets/missing.json", "--yes"];

    await runCLI(root, { presets: true });

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer('Preset file "/presets/missing.json" was not found.', "deploy")
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports a clear error when the preset file is not valid JSON", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    vol.fromJSON({
      "/presets/invalid-json.json": "{\n,"
    });

    process.argv = [
      "node",
      "toolcraft",
      "deploy",
      "--preset",
      "/presets/invalid-json.json",
      "--yes"
    ];

    await runCLI(root, { presets: true });

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toHaveLength(1);
    expect(loggerState.error[0]).toContain('Preset file "/presets/invalid-json.json"');
    expect(loggerState.error[0]).toContain("is not valid JSON");
    expect(loggerState.error[0]).toContain("line 2 column 1");
    expect(loggerState.error[0]).toContain("--> /presets/invalid-json.json:2:1");
    expect(loggerState.error[0]).toContain("2 | ,");
    expect(loggerState.error[0]).toContain("| ^");
    expect(process.exitCode).toBe(1);
  });

  it("ignores inherited JSON parse location fields for preset errors", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    vol.fromJSON({
      "/presets/invalid-json.json": "{\n,"
    });

    await withObjectPrototypeProperties(
      {
        cause: { line: 99, column: 88 },
        position: 123
      },
      async () => {
        process.argv = [
          "node",
          "toolcraft",
          "deploy",
          "--preset",
          "/presets/invalid-json.json",
          "--yes"
        ];

        await runCLI(root, { presets: true });
      }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error[0]).toContain("line 2 column 1");
    expect(loggerState.error[0]).not.toContain("line 99 column 88");
    expect(process.exitCode).toBe(1);
  });

  it("reports read errors other than file-not-found without masking them", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        service: S.String()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    vol.mkdirSync("/presets/directory", {
      recursive: true
    });

    process.argv = ["node", "toolcraft", "deploy", "--preset", "/presets/directory", "--yes"];

    await runCLI(root, { presets: true });

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
          default: "demo-service"
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    promptState.text.mockResolvedValueOnce("");
    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-service"
    });
  });

  it("skips prompts when stdin is not a TTY and uses defaults", async () => {
    const handler = vi.fn(
      async (ctx: { params: { name: string; optional?: string } }) => ctx.params
    );

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String({
          default: "demo-service"
        }),
        optional: S.Optional(S.String())
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    setTTY(process.stdin, false);
    process.argv = ["node", "toolcraft", "deploy", "--yes"];

    await runCLI(root);

    expect(promptState.text).not.toHaveBeenCalled();
    expect(promptState.select).not.toHaveBeenCalled();
    expect(handler.mock.calls[0]?.[0].params).toEqual({
      name: "demo-service"
    });
  });

  it("accepts --output markdown as an alias for md", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => ({
        ok: true
      }),
      render: {
        markdown: () => "rendered markdown"
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--output", "markdown", "--yes"];

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toBe("rendered markdown\n");
  });

  it("suggests rich for close --output rtf mistakes without replacing expected values", async () => {
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => "ok"
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--output", "rtf", "--yes"];

    await runCLI(root);

    const stderr = readStderr(stderrWrite);
    expect(stderr).toContain("Did you mean: rich?\nExpected one of: rich, md, markdown, json");
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode when rendering an MCP error result", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => ({
        content: [{ type: "text", text: "tool failed" }],
        isError: true
      })
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--yes"];

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toBe("");
    expect(readStderr(stderrWrite)).toBe("tool failed\n");
    expect(process.exitCode).toBe(1);
  });

  it.each([
    {
      argv: ["node", "toolcraft", "deploy", "--yes"],
      expected: "terminal",
      label: "rich"
    },
    {
      argv: ["node", "toolcraft", "deploy", "--output", "md", "--yes"],
      expected: "markdown",
      label: "md"
    },
    {
      argv: ["node", "toolcraft", "deploy", "--output", "json", "--yes"],
      expected: "json",
      label: "json"
    }
  ])("sets OUTPUT_FORMAT to $expected while running $label output", async ({ argv, expected }) => {
    const seenOutputFormats: Array<string | undefined> = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        seenOutputFormats.push(process.env.OUTPUT_FORMAT);
        return null;
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = argv;

    await runCLI(root);

    expect(seenOutputFormats).toEqual([expected]);
    expect(process.env.OUTPUT_FORMAT).toBe(originalOutputFormat);
    expect(promptState.resetOutputFormatCache).toHaveBeenCalledTimes(2);
    expect(stdoutWrite).toHaveBeenCalled();
  });

  it("keeps rich output as the default when stdout is not a TTY", async () => {
    const renderRich = vi.fn();
    const renderJson = vi.fn((result: unknown) => result);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => ({
        ok: true
      }),
      render: {
        rich: renderRich,
        json: renderJson
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    setTTY(process.stdout, false);
    process.argv = ["node", "toolcraft", "deploy", "--yes"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(renderRich).toHaveBeenCalledWith(
      {
        ok: true
      },
      expect.objectContaining({
        logger: expect.any(Object),
        renderTable: expect.any(Function),
        getTheme: expect.any(Function)
      })
    );
    expect(renderJson).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("forces JSON output when a command-scoped --json flag is passed", async () => {
    const renderRich = vi.fn();
    const renderJson = vi.fn((result: unknown) => result);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        json: S.Optional(S.Boolean())
      }),
      handler: async () => ({
        ok: true
      }),
      render: {
        rich: renderRich,
        json: renderJson
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--output", "md", "--json", "--yes"];

    await runCLI(root);

    expect([
      renderRich.mock.calls.length,
      renderJson.mock.calls.length,
      readStdout(stdoutWrite)
    ]).toEqual([0, 1, '{\n  "ok": true\n}\n']);
  });

  it("reports validation errors when prompts are skipped and required params are missing", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String()
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    setTTY(process.stdin, false);
    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(promptState.text).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      ['Missing required parameter "name".', "Run toolcraft deploy --help for usage."].join("\n")
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports a single validation error without wrapping it in the multi-error format", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String()
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    setTTY(process.stdin, false);
    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(loggerState.error).toEqual([
      ['Missing required parameter "name".', "Run toolcraft deploy --help for usage."].join("\n")
    ]);
    expect(loggerState.error[0]).not.toContain("parameter errors");
    expect(process.exitCode).toBe(1);
  });

  it("does not add a usage pointer when command help is displayed", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String()
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--help"];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toContain("Usage: toolcraft deploy");
    expect(loggerState.error.join("\n")).not.toContain("Run toolcraft deploy --help for usage.");
    expect(process.exitCode).toBeUndefined();
  });

  it("renders command examples in leaf help", async () => {
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineCommand({
          name: "send",
          description: "Send a message.",
          params: S.Object({
            body: S.String()
          }),
          examples: [
            {
              title: "Send a greeting",
              params: { body: "hello" }
            }
          ],
          handler: async () => ({ ok: true })
        })
      ]
    });

    process.argv = ["node", "toolcraft", "send", "--help"];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("Examples");
    expect(output).toContain("Send a greeting");
    expect(output).toContain("toolcraft send --body hello");
  });

  it("does not add a usage pointer when approval is declined", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw new ApprovalDeclinedError({ commandPath: "deploy" });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(loggerState.error).toEqual(["Declined."]);
    expect(loggerState.error.join("\n")).not.toContain("--help");
    expect(process.exitCode).toBe(1);
  });

  it("collects multiple CLI validation errors into one message", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String({ pattern: "^[a-z]+$" }),
        retries: S.Number(),
        dryRun: S.Boolean()
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    setTTY(process.stdin, false);
    process.argv = [
      "node",
      "toolcraft",
      "deploy",
      "--name",
      "42",
      "--retries",
      "many",
      "--dry-run",
      "yes"
    ];

    await runCLI(root);

    expect(loggerState.error).toEqual([
      withUsagePointer(
        [
          "3 parameter errors:",
          '  - name: Invalid value for "name": "42" does not match pattern "^[a-z]+$".',
          '  - retries: Invalid value for "retries". Expected a number, got "many".',
          '  - dryRun: Invalid value for "dryRun". Expected true or false, got "yes".'
        ].join("\n"),
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("caps collected CLI validation errors at ten entries", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        field01: S.String(),
        field02: S.String(),
        field03: S.String(),
        field04: S.String(),
        field05: S.String(),
        field06: S.String(),
        field07: S.String(),
        field08: S.String(),
        field09: S.String(),
        field10: S.String(),
        field11: S.String(),
        field12: S.String()
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    setTTY(process.stdin, false);
    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(loggerState.error).toEqual([
      withUsagePointer(
        [
          "12 parameter errors:",
          '  - field01: Missing required parameter "field01".',
          '  - field02: Missing required parameter "field02".',
          '  - field03: Missing required parameter "field03".',
          '  - field04: Missing required parameter "field04".',
          '  - field05: Missing required parameter "field05".',
          '  - field06: Missing required parameter "field06".',
          '  - field07: Missing required parameter "field07".',
          '  - field08: Missing required parameter "field08".',
          '  - field09: Missing required parameter "field09".',
          '  - field10: Missing required parameter "field10".',
          "  … and 2 more"
        ].join("\n"),
        "deploy"
      )
    ]);
    expect(loggerState.error[0]).not.toContain("field11");
    expect(loggerState.error[0]).not.toContain("field12");
    expect(process.exitCode).toBe(1);
  });

  it("prints UserError messages without the verbose hint", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw new UserError("Invalid input.");
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--yes"];

    await runCLI(root);

    expect(loggerState.error).toEqual([withUsagePointer("Invalid input.", "deploy")]);
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
          description: "Set it in the environment before running this command."
        }
      },
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    delete process.env.API_KEY;
    process.argv = ["node", "toolcraft", "deploy", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(promptState.text).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        "Missing required secret API_KEY\n  Set it in the environment before running this command.",
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("checks requirements before prompting for params", async () => {
    const handler = vi.fn(async () => null);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String()
      }),
      requires: {
        auth: true
      },
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    delete process.env.POE_API_KEY;
    process.argv = ["node", "toolcraft", "deploy"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(promptState.text).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        `Command "deploy" requires authentication.\n  Run 'poe-code login' first.`,
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("prints unexpected errors with a debug hint and stack trace in debug mode", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw new Error("Boom.");
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes"];
    await runCLI(root);

    expect(loggerState.error).toEqual(["Boom. Use --debug for a stack trace."]);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    resetLoggerState();
    stderrWrite.mockClear();
    process.exitCode = undefined;
    process.argv = ["node", "toolcraft", "deploy", "--yes", "--debug"];

    await runCLI(root);

    expect(loggerState.error).toEqual(["Boom."]);
    expect(stderrWrite).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("prints ToolcraftBugError messages as internal invariants and only shows stacks in debug mode", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        const error = new ToolcraftBugError("command must define an object params schema.");
        error.stack =
          "ToolcraftBugError: command must define an object params schema.\n    at fake-handler";
        throw error;
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes"];
    await runCLI(root);

    expect(loggerState.error).toHaveLength(1);
    expect(loggerState.error[0]).toMatch(/^toolcraft hit an internal invariant:/);
    expect(loggerState.error[0]).toContain("command must define an object params schema.");
    expect(readStderr(stderrWrite)).toBe("");
    expect(process.exitCode).toBe(1);

    resetLoggerState();
    stderrWrite.mockClear();
    process.exitCode = undefined;
    process.argv = ["node", "toolcraft", "deploy", "--yes", "--debug"];

    await runCLI(root);

    expect(loggerState.error).toHaveLength(1);
    expect(loggerState.error[0]).toMatch(/^toolcraft hit an internal invariant:/);
    expect(readStderr(stderrWrite)).toBe(
      "ToolcraftBugError: command must define an object params schema.\n    at fake-handler\n"
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints truncated HttpError-like details by default without a stack trace", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              error: "internal_panic",
              trace_id: "8f3c-123",
              details:
                "The upstream service returned a very long diagnostic payload with whitespace\nthat should collapse into a one-line snippet for normal users."
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes"];
    await runCLI(root);

    expect(readStderr(stderrWrite)).toMatchInlineSnapshot(`
      "Request:  GET https://api.example.com/v1/widgets/42
      Status:   500 Internal Server Error

      Response body: { "error": "internal_panic", "trace_id": "8f3c-123", "details": "The upstream service returned a very long diagnostic payload with whitespace\\nthat should collapse into a one-line snippet for normal u
      Re-run with --verbose to see headers and full body.
      "
    `);
    expect(readStderr(stderrWrite)).not.toContain("at fake-handler");
    expect(process.exitCode).toBe(1);
  });

  it("redacts secret-like response body fields in default HttpError snippets", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: JSON.stringify({
              access_token: "response-access-token",
              refreshToken: "response-refresh-token",
              nested: {
                client_secret: "response-client-secret",
                trace_id: "8f3c-123"
              }
            })
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes"];
    await runCLI(root);

    const output = readStderr(stderrWrite);
    expect(output).toContain('"access_token": "<redacted>"');
    expect(output).toContain('"refreshToken": "<redacted>"');
    expect(output).toContain('"client_secret": "<redacted>"');
    expect(output).toContain('"trace_id": "8f3c-123"');
    expect(output).not.toContain("response-access-token");
    expect(output).not.toContain("response-refresh-token");
    expect(output).not.toContain("response-client-secret");
    expect(process.exitCode).toBe(1);
  });

  it("prints full HttpError-like details with --verbose without a stack trace", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          request: {
            body: {
              name: "demo"
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    expect(readStderr(stderrWrite)).toMatchInlineSnapshot(`
      "Request:  GET https://api.example.com/v1/widgets/42

      Request headers:
        authorization: Bearer ****

      Request body:
        {
          "name": "demo"
        }

      Status:   500 Internal Server Error

      Response headers:
        content-type: application/json
        x-request-id: 8f3c

      Response body:
        {
          "error": "internal_panic",
          "trace_id": "8f3c-123"
        }
      "
    `);
    expect(readStderr(stderrWrite)).not.toContain("at fake-handler");
    expect(process.exitCode).toBe(1);
  });

  it("redacts secret-like request and response body fields in verbose HttpError details", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          request: {
            body: {
              name: "demo",
              client_secret: "request-client-secret",
              nested: {
                apiKey: "request-api-key"
              }
            }
          },
          response: {
            body: {
              error: "unauthorized",
              tokens: [
                {
                  refresh_token: "response-refresh-token"
                }
              ]
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    const output = readStderr(stderrWrite);
    expect(output).toContain('"name": "demo"');
    expect(output).toContain('"client_secret": "<redacted>"');
    expect(output).toContain('"apiKey": "<redacted>"');
    expect(output).toContain('"tokens": "<redacted>"');
    expect(output).not.toContain("request-client-secret");
    expect(output).not.toContain("request-api-key");
    expect(output).not.toContain("response-refresh-token");
    expect(process.exitCode).toBe(1);
  });

  it("renders RFC 7807 problem detail response bodies", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              title: "Bad Request",
              detail: "name too short"
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    expect(readStderr(stderrWrite)).toContain(
      "Response body:\n  Problem: Bad Request\n  Detail:  name too short"
    );
    expect(process.exitCode).toBe(1);
  });

  it("ignores inherited RFC 7807 problem detail response fields", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {}
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await withObjectPrototypeProperties(
      {
        detail: "polluted detail",
        status: 400,
        title: "Polluted Problem",
        type: "https://example.com/polluted"
      },
      async () => {
        process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
        await runCLI(root);
      }
    );

    const output = readStderr(stderrWrite);
    expect(output).toContain("Response body:\n  {}");
    expect(output).not.toContain("Polluted Problem");
    expect(output).not.toContain("polluted detail");
    expect(output).not.toContain("https://example.com/polluted");
    expect(process.exitCode).toBe(1);
  });

  it("falls back to JSON when problem detail text is blank", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              title: " ",
              detail: ""
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    expect(readStderr(stderrWrite)).toContain(
      'Response body:\n  {\n    "title": " ",\n    "detail": ""\n  }'
    );
    expect(process.exitCode).toBe(1);
  });

  it("renders GraphQL error envelope response bodies", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              errors: [
                {
                  message: "Unauthorized",
                  path: ["viewer"]
                }
              ]
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    expect(readStderr(stderrWrite)).toContain(
      "Response body:\n  GraphQL error: Unauthorized\n    at path: viewer"
    );
    expect(process.exitCode).toBe(1);
  });

  it("ignores inherited GraphQL error metadata fields", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              errors: [
                {
                  message: "Unauthorized"
                }
              ]
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await withObjectPrototypeProperties(
      {
        extensions: { code: "POLLUTED" },
        path: ["polluted"]
      },
      async () => {
        process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
        await runCLI(root);
      }
    );

    const output = readStderr(stderrWrite);
    expect(output).toContain("Response body:\n  GraphQL error: Unauthorized");
    expect(output).not.toContain("at path: polluted");
    expect(output).not.toContain("POLLUTED");
    expect(process.exitCode).toBe(1);
  });

  it("renders multiple GraphQL errors with path and extension code", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              errors: [
                {
                  message: "Unauthorized",
                  path: ["viewer"],
                  extensions: {
                    code: "UNAUTHENTICATED"
                  }
                },
                {
                  message: "Post missing",
                  path: ["viewer", "posts", 0]
                }
              ]
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    expect(readStderr(stderrWrite)).toContain(
      [
        "Response body:",
        "  GraphQL error: Unauthorized",
        "    at path: viewer",
        "    code:    UNAUTHENTICATED",
        "  ",
        "  GraphQL error: Post missing",
        "    at path: viewer.posts.0"
      ].join("\n")
    );
    expect(process.exitCode).toBe(1);
  });

  it("falls back to JSON for GraphQL envelopes with invalid error paths", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              errors: [
                {
                  message: "Unauthorized",
                  path: ["viewer", null]
                }
              ]
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    const output = readStderr(stderrWrite);
    expect(output).toContain("Response body:\n  {");
    expect(output).toContain('"path": [');
    expect(output).not.toContain("GraphQL error: Unauthorized");
    expect(process.exitCode).toBe(1);
  });

  it("falls back to JSON response body rendering for unrecognised object bodies", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              foo: 1
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    expect(readStderr(stderrWrite)).toContain('Response body:\n  {\n    "foo": 1\n  }');
    expect(process.exitCode).toBe(1);
  });

  it("does not treat inherited response bodies as HttpError details", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        const error = createHttpErrorLike();
        error.response = {
          headers: {
            "content-type": "application/json"
          },
          status: 500,
          statusText: "Internal Server Error"
        } as typeof error.response;
        throw error;
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await withObjectPrototypeProperties({ body: { title: "Polluted Problem" } }, async () => {
      process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
      await runCLI(root);
    });

    const output = readStderr(stderrWrite);
    expect(output).not.toContain("Response body:");
    expect(output).not.toContain("Polluted Problem");
    expect(process.exitCode).toBe(1);
  });

  it("prefers problem detail rendering for ambiguous response bodies", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          response: {
            body: {
              title: "X",
              errors: [
                {
                  message: "Unauthorized"
                }
              ]
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    const output = readStderr(stderrWrite);
    expect(output).toContain("Response body:\n  Problem: X");
    expect(output).not.toContain("GraphQL error: Unauthorized");
    expect(process.exitCode).toBe(1);
  });

  it("prints full HttpError-like details and the stack trace with --debug", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike();
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--debug"];
    await runCLI(root);

    const output = readStderr(stderrWrite);
    expect(output).toContain("Response headers:");
    expect(output).toContain("Response body:");
    expect(output).toContain("HttpError: request failed\n    at fake-handler");
    expect(process.exitCode).toBe(1);
  });

  it("does not render an HttpError transcript for UserError", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        const error = new UserError("Invalid input.") as UserError & { name: "HttpError" };
        error.name = "HttpError";
        throw error;
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes"];
    await runCLI(root);

    expect(loggerState.error).toEqual([withUsagePointer("Invalid input.", "deploy")]);
    expect(readStderr(stderrWrite)).toBe("");
    expect(process.exitCode).toBe(1);
  });

  it("keeps generic Error output unchanged", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw new Error("Boom.");
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes"];
    await runCLI(root);

    expect(loggerState.error).toEqual(["Boom. Use --debug for a stack trace."]);
    expect(readStderr(stderrWrite)).toBe("");
    expect(process.exitCode).toBe(1);
  });

  it("prints redacted Authorization request headers in verbose HttpError-like details", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => {
        throw createHttpErrorLike({
          request: {
            headers: {
              authorization: "Bearer raw-token",
              accept: "application/json"
            }
          }
        });
      }
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    const output = readStderr(stderrWrite);
    expect(output).toContain("  authorization: Bearer ****");
    expect(output).not.toContain("raw-token");
    expect(process.exitCode).toBe(1);
  });

  it("does not suppress stack traces when --verbose is a schema-tagged global owned by the user", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Boom.");
    });

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        verbose: S.Optional(
          S.Boolean({
            description: "Log the request line to stderr.",
            short: "v",
            global: true
          })
        )
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]?.params).toMatchObject({ verbose: true });
    expect(loggerState.error).toEqual(["Boom. Use --debug for a stack trace."]);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("routes --verbose to the schema-tagged global field and --debug to the stack-trace toggle", async () => {
    const handler = vi.fn(async ({ params }: { params: { verbose?: boolean } }) => params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        verbose: S.Optional(
          S.Boolean({
            description: "Log the request line to stderr.",
            short: "v",
            global: true
          })
        )
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--yes", "--verbose"];
    await runCLI(root);
    expect(handler.mock.calls.at(-1)?.[0]?.params).toMatchObject({ verbose: true });

    handler.mockClear();
    process.exitCode = undefined;
    process.argv = ["node", "toolcraft", "deploy", "--yes", "-v"];
    await runCLI(root);
    expect(handler.mock.calls.at(-1)?.[0]?.params).toMatchObject({ verbose: true });

    handler.mockClear();
    process.exitCode = undefined;
    process.argv = ["node", "toolcraft", "deploy", "--yes", "--debug"];
    await runCLI(root);
    expect(handler.mock.calls.at(-1)?.[0]?.params?.verbose).toBeUndefined();
  });

  it("throws on reserved service name collisions", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    await expect(
      runCLI(root, {
        services: {
          params: "bad"
        }
      })
    ).rejects.toThrow(
      'Service name "params" is reserved. Choose a different name. Available reserved names: params, secrets, fetch, fs, env, progress, runtimeOptions, root.'
    );
  });

  it("passes options.fetch to command contexts", async () => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
        })
    );
    const load = defineCommand({
      name: "load",
      params: S.Object({}),
      handler: async ({ fetch }) => {
        expect(fetch).toBe(injectedFetch);
        const response = await fetch("https://api.example.com/items");
        return response.json();
      }
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [load]
    });

    process.argv = ["node", "toolcraft", "load", "--output", "json", "--yes"];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, {
      fetch: injectedFetch
    });

    expect(JSON.parse(readStdout(stdoutWrite))).toEqual({ ok: true });
    expect(injectedFetch).toHaveBeenCalledWith("https://api.example.com/items");
  });

  it("selects fixture scenarios by 1-based index", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const realStore = {
      readValue: vi.fn(async () => {
        throw new Error("real store read should not be used in fixture mode");
      }),
      writeValue: vi.fn(async () => {
        throw new Error("real store write should not be used in fixture mode");
      })
    };

    process.env.TOOLCRAFT_FIXTURE = "2";
    process.argv = ["node", "toolcraft", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: realStore
      }
    });

    const payload = JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(""));
    expect(payload).toEqual({
      exists: true,
      file: "named file",
      matched: {
        scenario: "named"
      },
      missingFile: null,
      secret: "fixture-secret",
      storeValue: null,
      unmatchedReadStatus: null,
      unmatchedWriteStatus: 204
    });
    expect(realStore.readValue).not.toHaveBeenCalled();
    expect(realStore.writeValue).not.toHaveBeenCalled();
  });

  it("selects fixture scenarios by name and matches fetch by method plus url", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.env.TOOLCRAFT_FIXTURE = "named scenario";
    process.argv = ["node", "toolcraft", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: {
          readValue: async () => "live value",
          writeValue: async () => undefined
        }
      }
    });

    const payload = JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(""));
    expect(payload.matched).toEqual({
      scenario: "named"
    });
    expect(payload.file).toBe("named file");
    expect(payload.unmatchedReadStatus).toBeNull();
    expect(payload.unmatchedWriteStatus).toBe(204);
  });

  it("falls back to safe no-ops for services omitted from the fixture scenario", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const realStore = {
      readValue: vi.fn(async () => "live value"),
      writeValue: vi.fn(async () => undefined)
    };

    process.env.TOOLCRAFT_FIXTURE = "no-op fallback";
    process.argv = ["node", "toolcraft", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: realStore
      }
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
      unmatchedWriteStatus: 204
    });
    expect(realStore.readValue).not.toHaveBeenCalled();
    expect(realStore.writeValue).not.toHaveBeenCalled();
  });

  it("lists fixture scenarios when a named fixture is missing", async () => {
    process.env.TOOLCRAFT_FIXTURE = "missing scenario";
    process.argv = ["node", "toolcraft", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: {
          readValue: async () => "live value",
          writeValue: async () => undefined
        }
      }
    });

    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Fixture scenario "missing scenario" was not found. Available: first scenario, named scenario, no-op fallback.',
        "fixture-demo"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("explains when a fixture file declares no scenarios", async () => {
    vol.fromJSON({
      [fixtureFilePath]: "[]"
    });
    process.env.TOOLCRAFT_FIXTURE = "missing scenario";
    process.argv = ["node", "toolcraft", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: {
          readValue: async () => "live value",
          writeValue: async () => undefined
        }
      }
    });

    expect(loggerState.error).toEqual([
      withUsagePointer(
        `Fixture scenario "missing scenario" was not found. No fixtures are declared in ${fixtureFilePath}.`,
        "fixture-demo"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports the JSON parser message when the fixture file is not valid JSON", async () => {
    vol.fromJSON({
      [fixtureFilePath]: "{\n,"
    });
    process.env.TOOLCRAFT_FIXTURE = "first scenario";
    process.argv = ["node", "toolcraft", "fixture-demo", "--output", "json", "--yes"];

    await runCLI(fixtureRoot, {
      services: {
        store: {
          readValue: async () => "live value",
          writeValue: async () => undefined
        }
      }
    });

    expect(loggerState.error).toHaveLength(1);
    expect(loggerState.error[0]).toContain(`Fixture file ${fixtureFilePath}`);
    expect(loggerState.error[0]).toContain("is not valid JSON");
    expect(loggerState.error[0]).toContain("line 2 column 1");
    expect(loggerState.error[0]).toContain(`--> ${fixtureFilePath}:2:1`);
    expect(loggerState.error[0]).toContain("2 | ,");
    expect(loggerState.error[0]).toContain("| ^");
    expect(process.exitCode).toBe(1);
  });

  it("parses oneOf params using the discriminator flag and selected branch fields", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const send = defineCommand({
      name: "send",
      params: S.Object({
        destination: S.OneOf({
          discriminator: "kind",
          branches: {
            email: S.Object({
              address: S.String()
            }),
            webhook: S.Object({
              url: S.String()
            })
          }
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [send]
    });

    process.argv = [
      "node",
      "toolcraft",
      "send",
      "--destination.kind",
      "email",
      "--destination.address",
      "alerts@example.com",
      "--yes"
    ];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          destination: {
            kind: "email",
            address: "alerts@example.com"
          }
        }
      })
    );
  });

  it("rejects oneOf flags from branches other than the selected discriminator", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const send = defineCommand({
      name: "send",
      params: S.Object({
        destination: S.OneOf({
          discriminator: "kind",
          branches: {
            email: S.Object({
              address: S.String()
            }),
            webhook: S.Object({
              url: S.String()
            })
          }
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [send]
    });

    process.argv = [
      "node",
      "toolcraft",
      "send",
      "--destination.kind",
      "email",
      "--destination.address",
      "alerts@example.com",
      "--destination.url",
      "https://example.com/hook",
      "--yes"
    ];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Unknown parameter "destination.url" for destination.kind="email". Available: destination.address.',
        "send"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("lists dynamic parameters when an unknown dynamic flag is passed", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const score = defineCommand({
      name: "score",
      params: S.Object({
        weights: S.Record(S.Number())
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [score]
    });

    process.argv = ["node", "toolcraft", "score", "--weight.bad", "1", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer('Unknown parameter "weight.bad". Available: weights.<key>.', "score")
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports unsupported dynamic parameter types without internal schema variable names", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const configure = defineCommand({
      name: "configure",
      params: S.Object({
        routes: S.Record(
          S.OneOf({
            discriminator: "kind",
            branches: {
              local: S.Object({
                path: S.String()
              })
            }
          })
        )
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [configure]
    });

    process.argv = ["node", "toolcraft", "configure", "--routes.primary", "local", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Unsupported parameter type "oneof" for "routes.primary". Supported types: string, number, integer, boolean, array, object, enum, oneof.',
        "configure"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("parses unions using the synthesized kind flag", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const notify = defineCommand({
      name: "notify",
      params: S.Object({
        contact: S.Union([
          S.Object({
            email: S.String()
          }),
          S.Object({
            phone: S.String()
          })
        ])
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [notify]
    });

    process.argv = [
      "node",
      "toolcraft",
      "notify",
      "--contact-kind",
      "email",
      "--contact.email",
      "alerts@example.com",
      "--yes"
    ];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          contact: {
            email: "alerts@example.com"
          }
        }
      })
    );
  });

  it("rejects union flags from branches other than the selected kind", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const notify = defineCommand({
      name: "notify",
      params: S.Object({
        contact: S.Union([
          S.Object({
            email: S.String()
          }),
          S.Object({
            phone: S.String()
          })
        ])
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [notify]
    });

    process.argv = [
      "node",
      "toolcraft",
      "notify",
      "--contact-kind",
      "phone",
      "--contact.email",
      "alerts@example.com",
      "--yes"
    ];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Unknown parameter "contact.email" for contact-kind="phone". Available: contact.phone.',
        "notify"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("parses record flags with dynamic keys", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const configure = defineCommand({
      name: "configure",
      params: S.Object({
        weights: S.Record(S.Number())
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [configure]
    });

    process.argv = [
      "node",
      "toolcraft",
      "configure",
      "--weights.primary",
      "3",
      "--weights.secondary",
      "7",
      "--yes"
    ];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          weights: {
            primary: 3,
            secondary: 7
          }
        }
      })
    );
  });

  it("parses negative values for dynamic array flags", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const configure = defineCommand({
      name: "configure",
      params: S.Object({
        weights: S.Record(S.Array(S.Number()))
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [configure]
    });

    process.argv = ["node", "toolcraft", "configure", "--weights.primary", "-1", "-2", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          weights: {
            primary: [-1, -2]
          }
        }
      })
    );
  });

  it("reports missing dynamic array values with a usage pointer", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const configure = defineCommand({
      name: "configure",
      params: S.Object({
        weights: S.Record(S.Array(S.Number()))
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [configure]
    });

    process.argv = ["node", "toolcraft", "configure", "--weights.primary", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer("error: option 'weights.primary' argument missing", "configure")
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("parses arrays of objects from indexed flags", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const invite = defineCommand({
      name: "invite",
      params: S.Object({
        recipients: S.Array(
          S.Object({
            name: S.String(),
            email: S.String()
          })
        )
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [invite]
    });

    process.argv = [
      "node",
      "toolcraft",
      "invite",
      "--recipients.0.name",
      "Ada",
      "--recipients.0.email",
      "ada@example.com",
      "--recipients.1.name",
      "Linus",
      "--recipients.1.email",
      "linus@example.com",
      "--yes"
    ];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          recipients: [
            {
              name: "Ada",
              email: "ada@example.com"
            },
            {
              name: "Linus",
              email: "linus@example.com"
            }
          ]
        }
      })
    );
  });

  it("rejects arrays of objects when indices are not contiguous", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const invite = defineCommand({
      name: "invite",
      params: S.Object({
        recipients: S.Array(
          S.Object({
            name: S.String()
          })
        )
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [invite]
    });

    process.argv = ["node", "toolcraft", "invite", "--recipients.1.name", "Linus", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Array parameter "recipients" must use contiguous indices starting at 0.',
        "invite"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("parses nullable values from the literal null", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const update = defineCommand({
      name: "update",
      params: S.Object({
        nickname: S.String({
          nullable: true
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [update]
    });

    process.argv = ["node", "toolcraft", "update", "--nickname=null", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          nickname: null
        }
      })
    );
  });

  it("validates string patterns before invoking the handler", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        slug: S.String({
          pattern: "^[a-z]+$"
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--slug", "bad-value", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Invalid value for "slug": "bad-value" does not match pattern "^[a-z]+$".',
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("validates numeric and array bounds before invoking the handler", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({
        count: S.Number({ minimum: 1, maximum: 3 }),
        tags: S.Array(S.String(), { minItems: 2, maxItems: 2 })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [deploy]
    });

    process.argv = ["node", "toolcraft", "deploy", "--count", "2", "--tags", "only-one", "--yes"];

    await runCLI(root);

    expect(handler).not.toHaveBeenCalled();
    expect(loggerState.error).toEqual([
      withUsagePointer(
        'Invalid value for "tags". Expected an array with at least 2 items, got array(1).',
        "deploy"
      )
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("supports dot-path flags nested deeper than two levels", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const connect = defineCommand({
      name: "connect",
      params: S.Object({
        network: S.Object({
          database: S.Object({
            primary: S.Object({
              host: S.String()
            })
          })
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [connect]
    });

    process.argv = [
      "node",
      "toolcraft",
      "connect",
      "--network.database.primary.host",
      "db.internal",
      "--yes"
    ];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          network: {
            database: {
              primary: {
                host: "db.internal"
              }
            }
          }
        }
      })
    );
  });

  it("parses json schema fields from a single json string flag", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const publish = defineCommand({
      name: "publish",
      params: S.Object({
        payload: S.Json()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [publish]
    });

    process.argv = [
      "node",
      "toolcraft",
      "publish",
      "--payload",
      '{"topic":"release","meta":{"count":2}}',
      "--yes"
    ];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          payload: {
            topic: "release",
            meta: {
              count: 2
            }
          }
        }
      })
    );
  });

  it("reports invalid json flag values with the received text and parser error", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);

    const publish = defineCommand({
      name: "publish",
      params: S.Object({
        payload: S.Json()
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [publish]
    });

    process.argv = ["node", "toolcraft", "publish", "--payload", "{foo:1}", "--yes"];

    await runCLI(root);

    const renderedError = loggerState.error.join("\n");
    expect(renderedError).toContain(
      'Invalid value for "payload". Expected valid JSON, got "{foo:1}"'
    );
    expect(renderedError).toContain("(parser: ");
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders root help with breadcrumb path", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => null
    });

    const generate = defineGroup({
      name: "generate",
      children: [deploy]
    });

    const root = defineGroup({
      name: "poe-code",
      children: [generate]
    });

    process.argv = ["node", "poe-code", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, {
      version: "1.2.3"
    });

    expect(readStdout(stdoutWrite)).toContain("poe-code\n");
    expect(process.exitCode).toBeUndefined();
  });

  it("renders command parameters in group help listings", async () => {
    const listTasks = defineCommand({
      name: "list-tasks",
      description: "List tasks",
      params: S.Object({
        section: S.Optional(S.String())
      }),
      handler: async () => null
    });
    const details = defineCommand({
      name: "details",
      description: "Get task details",
      params: S.Object({
        taskGid: S.String()
      }),
      handler: async () => null
    });
    const asana = defineGroup({
      name: "asana",
      children: [listTasks, details]
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [asana]
    });

    process.argv = ["node", "toolcraft", "asana", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("list-tasks [--section <value>]");
    expect(output).toContain("details --task-gid <value>");
  });

  it("renders nested command groups in root help", async () => {
    const listEvents = defineCommand({
      name: "list",
      description: "List calendar events",
      params: S.Object({}),
      handler: async () => null
    });
    const createMeeting = defineCommand({
      name: "create",
      description: "Create meeting",
      params: S.Object({}),
      handler: async () => null
    });
    const calendar = defineGroup({
      name: "calendar",
      description: "Google Calendar events.",
      children: [
        defineGroup({
          name: "events",
          children: [listEvents]
        }),
        defineGroup({
          name: "meeting",
          children: [createMeeting]
        })
      ]
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [calendar]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("Commands");
    expect(output).not.toContain("Commands:");
    expect(output).toContain("calendar");
    expect(output).not.toContain("\n  events");
    expect(output).not.toContain("\n    list");
    expect(output).not.toContain("List calendar events");
    expect(output).not.toContain("\n  meeting");
    expect(output).not.toContain("\n    create");
    expect(output).not.toContain("Create meeting");
  });

  it("resolves MCP proxy caches from the configured project root", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "cwd").mockReturnValue("/caller/project");
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "github",
          scope: ["cli", "sdk", "mcp"],
          mcp: {
            transport: "stdio",
            command: "mock-server"
          },
          children: []
        })
      ]
    });

    vol.fromJSON(
      {
        [fixtureFilePath]: fixtureFileContents,
        ["/cli-package/.toolcraft/mcp/github.json"]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          configFingerprint: createHash("sha256")
            .update(JSON.stringify({ transport: "stdio", command: "mock-server" }))
            .digest("hex"),
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [
            {
              name: "create_issue",
              description: "Create an issue",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false
              }
            }
          ]
        })
      },
      "/"
    );
    process.argv = ["node", "toolcraft", "github", "--help"];

    await runCLI(root, { projectRoot: "/cli-package" });

    expect(readStdout(stdoutWrite)).toContain("create_issue");
  });

  it("enables --version from the nearest package metadata for absolute entrypoints", async () => {
    const root = defineGroup({
      name: "mytool",
      children: [
        defineCommand({
          name: "noop",
          params: S.Object({}),
          handler: async () => null
        })
      ]
    });

    vol.fromJSON({
      [fixtureFilePath]: fixtureFileContents,
      "/repo/package.json": JSON.stringify({ name: "workspace", version: "0.0.1" }),
      "/repo/packages/mytool/package.json": JSON.stringify({
        name: "mytool",
        version: "2.3.4"
      }),
      "/repo/packages/mytool/dist/bin.js": ""
    });
    process.argv = ["node", "/repo/packages/mytool/dist/bin.js", "--version"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toContain("2.3.4");
  });

  it("accepts short option flags defined on params", async () => {
    const handler = vi.fn(
      async ({ params }: { params: { session?: string; literal?: boolean } }) => params
    );

    const waitFor = defineCommand({
      name: "wait-for",
      params: S.Object({
        session: S.Optional(
          S.String({
            short: "s"
          })
        ),
        literal: S.Optional(
          S.Boolean({
            short: "l"
          })
        )
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [waitFor]
    });

    process.argv = ["node", "toolcraft", "wait-for", "-s", "tests", "-l", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          session: "tests",
          literal: true
        }
      })
    );
  });

  it("accepts long option aliases defined on params", async () => {
    const handler = vi.fn(async ({ params }: { params: { rawResponse?: boolean } }) => params);

    const show = defineCommand({
      name: "show",
      params: S.Object({
        rawResponse: S.Optional(
          S.Boolean({
            cliAliases: ["raw"]
          })
        )
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [show]
    });

    process.argv = ["node", "toolcraft", "show", "--raw", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          rawResponse: true
        }
      })
    );
  });

  it("passes a declared __proto__ option to the command handler", async () => {
    const handler = vi.fn(async ({ params }: { params: Record<string, unknown> }) => params);

    const inspect = defineCommand({
      name: "inspect",
      params: S.Object({
        ["__proto__"]: S.Optional(S.String())
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [inspect]
    });

    process.argv = ["node", "toolcraft", "inspect", "--proto", "visible", "--yes"];

    await runCLI(root);

    const params = handler.mock.calls[0]?.[0].params as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(params, "__proto__")).toBe(true);
    expect(params["__proto__"]).toBe("visible");
  });

  it("rejects params that normalize to the same option flag", async () => {
    const submit = defineCommand({
      name: "submit",
      params: S.Object({
        fooBar: S.String(),
        foo_bar: S.String()
      }),
      handler: vi.fn()
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [submit]
    });

    process.argv = ["node", "toolcraft", "submit", "--foo-bar", "value", "--yes"];

    await expect(runCLI(root)).rejects.toThrow(
      'Parameters "fooBar" and "foo_bar" use conflicting CLI flag "--foo-bar".'
    );
  });

  it("rejects long option aliases that collide with global flags", async () => {
    const submit = defineCommand({
      name: "submit",
      params: S.Object({
        destination: S.Optional(S.String({ cliAliases: ["yes"] }))
      }),
      handler: vi.fn()
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [submit]
    });

    process.argv = ["node", "toolcraft", "submit", "--yes"];

    await expect(runCLI(root)).rejects.toThrow(
      'Parameter "destination" uses reserved CLI flag "--yes". Add a short flag or rename the parameter.'
    );
  });

  it("falls back to a short option when a command param collides with a global flag", async () => {
    const handler = vi.fn(async ({ params }: { params: { output: string } }) => params);

    const screenshot = defineCommand({
      name: "screenshot",
      params: S.Object({
        output: S.String({
          short: "o"
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [screenshot]
    });

    process.argv = ["node", "toolcraft", "screenshot", "-o", "screen.png", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          output: "screen.png"
        }
      })
    );
  });

  it("accepts a trailing positional array", async () => {
    const handler = vi.fn(
      async ({ params }: { params: { command: string; args?: string[] } }) => params
    );

    const createSession = defineCommand({
      name: "create-session",
      positional: ["command", "args"],
      params: S.Object({
        command: S.String(),
        args: S.Optional(S.Array(S.String()))
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [createSession]
    });

    process.argv = ["node", "toolcraft", "create-session", "npm", "test", "--", "--runInBand"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          command: "npm",
          args: ["test", "--runInBand"]
        }
      })
    );
  });

  it("treats a positional with a default as optional for parsing and uses the default with --yes", async () => {
    const handler = vi.fn(async ({ params }: { params: { agent: string } }) => params);

    const install = defineCommand({
      name: "install",
      positional: ["agent"],
      params: S.Object({
        agent: S.Enum(["claude-code", "codex"], {
          default: "claude-code"
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [install]
    });

    process.argv = ["node", "toolcraft", "install", "--yes"];

    await runCLI(root);

    expect(promptState.select).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          agent: "claude-code"
        }
      })
    );
  });

  it("prompts for a missing positional when the schema has a default and prompts are enabled", async () => {
    const handler = vi.fn(async ({ params }: { params: { agent: string } }) => params);

    const install = defineCommand({
      name: "install",
      positional: ["agent"],
      params: S.Object({
        agent: S.Enum(["claude-code", "codex"], {
          default: "claude-code",
          description: "Select agent"
        })
      }),
      handler
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [install]
    });

    promptState.select.mockResolvedValueOnce("codex");
    process.argv = ["node", "toolcraft", "install"];

    await runCLI(root);

    expect(promptState.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select agent",
        initialValue: "claude-code"
      })
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          agent: "codex"
        }
      })
    );
  });

  it("mounts multiple groups as top-level CLI commands", async () => {
    const deployHandler = vi.fn(async ({ params }: { params: { name: string } }) => params);

    const renderHandler = vi.fn(async ({ params }: { params: { target: string } }) => params);

    const terminalPilot = defineGroup({
      name: "terminal-pilot",
      children: [
        defineCommand({
          name: "deploy",
          positional: ["name"],
          params: S.Object({
            name: S.String()
          }),
          handler: deployHandler
        })
      ]
    });

    const terminalPng = defineGroup({
      name: "terminal-png",
      children: [
        defineCommand({
          name: "render",
          positional: ["target"],
          params: S.Object({
            target: S.String()
          }),
          handler: renderHandler
        })
      ]
    });

    process.argv = ["node", "poe-code", "terminal-png", "render", "screen.png", "--yes"];

    await runCLI([terminalPilot, terminalPng]);

    expect(renderHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          target: "screen.png"
        }
      })
    );
    expect(deployHandler).not.toHaveBeenCalled();
  });

  it("passes positional arguments to a nested group's default command", async () => {
    const handler = vi.fn(async ({ params }: { params: { name: string } }) => params);

    const run = defineCommand({
      name: "run",
      positional: ["name"],
      params: S.Object({
        name: S.String()
      }),
      handler
    });

    const githubWorkflows = defineGroup({
      name: "github-workflows",
      children: [run],
      default: run
    });

    const root = defineGroup({
      name: "poe-code",
      children: [githubWorkflows]
    });

    process.argv = ["node", "poe-code", "github-workflows", "demo", "--yes"];

    await runCLI(root);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          name: "demo"
        }
      })
    );
  });

  it("prefers an explicit nested subcommand over the group's default command", async () => {
    const runHandler = vi.fn(async ({ params }: { params: { name: string } }) => params);
    const installHandler = vi.fn(async ({ params }: { params: { name: string } }) => params);

    const run = defineCommand({
      name: "run",
      positional: ["name"],
      params: S.Object({
        name: S.String()
      }),
      handler: runHandler
    });

    const install = defineCommand({
      name: "install",
      positional: ["name"],
      params: S.Object({
        name: S.String()
      }),
      handler: installHandler
    });

    const githubWorkflows = defineGroup({
      name: "github-workflows",
      children: [run, install],
      default: run
    });

    const root = defineGroup({
      name: "poe-code",
      children: [githubWorkflows]
    });

    process.argv = ["node", "poe-code", "github-workflows", "install", "demo", "--yes"];

    await runCLI(root);

    expect(installHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          name: "demo"
        }
      })
    );
    expect(runHandler).not.toHaveBeenCalled();
  });

  it("supports an unnamed root default command alongside named sibling commands", async () => {
    const ingestHandler = vi.fn(async ({ params }: { params: { url: string } }) => params);
    const initHandler = vi.fn(async () => ({ initialized: true }));
    const ingest = defineCommand({
      name: "",
      positional: ["url"],
      params: S.Object({
        url: S.String()
      }),
      handler: ingestHandler
    });
    const init = defineCommand({
      name: "init",
      params: S.Object({}),
      handler: initHandler
    });
    const root = defineGroup({
      name: "",
      children: [ingest, init],
      default: ingest
    });

    process.argv = ["node", "wire", "https://example.com"];
    await runCLI(root);

    expect(ingestHandler).toHaveBeenCalledWith(
      expect.objectContaining({ params: { url: "https://example.com" } })
    );
    expect(initHandler).not.toHaveBeenCalled();

    ingestHandler.mockClear();
    process.argv = ["node", "wire", "init"];
    await runCLI(root);

    expect(initHandler).toHaveBeenCalledTimes(1);
    expect(ingestHandler).not.toHaveBeenCalled();

    process.argv = ["node", "wire", "--help"];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("<url>");
    expect(output).toContain("init");
    expect(output).not.toContain("__toolcraft_default");
  });

  it("renders leaf help with inherited secrets", async () => {
    const textCommand = defineCommand({
      name: "text",
      description: "Generate text.",
      params: S.Object({
        prompt: S.String({
          description: "Generation prompt"
        }),
        model: S.String({
          description: "Model identifier",
          default: "GPT-4.1"
        })
      }),
      handler: async () => null
    });

    const generate = defineGroup({
      name: "generate",
      description: "Generate content via Poe API.",
      secrets: {
        apiKey: {
          env: "POE_API_KEY",
          description: "Inherited from generate group"
        }
      },
      children: [textCommand]
    });

    const root = defineGroup({
      name: "poe-code",
      children: [generate]
    });

    process.argv = ["node", "poe-code", "generate", "text", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("poe-code generate text");
    expect(output).toContain("Options");
    expect(output).toContain("--prompt <value>");
    expect(output).toContain("Generation prompt (required)");
    expect(output).toContain("--model <value>");
    expect(output).toContain("Model identifier (default: GPT-4.1)");
    expect(output).not.toContain("Global options:");
    expect(output).not.toContain("--preset");
    expect(output).not.toContain("--yes");
    expect(output).toContain("Secrets (environment)");
    expect(output).toContain("POE_API_KEY");
    expect(output).toContain("Inherited from generate group");
  });

  it("renders help value tokens from boolean defaults, schema metadata, and field names", async () => {
    const inspect = defineCommand({
      name: "inspect",
      params: S.Object({
        impliedFlag: S.Boolean({
          description: "Implied false flag"
        }),
        flag: S.Boolean({
          description: "Enable flag",
          default: false
        }),
        enabled: S.Boolean({
          description: "Enabled by default",
          default: true
        }),
        date: S.String({
          description: "Run date",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$"
        }),
        timestamp: S.String({
          description: "Run timestamp",
          pattern: "^\\d{4}-\\d{2}-\\d{2}T"
        }),
        callbackUrl: S.String({
          description: "Callback URL",
          format: "uri"
        }),
        userEmail: S.String({
          description: "User email",
          format: "email"
        }),
        reportFiles: S.Array(
          S.String({
            description: "Report files"
          })
        ),
        configPath: S.String({
          description: "Config path"
        }),
        token: S.String({
          description: "Token value"
        }),
        retries: S.Number({
          description: "Retry count"
        })
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [inspect]
    });

    process.argv = ["node", "toolcraft", "inspect", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("--implied-flag  Implied false flag (required)");
    expect(output).toContain("--flag  Enable flag (default: false)");
    expect(output).not.toContain("--flag [value]");
    expect(output).toContain("--no-enabled  Enabled by default (default: true)");
    expect(output).toContain("--date <YYYY-MM-DD>  Run date (required)");
    expect(output).toContain("--timestamp <YYYY-MM-DDTHH:MM:SS>  Run timestamp (required)");
    expect(output).toContain("--callback-url <url>  Callback URL (required)");
    expect(output).toContain("--user-email <email>  User email (required)");
    expect(output).toContain("--report-files <path...>  reportFiles (required)");
    expect(output).toContain("--config-path <path>  Config path (required)");
    expect(output).toContain("--token <value>  Token value (required)");
    expect(output).toContain("--retries <value>  Retry count (required)");
    expect(output).not.toMatch(/<(string|number)>/u);
  });

  it("renders field-name help tokens with snake casing", async () => {
    const inspect = defineCommand({
      name: "inspect",
      params: S.Object({
        configPath: S.String({
          description: "Config path"
        }),
        ownerEmail: S.String({
          description: "Owner email"
        })
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [inspect]
    });

    process.argv = ["node", "toolcraft", "inspect", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, { casing: "snake" });

    const output = readStdout(stdoutWrite);
    expect(output).toContain("--config_path <path>  Config path (required)");
    expect(output).toContain("--owner_email <email>  Owner email (required)");
    expect(output).not.toMatch(/<(string|number)>/u);
  });

  it("renders help for oneOf, union, record, array-object, and json params", async () => {
    const publish = defineCommand({
      name: "publish",
      params: S.Object({
        destination: S.OneOf({
          discriminator: "kind",
          branches: {
            email: S.Object({
              address: S.String()
            }),
            webhook: S.Object({
              url: S.String()
            })
          }
        }),
        contact: S.Union([
          S.Object({
            email: S.String()
          }),
          S.Object({
            phone: S.String()
          })
        ]),
        weights: S.Record(S.Number()),
        recipients: S.Array(
          S.Object({
            name: S.String(),
            email: S.String()
          })
        ),
        payload: S.Json()
      }),
      handler: async () => null
    });

    const root = defineGroup({
      name: "toolcraft",
      children: [publish]
    });

    process.argv = ["node", "toolcraft", "publish", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("--destination.kind <value>");
    expect(output).toContain("--destination.address <value>");
    expect(output).toContain("--destination.url <url>");
    expect(output).toContain("--contact-kind <value>");
    expect(output).toContain("--contact.email <email>");
    expect(output).toContain("--contact.phone <value>");
    expect(output).toContain("--weights.<key> <value>");
    expect(output).toContain("--recipients.<index>.name <name>");
    expect(output).toContain("--recipients.<index>.email <email>");
    expect(output).toContain("--payload <json>");
  });

  it("filters help command listings to the cli scope", async () => {
    const visibleCommand = defineCommand({
      name: "text",
      description: "Generate text",
      params: S.Object({}),
      handler: async () => null
    });
    const hiddenCommand = defineCommand({
      name: "invoke",
      description: "Internal SDK helper",
      params: S.Object({}),
      scope: ["sdk"],
      handler: async () => null
    });

    const generate = defineGroup({
      name: "generate",
      description: "Generate content via Poe API.",
      children: [visibleCommand, hiddenCommand]
    });

    const root = defineGroup({
      name: "poe-code",
      children: [generate]
    });

    process.argv = ["node", "poe-code", "generate", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("Commands");
    expect(output).not.toContain("Commands:");
    expect(output).toContain("text");
    expect(output).not.toContain("invoke");
  });

  it("renders empty cli groups in help output", async () => {
    const builder = defineGroup({
      name: "builder",
      description: "Builder commands.",
      children: []
    });

    const root = defineGroup({
      name: "poe-code",
      children: [builder]
    });

    process.argv = ["node", "poe-code", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("Commands");
    expect(output).not.toContain("Commands:");
    expect(output).toContain("builder");
  });

  it("renders help for an empty nested cli group", async () => {
    const builder = defineGroup({
      name: "builder",
      description: "Builder commands.",
      children: []
    });

    const root = defineGroup({
      name: "poe-code",
      children: [builder]
    });

    process.argv = ["node", "poe-code", "builder", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("poe-code builder");
    expect(output).toContain("Builder commands.");
  });

  it("falls back to toolcraft as the program name when mounting multiple roots without an entrypoint", async () => {
    const first = defineGroup({
      name: "first",
      children: []
    });
    const second = defineGroup({
      name: "second",
      children: []
    });

    process.argv = ["node", "", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI([first, second]);

    expect(readStdout(stdoutWrite)).toContain("toolcraft\n");
  });

  it("renders a blank-named root group with inferred heading and usage", async () => {
    setStdoutColumns(100);
    const root = defineGroup({
      name: "",
      description: "X",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => null
        })
      ]
    });

    process.argv = ["node", "/usr/local/bin/poe-code", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toMatchInlineSnapshot(`
      "poe-code — X

      Usage: poe-code [command] [OPTIONS]

      Commands
        deploy
        approvals   Inspect and execute queued approvals.

      Options: --yes  --output <format>
      "
    `);
  });

  it("renders two-level group help with full heading and usage", async () => {
    setStdoutColumns(100);
    const child = defineGroup({
      name: "child",
      description: "desc",
      children: []
    });
    const parent = defineGroup({
      name: "parent",
      children: [child]
    });
    const root = defineGroup({
      name: "",
      children: [parent]
    });

    process.argv = ["node", "/opt/bin/poe-code", "parent", "child", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toMatchInlineSnapshot(`
      "parent child — desc

      Usage: poe-code parent child [command] [OPTIONS]
      "
    `);
  });

  it("always renders usage lines at every help level with argv-derived root usage", async () => {
    setStdoutColumns(100);
    const leaf = defineCommand({
      name: "leaf",
      positional: ["target"],
      params: S.Object({
        target: S.String()
      }),
      handler: async () => null
    });
    const group = defineGroup({
      name: "group",
      children: [leaf]
    });
    const root = defineGroup({
      name: "",
      children: [group]
    });

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.argv = ["node", "/repo/bin/custom-cli", "--help"];
    await runCLI(root);
    const rootHelp = readStdout(stdoutWrite);

    stdoutWrite.mockClear();
    process.argv = ["node", "/repo/bin/custom-cli", "group", "--help"];
    await runCLI(root);
    const groupHelp = readStdout(stdoutWrite);

    stdoutWrite.mockClear();
    process.argv = ["node", "/repo/bin/custom-cli", "group", "leaf", "--help"];
    await runCLI(root);
    const leafHelp = readStdout(stdoutWrite);

    expect({
      root: rootHelp.split("\n").find((line) => line.startsWith("Usage:")),
      group: groupHelp.split("\n").find((line) => line.startsWith("Usage:")),
      leaf: leafHelp.split("\n").find((line) => line.startsWith("Usage:"))
    }).toMatchInlineSnapshot(`
      {
        "group": "Usage: custom-cli group [command] [OPTIONS]",
        "leaf": "Usage: custom-cli group leaf [OPTIONS] <target>",
        "root": "Usage: custom-cli [command] [OPTIONS]",
      }
    `);
  });

  it("uses [OPTIONS] placeholder in leaf synopsis even with many flags", async () => {
    setStdoutColumns(100);
    const patchBot = defineCommand({
      name: "patch-bot",
      description: "Patch a bot's metadata.",
      positional: ["botHandle"],
      params: S.Object({
        botHandle: S.String(),
        displayName: S.Optional(S.String()),
        displayNameNull: S.Optional(S.Boolean()),
        description: S.Optional(S.String()),
        descriptionNull: S.Optional(S.Boolean()),
        isOfficial: S.Optional(S.Boolean()),
        allowAttachments: S.Optional(S.Boolean()),
        conversationStarters: S.Optional(S.Array(S.String())),
        ownerHandle: S.Optional(S.String())
      }),
      handler: async () => null
    });
    const botActions = defineGroup({
      name: "bot-actions",
      children: [patchBot]
    });
    const root = defineGroup({
      name: "",
      children: [botActions]
    });

    process.argv = ["node", "/usr/local/bin/poe-agent-tools", "bot-actions", "patch-bot", "--help"];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    const usageLine = output.split("\n").find((line) => line.startsWith("Usage:")) ?? "";
    expect(usageLine).toBe("Usage: poe-agent-tools bot-actions patch-bot [OPTIONS] <botHandle>");
    expect(usageLine.length).toBeLessThanOrEqual(100);
    expect(usageLine).not.toContain("--display-name");
    expect(usageLine).not.toContain("--description");
    expect(usageLine).not.toContain("--owner-handle");
  });

  it("lists only direct children in a group commands section", async () => {
    setStdoutColumns(100);
    const grandchild = defineCommand({
      name: "grandchild",
      description: "Nested leaf",
      params: S.Object({}),
      handler: async () => null
    });
    const child = defineGroup({
      name: "child",
      description: "Child group",
      children: [grandchild]
    });
    const sibling = defineCommand({
      name: "sibling",
      description: "Sibling leaf",
      params: S.Object({}),
      handler: async () => null
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [child, sibling]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toMatchInlineSnapshot(`
      "toolcraft

      Usage: toolcraft [command] [OPTIONS]

      Commands
        child       Child group
        sibling     Sibling leaf
        approvals   Inspect and execute queued approvals.

      Options: --yes  --output <format>
      "
    `);
  });

  it("splits a multi-sentence leaf description between heading and paragraph", async () => {
    setStdoutColumns(100);
    const inspect = defineCommand({
      name: "inspect",
      description: "First sentence. Second sentence explains more.",
      params: S.Object({}),
      handler: async () => null
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [inspect]
    });

    process.argv = ["node", "toolcraft", "inspect", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toMatchInlineSnapshot(`
      "toolcraft inspect — First sentence.

      Second sentence explains more.

      Usage: toolcraft inspect [OPTIONS]
      "
    `);
  });

  it("wraps help descriptions at narrow terminal widths", async () => {
    setStdoutColumns(60);
    const scan = defineCommand({
      name: "scan",
      description: "Scan repositories and summarize changes.",
      params: S.Object({
        repositoryPath: S.String({
          description:
            "Repository path with a deliberately long explanation that wraps in narrow terminals"
        })
      }),
      handler: async () => null
    });
    const root = defineGroup({
      name: "toolcraft",
      description: "Developer automation commands.",
      children: [scan]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    expect(readStdout(stdoutWrite)).toMatchInlineSnapshot(`
      "toolcraft — Developer automation commands.

      Usage: toolcraft [command] [OPTIONS]

      Commands
        scan --repository-path <path>   Scan repositories and
                                        summarize changes.
        approvals                       Inspect and execute queued
                                        approvals.

      Options: --yes  --output <format>
      "
    `);
  });

  it("uses plain help formatting when stdout is not a TTY", async () => {
    setStdoutColumns(100);
    setTTY(process.stdout, false);
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineCommand({
          name: "deploy",
          description: "Deploy a service",
          params: S.Object({}),
          handler: async () => null
        })
      ]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(output).toMatchInlineSnapshot(`
      "toolcraft

      Usage: toolcraft [command] [OPTIONS]

      Commands
        deploy      Deploy a service
        approvals   Inspect and execute queued approvals.

      Options: --yes  --output <format>
      "
    `);
    expect(formatterState.plainCommandListCalls).toBeGreaterThan(0);
    expect(output).not.toContain("\u001b[");
  });

  it("uses plain help formatting when stdout TTY status is undefined", async () => {
    setStdoutColumns(100);
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: undefined
    });
    const root = defineGroup({
      name: "toolcraft",
      children: [
        defineCommand({
          name: "deploy",
          description: "Deploy a service",
          params: S.Object({}),
          handler: async () => null
        })
      ]
    });

    process.argv = ["node", "toolcraft", "--help"];

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root);

    const output = readStdout(stdoutWrite);
    expect(formatterState.plainCommandListCalls).toBeGreaterThan(0);
    expect(output).not.toContain("\u001b[");
  });

  it("suppresses fields tagged global from leaf help and surfaces them only on root", async () => {
    setStdoutColumns(100);
    const patchBot = defineCommand({
      name: "patch-bot",
      description: "Patch a bot's metadata.",
      positional: ["botHandle"],
      params: S.Object({
        botHandle: S.String(),
        displayName: S.Optional(S.String()),
        dryRun: S.Optional(
          S.Boolean({
            description: "Print the HTTP request and exit without sending it.",
            global: true
          })
        ),
        verbose: S.Optional(
          S.Boolean({
            description: "Log the request line to stderr.",
            short: "v",
            global: true
          })
        )
      }),
      handler: async () => null
    });
    const botActions = defineGroup({
      name: "bot-actions",
      children: [patchBot]
    });
    const root = defineGroup({
      name: "",
      children: [botActions]
    });

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.argv = ["node", "/usr/local/bin/poe-agent-tools", "bot-actions", "patch-bot", "--help"];
    await runCLI(root);
    const leafHelp = readStdout(stdoutWrite);

    expect(leafHelp).not.toContain("--dry-run");
    expect(leafHelp).not.toContain("--verbose");
    expect(leafHelp).not.toMatch(/(^|\s)-v(\s|$)/m);
    expect(leafHelp).toContain("--display-name");

    stdoutWrite.mockClear();
    process.argv = ["node", "/usr/local/bin/poe-agent-tools", "--help"];
    await runCLI(root);
    const rootHelp = readStdout(stdoutWrite);

    const dryRunCount = rootHelp.match(/--dry-run/g)?.length ?? 0;
    const debugCount = rootHelp.match(/--debug/g)?.length ?? 0;
    expect(dryRunCount).toBe(1);
    expect(rootHelp).not.toContain("--verbose");
    expect(debugCount).toBe(0);
    expect(rootHelp).toContain("Options");

    const commandsLine =
      rootHelp.split("\n").find((line) => line.trimStart().startsWith("bot-actions")) ?? "";
    expect(commandsLine).not.toContain("--dry-run");
    expect(commandsLine).not.toContain("-v");
    expect(commandsLine).not.toContain("--verbose");
    expect(commandsLine).not.toContain("--debug");
  });
});
