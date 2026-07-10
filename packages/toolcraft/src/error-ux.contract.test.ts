import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { S } from "toolcraft-schema";
import { stripAnsi } from "terminal-pilot";
import {
  ApprovalDeclinedError,
  ToolcraftBugError,
  UserError,
  defineCommand,
  defineGroup
} from "./index.js";

vi.mock("toolcraft-design", () => ({
  configureTheme: vi.fn(),
  createLogger: () => ({
    info: (message: string) => process.stdout.write(`${message}\n`),
    success: (message: string) => process.stdout.write(`${message}\n`),
    warn: (message: string) => process.stderr.write(`${message}\n`),
    error: (message: string) => process.stderr.write(`${message}\n`),
    resolved: (label: string, value: string) => process.stdout.write(`${label}: ${value}\n`),
    errorResolved: (label: string, value: string) => process.stderr.write(`${label}: ${value}\n`),
    message: (message: string) => process.stdout.write(`${message}\n`)
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
    commands.map((command) => `  ${command.name}  ${command.description}`).join("\n"),
  formatOptionList: (options: Array<{ flags: string; description: string }>) =>
    options.map((option) => `  ${option.flags}  ${option.description}`).join("\n"),
  renderHelpTokens: (tokens: Array<{ text: string }>) => tokens.map((token) => token.text).join(""),
  helpFormatterPlain: {
    formatCommandList: (commands: Array<{ name: string; description: string }>) =>
      commands.map((command) => `  ${command.name}  ${command.description}`).join("\n"),
    formatOptionList: (options: Array<{ flags: string; description: string }>) =>
      options.map((option) => `  ${option.flags}  ${option.description}`).join("\n")
  },
  promptText: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
  cancel: vi.fn(),
  resetOutputFormatCache: vi.fn(),
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

const { runCLI } = await import("./cli.js");

const originalArgv = [...process.argv];
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const originalOutputFormat = process.env.OUTPUT_FORMAT;

function setTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, value: boolean): void {
  Object.defineProperty(stream, "isTTY", {
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

function readPlainStderr(stderrWrite: ReturnType<typeof vi.spyOn>): string {
  return stripAnsi(stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join(""));
}

async function runWithStderrSnapshot(
  command: Parameters<typeof defineCommand>[0],
  argv: readonly string[],
  options: Parameters<typeof runCLI>[1] = {}
): Promise<string> {
  const root = defineGroup({
    name: "toolcraft",
    children: [defineCommand(command)]
  });
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  process.argv = ["node", "toolcraft", ...argv];

  try {
    await runCLI(root, {
      controls: {
        debug: true,
        output: true,
        verbose: true,
        yes: true
      },
      ...options
    });
    return readPlainStderr(stderrWrite);
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}

describe("toolcraft error UX contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    restoreOutputFormat();
    setTTY(process.stdout, true);
    setTTY(process.stdin, false);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    restoreOutputFormat();

    if (stdoutTTY) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    }
    if (stdinTTY) {
      Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    }
  });

  it("snapshots UserError thrown by a handler", async () => {
    const stderr = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({}),
        handler: async () => {
          throw new UserError("Invalid input.");
        }
      },
      ["deploy", "--yes"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Invalid input.
      "
    `);
  });

  it("snapshots generic Error thrown by a handler", async () => {
    const stderr = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({}),
        handler: async () => {
          throw new Error("Boom.");
        }
      },
      ["deploy", "--yes"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Boom. Use --debug for a stack trace.
      "
    `);
  });

  it("snapshots ToolcraftBugError thrown by a handler", async () => {
    const stderr = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({}),
        handler: async () => {
          throw new ToolcraftBugError("command must define an object params schema.");
        }
      },
      ["deploy", "--yes"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "toolcraft hit an internal invariant: command must define an object params schema.
      This is a bug in toolcraft or in the command definition; it cannot be worked around by changing argv. Re-run with --debug for a stack trace and file an issue.
      "
    `);
  });

  it("snapshots HttpError-like output", async () => {
    const stderr = await runWithStderrSnapshot(
      {
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
      },
      ["deploy", "--yes"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Request:  GET https://api.example.com/v1/widgets/42
      Status:   500 Internal Server Error

      Code:     internal_panic
      Request id: 8f3c
      Re-run with --verbose to see headers and full body.
      "
    `);
  });

  it("snapshots verbose HttpError-like output", async () => {
    const stderr = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({}),
        handler: async () => {
          throw createHttpErrorLike();
        }
      },
      ["deploy", "--yes", "--verbose"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Request:  GET https://api.example.com/v1/widgets/42

      Request headers:
        authorization: Bearer ****

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
  });

  it("snapshots debug HttpError-like output", async () => {
    const stderr = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({}),
        handler: async () => {
          throw createHttpErrorLike();
        }
      },
      ["deploy", "--yes", "--debug"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Request:  GET https://api.example.com/v1/widgets/42

      Request headers:
        authorization: Bearer ****

      Status:   500 Internal Server Error

      Response headers:
        content-type: application/json
        x-request-id: 8f3c

      Response body:
        {
          "error": "internal_panic",
          "trace_id": "8f3c-123"
        }
      HttpError: request failed
          at fake-handler
      "
    `);
  });

  it("snapshots missing required parameter output", async () => {
    const stderr = await runWithStderrSnapshot(
      {
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
        handler: async () => null
      },
      ["send", "--destination.kind", "email", "--yes"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Missing required parameter "destination.address" for destination.kind="email". Available: destination.address.
      Run toolcraft send --help for usage.
      "
    `);
  });

  it("snapshots unknown parameter output", async () => {
    const stderr = await runWithStderrSnapshot(
      {
        name: "score",
        params: S.Object({
          weights: S.Record(S.Number())
        }),
        handler: async () => null
      },
      ["score", "--weights.primary.bad", "10", "--yes"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Unknown parameter "weights.primary.bad". Available: weights.primary.
      Run toolcraft score --help for usage.
      "
    `);
  });

  it("snapshots invalid JSON preset output", async () => {
    vol.fromJSON({
      "/presets/invalid-json.json": "{\n,"
    });

    const stderr = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({
          service: S.String()
        }),
        handler: async () => null
      },
      ["deploy", "--preset", "/presets/invalid-json.json", "--yes"],
      { presets: true }
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Preset file "/presets/invalid-json.json" is not valid JSON: Expected property name or '}' in JSON at position 2 at line 2 column 1.
      --> /presets/invalid-json.json:2:1
        |
      1 | {
      2 | ,
        | ^
        |
      Run toolcraft deploy --help for usage.
      "
    `);
  });

  it("snapshots ApprovalDeclinedError output", async () => {
    const withReason = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({}),
        handler: async () => {
          throw new ApprovalDeclinedError({
            commandPath: "deploy",
            reason: "Production window is closed."
          });
        }
      },
      ["deploy", "--yes"]
    );

    expect(withReason).toMatchInlineSnapshot(`
      "Declined: Production window is closed.
      "
    `);
  });

  it("snapshots ApprovalDeclinedError fallback output", async () => {
    const stderr = await runWithStderrSnapshot(
      {
        name: "deploy",
        params: S.Object({}),
        handler: async () => {
          throw new ApprovalDeclinedError({
            commandPath: "deploy"
          });
        }
      },
      ["deploy", "--yes"]
    );

    expect(stderr).toMatchInlineSnapshot(`
      "Declined.
      "
    `);
  });
});
